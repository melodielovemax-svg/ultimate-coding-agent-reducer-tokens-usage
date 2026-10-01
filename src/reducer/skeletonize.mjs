// Structure extraction for source code.
//
// Reading a 600-line file to answer "what does this export" costs 600 lines.
// The declarations alone answer it in about 20. This stage keeps signatures,
// imports, exports, types and comments, and drops function bodies.
//
// It is a lexical scanner, not a parser. That is a deliberate trade: no
// dependency, no per-language grammar to rot, and it degrades to something
// reasonable on a file it does not fully understand. A parser would be exact
// and would also fail closed on syntax errors, which is the wrong failure mode
// for a tool whose job is to reduce noise.

const DECLARATION = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\w*/,
  /^\s*(?:export\s+)?(?:abstract\s+)?class\s+\w+/,
  /^\s*(?:export\s+)?(?:interface|type|enum|trait|struct|record)\s+\w+/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+\w+/,
  /^\s*(?:public|private|protected|internal|static|final|override|pub|fn|func|def|sub)\b/,
  /^\s*(?:async\s+)?def\s+\w+/,
  /^\s*[A-Za-z_]\w*\s*(?:\(|:\s*[\w<>\[\]{}]|=\s*(?:async\s*)?\()/,
]

const KEEP_ALWAYS = [
  /^\s*(?:import|export)\b/,
  /^\s*(?:#include|use|require|package|namespace|using|module)\b/,
  /^\s*(?:\/\/|#|<!--|\*|\/\*)/,
  /^\s*@/,
  /^\s*\}/,
]

// A line that only closes blocks carries no information a reader needs; it is
// the single largest source of padding in a skeleton.
const NOISE = [
  /^\s*$/,
  /^\s*[)\]}>;,]+\s*$/,
  /^\s*(?:console\.log|print|fmt\.Println|System\.out\.println)\b/,
]

function isDeclaration(line) {
  return DECLARATION.some((re) => re.test(line))
}

function isAlways(line) {
  return KEEP_ALWAYS.some((re) => re.test(line))
}

function isNoise(line) {
  return NOISE.some((re) => re.test(line))
}

// Strips comments and string bodies so braces inside them cannot be mistaken
// for block structure. Without this, `const re = /{2}/` throws the depth
// count off and every declaration after it is misclassified.
export function stripLiterals(line) {
  let out = ''
  let i = 0

  while (i < line.length) {
    const two = line.slice(i, i + 2)

    if (two === '//') break
    if (two === '/*') {
      const end = line.indexOf('*/', i + 2)
      if (end === -1) break
      i = end + 2
      continue
    }

    const c = line[i]
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      i++
      while (i < line.length) {
        if (line[i] === '\\') {
          i += 2
          continue
        }
        if (line[i] === quote) {
          i++
          break
        }
        i++
      }
      out += '""'
      continue
    }

    out += c
    i++
  }

  return out
}

export function braceDelta(line) {
  const bare = stripLiterals(line)
  let delta = 0
  for (const c of bare) {
    if (c === '{') delta++
    else if (c === '}') delta--
  }
  return delta
}

// Control-flow keywords look exactly like method signatures to a line scanner.
// They are excluded so `if (x) {` inside a function body is not kept as a
// declaration.
const CONTROL_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'do', 'try', 'finally',
  'function', 'case', 'with', 'new', 'typeof', 'await', 'yield',
])

