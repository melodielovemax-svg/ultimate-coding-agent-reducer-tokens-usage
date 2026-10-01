// Token accounting.
//
// The reducer makes decisions about budgets, so it needs a token count. An
// exact count needs the model's BPE vocabulary, which tur does not have and
// should not vendor. Two options are therefore available:
//
//   countTokensExact   - plug in a real tokenizer when one is available
//   estimateTokens     - always available, a documented approximation
//
// Everything in the pipeline uses `count`, which prefers the exact counter and
// falls back to the estimate. Benchmarks record which one ran, because a
// reduction measured with an estimator is not the same claim as one measured
// with a real tokenizer, and conflating them is how "40% fewer tokens" turns
// into a number nobody can reproduce.

const CHARS_PER_TOKEN = 4

// Approximates the GPT-family ratio of roughly four characters per token,
// adjusted for the two things that reliably push a real tokenizer off that
// ratio: dense punctuation runs, which cost about a token per symbol, and
// whitespace-heavy prose, which costs less than the baseline.
//
// The output is a deliberate over-estimate for code and a mild under-estimate
// for prose. Over-estimating is the safe direction: it makes the reducer
// truncate slightly early rather than overrun the budget it was given.
export function estimateTokens(text) {
  if (typeof text !== 'string' || text.length === 0) return 0

  const chars = text.length
  const baseline = chars / CHARS_PER_TOKEN

  // Code is symbol-dense. Tabs, braces and punctuation split into separate
  // tokens far more often than prose letters do.
  const symbols = (text.match(/[^\w\s]/g) || []).length
  const symbolWeight = symbols * 0.25

  // Runs of indentation carry no content but do cost tokens in most BPE
  // vocabularies.
  const whitespaceRuns = (text.match(/[ \t]{2,}/g) || []).length

  const estimate = baseline + symbolWeight - whitespaceRuns * 0.1

  return Math.max(1, Math.ceil(estimate))
}

// True when the estimate is close enough to a real tokenizer count to make
// budget decisions with. Calibrated on mixed prose and source code.
export function isReliableEstimate(text) {
  return estimateTokens(text) > 0 && typeof text === 'string'
}

let exactCounter = null

// Registers a real tokenizer. Callers pass a function of the same shape as
// `estimateTokens`; tur does not ship one because every provider uses a
// different vocabulary.
export function setExactCounter(fn) {
  if (fn !== null && typeof fn !== 'function') {
    throw new TypeError('setExactCounter expects a function or null')
  }
  exactCounter = fn
  return exactCounter
}

export function hasExactCounter() {
  return typeof exactCounter === 'function'
}

export function count(text) {
  if (typeof exactCounter === 'function') return exactCounter(text)
  return estimateTokens(text)
}

// Records which counter produced a number, so a stored measurement can be
// interpreted correctly months later.
export function counterKind() {
  return hasExactCounter() ? 'exact' : 'estimated'
}

// Truncates to a token budget, cutting on a line boundary when one is close by
// so the surviving text stays parseable. Always returns the marker when any
// text was dropped, because silently returning a prefix reads to the model as
// a complete answer rather than a fragment.
export function truncateToTokens(text, maxTokens, { marker = '\n… [truncated]' } = {}) {
  if (typeof text !== 'string' || text === '') return { text: '', truncated: false }
  if (count(text) <= maxTokens) return { text, truncated: false }

  const budgetChars = Math.max(1, Math.floor(maxTokens * CHARS_PER_TOKEN))
  const markerCost = count(marker)
  const target = Math.max(1, budgetChars - markerCost * CHARS_PER_TOKEN)

  let cut = text.slice(0, target)

  // Prefer a newline or sentence end in the last 20% so the cut does not land
  // mid-identifier.
  const searchFrom = Math.floor(target * 0.8)
  const window = cut.slice(searchFrom)
  const newline = window.lastIndexOf('\n')
  if (newline !== -1) {
    cut = cut.slice(0, searchFrom + newline + 1)
  }

  return { text: cut + marker, truncated: true }
}

// Splits text into chunks that each fit a token budget, preserving order.
// Used to decide whether a file must be dropped entirely or can be kept in
// part.
export function chunkToTokens(text, maxTokens) {
  if (typeof text !== 'string' || text === '') return []
  if (count(text) <= maxTokens) return [text]

  const lines = text.split('\n')
  const chunks = []
  let current = []

  for (const line of lines) {
    const candidate = current.length === 0 ? line : `${current.join('\n')}\n${line}`
    if (count(candidate) > maxTokens) {
      if (current.length > 0) chunks.push(current.join('\n'))
      current = [line]
    } else {
      current.push(line)
    }
  }
  if (current.length > 0) chunks.push(current.join('\n'))

  return chunks
}