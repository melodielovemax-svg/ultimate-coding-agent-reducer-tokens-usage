// Duplicate and near-duplicate detection.
//
// Context assembly pulls the same file in more than once constantly: an agent
// reads a file, edits it, re-reads it, and a subagent read the same file
// earlier in the session. Every repeat is paid for in full.
//
// Exact duplicates are trivial. Near-duplicates need a similarity measure that
// is cheap, has no dependencies, and does not need a model. SimHash over
// token shingles fits all three: it collapses a document to a 64-bit fingerprint
// where small edits move only a few bits.

const WIDTH = 64

// FNV-1a, 64-bit via two 32-bit halves. Not cryptographic; it only needs to
// distribute bits for similarity comparison.
function fnv1a64(str) {
  let hi = 0x811c9dc5
  let lo = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    lo ^= c & 0xff
    hi ^= (c >>> 8) & 0xff
    // 32-bit FNV prime multiply on both halves.
    lo = Math.imul(lo, 0x01000193) >>> 0
    hi = Math.imul(hi, 0x01000193) >>> 0
  }
  return { hi: hi >>> 0, lo: lo >>> 0 }
}

function tokenizeForHash(text) {
  return (text.toLowerCase().match(/[a-z0-9_]+/g) || []).filter((t) => t.length > 2)
}

// Rolling shingle set, so a one-line edit in a 5000-line file does not produce
// a completely different fingerprint.
function shingles(tokens, size = 5) {
  if (tokens.length === 0) return []
  if (tokens.length < size) return [tokens.join(' ')]
  const out = []
  for (let i = 0; i <= tokens.length - size; i++) {
    out.push(tokens.slice(i, i + size).join(' '))
  }
  return out
}

export function simhash(text) {
  const sh = shingles(tokenizeForHash(text))
  if (sh.length === 0) return { hi: 0, lo: 0 }

  const counts = new Array(WIDTH).fill(0)
  for (const s of sh) {
    const { hi, lo } = fnv1a64(s)
    for (let b = 0; b < 32; b++) {
      counts[b] += (hi >>> b) & 1 ? 1 : -1
      counts[b + 32] += (lo >>> b) & 1 ? 1 : -1
    }
  }

  let hi = 0
  let lo = 0
  for (let b = 0; b < 32; b++) {
    if (counts[b] > 0) hi |= 1 << b
    if (counts[b + 32] > 0) lo |= 1 << b
  }
  return { hi: hi >>> 0, lo: lo >>> 0 }
}

export function hamming(a, b) {
  let x = (a.hi ^ b.hi) >>> 0
  let y = (a.lo ^ b.lo) >>> 0
  let count = 0
  while (x) {
    x &= x - 1
    count++
  }
  while (y) {
    y &= y - 1
    count++
  }
  return count
}

// Hamming distance at which two documents are considered hash-similar.
//
// Measured on a 40-line fixture: a single word edit gives distance 5, a
// document sharing half its lines with another gives 9, and unrelated code
// gives 35. The overlap check below is what actually separates those cases, so
// this bound is deliberately generous: it only has to exclude genuinely
// different documents, not confirm duplicates. Setting it to the textbook 3
// would discard real near duplicates, which is the failure that matters.
export const DEFAULT_NEAR_DUP_DISTANCE = 12

// Exact shingle overlap, used to confirm a SimHash candidate.
//
// SimHash is a lossy filter. On a long document it converges: a 40-line file
// with one word changed still hashes to distance 0, because a handful of
// changed shingles out of hundreds barely moves the bit distribution. So a
// small hamming distance proves "similar", never "identical", and a pure
// SimHash pipeline can drop a file that only collides.
//
// This is the confirmation step: cheap set intersection over the same shingles,
// so a candidate must also share most of its content before it is dropped.
function shingleSet(text) {
  return new Set(shingles(tokenizeForHash(text)))
}

export function shingleOverlap(a, b) {
  const sa = shingleSet(a)
  const sb = shingleSet(b)
  if (sa.size === 0 || sb.size === 0) return 0

  let shared = 0
  const [small, large] = sa.size <= sb.size ? [sa, sb] : [sb, sa]
  for (const s of small) if (large.has(s)) shared++

  return shared / (sa.size + sb.size - shared)
}

// Overlap required to act on a hash candidate. 0.8 allows real edits while
// rejecting a collision, which shares almost nothing.
export const DEFAULT_OVERLAP_THRESHOLD = 0.8

// Normalises before exact comparison so a whitespace-only difference is still
// caught, but line-ending and trailing-space noise is not.
function normalize(text) {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim()
}

export function isExactDuplicate(a, b) {
  const na = normalize(a)
  if (na === '') return false
  return na === normalize(b)
}

// Takes documents as [{ id, text }] and reports which are redundant with an
// earlier one. `keep` selects the survivor; `dropped` lists the rest.
//
// The survivor is always the earliest occurrence, because in a session context
// the first copy is the one the agent has already reasoned about.
export function findDuplicates(
  documents,
  { distance = DEFAULT_NEAR_DUP_DISTANCE, overlap = DEFAULT_OVERLAP_THRESHOLD } = {},
) {
  const seen = []
  const dropped = []
  const kept = []

  for (const doc of documents) {
    const text = doc.text ?? ''
    if (normalize(text) === '') {
      dropped.push({ id: doc.id, reason: 'empty', duplicateOf: null })
      continue
    }

    const fingerprint = simhash(text)

    const exact = seen.find((s) => normalize(s.text) === normalize(text))
    if (exact) {
      dropped.push({ id: doc.id, reason: 'exact', duplicateOf: exact.id, distance: 0 })
      continue
    }

    // Hash is only a filter; overlap decides.
    const near = seen.find((s) => {
      const d = hamming(s.fingerprint, fingerprint)
      return d <= distance && shingleOverlap(s.text, text) >= overlap
    })

    if (near) {
      const d = hamming(near.fingerprint, fingerprint)
      dropped.push({ id: doc.id, reason: 'near', duplicateOf: near.id, distance: d })
      continue
    }

    seen.push({ id: doc.id, text, fingerprint })
    kept.push(doc.id)
  }

  return { kept, dropped }
}