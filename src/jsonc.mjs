// Minimal JSONC reader/writer. Removes comments and trailing commas while
// leaving string contents untouched, then parses the result as plain JSON.
//
// The trailing-comma pass has to run string-aware: a regex over the whole
// document corrupts values like {"s":"a,}" into {"s":"a}"}.

export function stripComments(text) {
  const out = []
  let i = 0
  const n = text.length
  let inString = false
  let inLine = false
  let inBlock = false

  while (i < n) {
    const ch = text[i]
    const next = text[i + 1]

    if (inLine) {
      if (ch === '\n') {
        inLine = false
        out.push(ch)
      }
      i++
      continue
    }

    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false
        i += 2
        continue
      }
      if (ch === '\n') out.push('\n')
      i++
      continue
    }

    if (inString) {
      out.push(ch)
      if (ch === '\\') {
        out.push(next ?? '')
        i += 2
        continue
      }
      if (ch === '"') inString = false
      i++
      continue
    }

    if (ch === '"') {
      inString = true
      out.push(ch)
      i++
      continue
    }

    if (ch === '/' && next === '/') {
      inLine = true
      i += 2
      continue
    }

    if (ch === '/' && next === '*') {
      inBlock = true
      i += 2
      continue
    }

    out.push(ch)
    i++
  }

  return out.join('')
}

export function stripTrailingCommas(text) {
  const out = []
  let i = 0
  const n = text.length
  let inString = false

  while (i < n) {
    const ch = text[i]

    if (inString) {
      out.push(ch)
      if (ch === '\\') {
        out.push(text[i + 1] ?? '')
        i += 2
        continue
      }
      if (ch === '"') inString = false
      i++
      continue
    }

    if (ch === '"') {
      inString = true
      out.push(ch)
      i++
      continue
    }

    if (ch === ',') {
      // Look ahead past whitespace for the next meaningful character. If it
      // closes an object or array, the comma is a trailing one.
      let j = i + 1
      while (j < n && /\s/.test(text[j])) j++
      if (text[j] === '}' || text[j] === ']') {
        i++
        continue
      }
    }

    out.push(ch)
    i++
  }

  return out.join('')
}

export function parseJsonc(text) {
  const clean = stripTrailingCommas(stripComments(text)).trim()
  if (clean === '') return {}
  return JSON.parse(clean)
}

export function stringify(value, indent = 2) {
  return JSON.stringify(value, null, indent)
}

export function toJsonc(value, indent = 2) {
  return stringify(value, indent) + '\n'
}