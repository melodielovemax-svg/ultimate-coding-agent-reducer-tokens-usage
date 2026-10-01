// Relevance ranking.
//
// BM25 over line-level "documents". The unit is the line rather than the file
// because the useful thing in a large file is usually three contiguous lines,
// and ranking whole files just reproduces the directory listing the agent
// already had.
//
// No dependencies, no embeddings. Embeddings measure semantic similarity,
// which is strictly better, but they cost an API call and an index; this stage
// runs with no network and no warm-up, so it is the stage that is always
// available. `tur tokens optimize --semantic` is where a caller plugs in a
// real scorer.

const K1 = 1.5
const B = 0.75

const STOPWORDS = new Set(
  ('a an and are as at be but by for from has have if in into is it its of on or that the to was were will with this those ' +
    'i me my we our you your he she they them do does did not no yes so than then when where which who whom what how why')
    .split(' '),
)

export function tokenizeQuery(query) {
  if (typeof query !== 'string') return []
  return query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
}

// Stemming is deliberately trivial: strip a trailing plural or -ing. A real
// stemmer measurably improves recall on code identifiers and costs real
// complexity, so this is the conservative middle.
function stem(token) {
  if (token.length > 4 && token.endsWith('ing')) return token.slice(0, -3)
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1)
  return token
}

function lineTerms(line) {
  return line
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem)
}

// Scores every line of `text` against `query` using BM25, returning indices
// sorted most-relevant first.
export function rankLines(text, query, { window = 1 } = {}) {
  const queryTerms = tokenizeQuery(query).map(stem)
  const lines = typeof text === 'string' ? text.split('\n') : []

  if (queryTerms.length === 0 || lines.length === 0) {
    return { ranked: [], total: 0 }
  }

  // Term frequency and document frequency over lines.
  const tf = lines.map((l) => {
    const counts = new Map()
    for (const t of lineTerms(l)) counts.set(t, (counts.get(t) ?? 0) + 1)
    return counts
  })

  const df = new Map()
  for (const t of queryTerms) {
    let n = 0
    for (const counts of tf) if (counts.has(t)) n++
    df.set(t, n)
  }

  const N = lines.length
  const avgLen = lines.reduce((sum, l) => sum + lineTerms(l).length, 0) / N || 1

  const scored = lines.map((line, i) => {
    const terms = lineTerms(line)
    const len = terms.length
    let score = 0

    for (const t of queryTerms) {
      const f = tf[i].get(t)
      if (!f) continue
      const n = df.get(t)
      // BM25 IDF with the +0.5 smoothing that keeps a term appearing in every
      // line from contributing a negative score.
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
      score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (len / avgLen))))
    }

    return { line: i, index: i, score, text: line }
  })

  // Expand a hit to its neighbours, because a declaration is rarely
  // self-contained: the type and the body bracket it matter too.
  const boost = new Map(scored.map((s) => [s.line, s.score]))
  if (window > 0) {
    for (const s of scored) {
      if (s.score <= 0) continue
      for (let d = 1; d <= window; d++) {
        for (const neighbour of [s.line - d, s.line + d]) {
          const existing = boost.get(neighbour)
          if (existing !== undefined) {
            boost.set(neighbour, Math.max(existing, s.score * 0.5 ** d))
          }
        }
      }
    }
    for (const s of scored) s.score = boost.get(s.line) ?? s.score
  }

  const ranked = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)

  return { ranked, total: N }
}

// Keeps the highest-scoring lines and stitches them back together in original
// order, so the result still reads as source code rather than a ranked list.
// Elision is marked, because a reader that cannot tell a gap from a deleted
// function will draw a wrong conclusion.
export function selectByRelevance(text, query, options = {}) {
  const { maxTokens = Infinity, count, window = 1, elision = ' … ' } = options
  const { ranked } = rankLines(text, query, { window })
  if (ranked.length === 0) return { text, selected: [], truncated: false }

  const budget = maxTokens ?? Infinity
  const keep = count ?? ranked.length

  const lines = text.split('\n')
  const chosen = ranked.slice(0, keep).map((r) => r.index).sort((a, b) => a - b)
  const out = []
  let previous = -1

  // Leading elision. Skipped lines before the first kept one are just as much a
  // gap as skipped lines between two kept ones, and leaving them unmarked makes
  // the excerpt read as a complete file.
  if (chosen.length > 0 && chosen[0] > 0) out.push(elision.trim())

  for (const idx of chosen) {
    if (previous !== -1 && idx > previous + 1) out.push(elision)
    out.push(lines[idx])
    previous = idx
  }

  // Trailing elision, for the same reason.
  if (chosen.length > 0 && chosen[chosen.length - 1] < lines.length - 1) out.push(elision.trim())

  const result = out.join('\n')
  if (Number.isFinite(budget) && countOf(result) > budget) {
    // Still over budget after line selection: the file is not worth including.
    return { text: '', selected: chosen, truncated: true }
  }

  return { text: result, selected: chosen, truncated: chosen.length < lines.length }
}

// The budget check needs a token count, but importing the tokenizer here would
// make the two modules depend on each other. Injected once at load by the
// pipeline, which owns both.
let countOf = (t) => Math.ceil(t.length / 4)
export function setCounter(fn) {
  countOf = typeof fn === 'function' ? fn : (t) => Math.ceil(t.length / 4)
}