const METHOD_SIGNATURE =
  /^\s*(?:(?:public|private|protected|internal|static|readonly|abstract|override|final|async|get|set)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::[^;{]*)?\{\s*$/

function isMethodSignature(line) {
  const m = METHOD_SIGNATURE.exec(line)
  if (!m) return false
  return !CONTROL_KEYWORDS.has(m[1])
}

// A member is a method signature, a bare property declaration, or a nested
// container. Nested containers are included so a second pass still recognises
// them as containers.
function isMemberLike(line) {
  // A bare closing or opening brace is never a member. Without this guard the
  // walk emits every `}` in the block, which is most of what a body contains.
  if (NOISE.some((re) => re.test(line))) return false

  return (
    isMethodSignature(line) ||
    CONTAINER.test(line) ||
    /^\s*(?:(?:public|private|protected|internal|static|readonly)\s+)*[A-Za-z_$][\w$]*\s*(?:\?|[:=])[^;{]*;?\s*$/.test(line) ||
    /^\s*[A-Za-z_$][\w$]*\s*[:(][^;{]*[;{]\s*$/.test(line)
  )
}

// Declared here rather than inside the loop because the member walk and the
// top-level walk must agree on what a symbol name looks like.
function memberName(line) {
  const m = /\b(?:function|class|interface|type|enum|def|struct|trait|const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(line)
  if (m) return m[1]
  const sig = METHOD_SIGNATURE.exec(line)
  return sig ? sig[1] : null
}

// Leading whitespace width of a line, for re-indenting generated closers.
export function indentOf(line) {
  const m = /^[ \t]*/.exec(line ?? '')
  return m ? m[0].replace(/\t/g, '  ').length : 0
}

// Containers have members worth listing. A function body does not: a `const`
// inside a function is an implementation detail, and keeping those is most of
// what this stage exists to remove.
const CONTAINER = /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:class|interface|enum|struct|trait|namespace)\s/

// Keeps doc comments attached to the declaration they document. A signature
// with no comment is usually the wrong level of detail to keep.
function isComment(line) {
  return /^\s*(?:\/\/|#|<!--|\*|\/\*)/.test(line)
}

// Returns the skeleton plus the ids of the declarations found, so a later stage
// can be asked for one symbol specifically.
//
// Depth tracking is what makes this useful rather than merely shorter: without
// it every `const` inside every function body survives, which is the bulk of a
// real file and the bulk of what we are trying to remove.
export function skeletonize(text, { maxLines = 400 } = {}) {
  if (typeof text !== 'string' || text === '') {
    return { text: '', symbols: [], linesKept: 0, linesTotal: 0, truncated: false }
  }

  const lines = text.split('\n')
  const out = []
  const symbols = []
  let pendingComments = []
  let depth = 0
  let truncated = false
  // The declaration whose body is currently being walked. Needed because a
  // member is only identifiable relative to the container above it.
  let lastKeptLine = ''

  const flush = (line, symbolName, symbolLine) => {
    if (out.length >= maxLines) {
      truncated = true
      return false
    }
    // A run of comments longer than the declaration it precedes is usually
    // a file header or a licence block, not documentation.
    if (pendingComments.length <= 4) out.push(...pendingComments)
    pendingComments = []
    if (out.length >= maxLines) {
      // The comment run pushed this declaration to the cap, so there is no
      // room for the declaration itself.
      truncated = true
      return false
    }
    if (symbolName) {
      symbols.push({ name: symbolName, line: symbolLine })
    }
    out.push(line)
    return true
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const delta = braceDelta(line)
    const symbolLine = i + 1

    if (isComment(line)) {
      pendingComments.push(line)
      depth += delta
      continue
    }

    if (isNoise(line)) {
      // A closing brace is noise as output but still structural input.
      pendingComments = []
      depth += delta
      continue
    }

    // Top level: imports, exports and declarations.
    // One level in: class and interface member signatures.
    const keep = depth === 0 ? isAlways(line) || isDeclaration(line) : isMethodSignature(line)

    if (keep) {
      lastKeptLine = line
      const name = memberName(line)
      if (!flush(line, name, symbolLine)) break

      if (delta > 0) {
        // Walk the block this declaration opened and keep its member
        // signatures as a group, then close the whole thing together.
        //
        // Capturing members here rather than relying on depth on a later line
        // is what makes the skeleton stable under a second pass: a member
        // signature is only identifiable as one because of the class above
        // it, so emitting the closing brace first would orphan it.
        let local = delta
        // Number of blocks currently open *in the output*, and the deepest it
        // ever got. Both are measured from emitted lines only.
        let emittedDepth = delta
        let maxEmitted = delta
        let j = i + 1

        const isContainer = CONTAINER.test(lastKeptLine ?? '')

        for (; j < lines.length && local > 0; j++) {
          const inner = lines[j]
          const innerDelta = braceDelta(inner)
          const atMemberDepth = local === 1
          // Length of the output before this line, so a block opened by an
          // emitted line can be attributed to that line and not to a later one.
          const before = out.length

          // A comment is documentation only when it documents a member we are
          // about to keep. Inside a function body it is a comment about
          // dropped code, and keeping it leaves orphaned prose.
          if (isComment(inner)) {
            if (isContainer && atMemberDepth && (out.length < maxLines)) out.push(inner)
            else truncated = truncated || isContainer
          } else if (atMemberDepth && isContainer && isMemberLike(inner)) {
            if (out.length < maxLines) {
              out.push(inner)
              symbols.push({ name: memberName(inner) ?? '', line: j + 1 })
            } else {
              truncated = true
            }
          }

local += innerDelta
          // Track how many open blocks the *emitted* lines actually created,
          // not how deep the source went. A dropped `if { }` inside a body left
          // the braces it opened unaccounted for, so the closing pass emitted an
          // extra `}` and the skeleton did not balance.
          if (innerDelta > 0 && out.length > before) {
            emittedDepth += innerDelta
          }
          if (emittedDepth > maxEmitted) maxEmitted = emittedDepth
        }

        // Close exactly the blocks the skeleton opened, deepest first, each at
        // the indentation of the line that opened it. Balanced braces keep the
        // output readable and keep a second pass stable.
        for (let c = maxEmitted; c > 0; c--) {
          if (out.length >= maxLines) {
            truncated = true
            break
          }
          const indent = ' '.repeat(Math.max(0, indentOf(line) + 2 * (c - 1)))
          out.push(`${indent}}`)
        }

        i = j - 1
        // The whole block was consumed by the walk above, so `depth` must not
        // absorb `delta` as well. Doing both left depth permanently raised,
        // which made every later top-level declaration look like a class
        // member and silently dropped it.
        continue
      }
    } else {
      pendingComments = []
    }

    depth = Math.max(0, depth + delta)
    lastKeptLine = ''
  }

  return {
    text: out.join('\n'),
    symbols,
    linesKept: out.length,
    linesTotal: lines.length,
    truncated,
  }
}

// Pulls one symbol's declaration and its immediate body-signature. Used when a
// query names a specific function and the whole skeleton is still too much.
export function extractSymbol(text, name) {
  if (typeof text !== 'string' || !name) return null
  const lines = text.split('\n')
  const pattern = new RegExp(`\\b(?:function|class|interface|type|enum|def|struct|trait|const|let|var)\\s+${escapeRe(name)}\\b`)

  const start = lines.findIndex((l) => pattern.test(l))
  if (start === -1) return null

  const collected = [lines[start]]

  // Walk forward through the signature, which routinely spans several lines.
  let opens = countChar(lines[start], '{') + countChar(lines[start], '(')
  let closes = countChar(lines[start], '}') + countChar(lines[start], ')')

  for (let i = start + 1; i < lines.length && i < start + 40; i++) {
    collected.push(lines[i])
    opens += countChar(lines[i], '{') + countChar(lines[i], '(')
    closes += countChar(lines[i], '}') + countChar(lines[i], ')')
    if (opens > 0 && opens <= closes) break
  }

  return { name, startLine: start + 1, text: collected.join('\n') }
}

function countChar(line, ch) {
  let n = 0
  for (const c of line) if (c === ch) n++
  return n
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Language-agnostic entry points an agent usually wants first.
export function summarizeImports(text) {
  if (typeof text !== 'string') return []
  const out = []
  for (const line of text.split('\n')) {
    if (/^\s*(?:import|from|use|require|include)\b/.test(line)) out.push(line.trim())
    if (out.length >= 60) break
  }
  return out
}