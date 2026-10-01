import test from 'node:test'
import assert from 'node:assert/strict'
import {
  estimateTokens,
  count,
  counterKind,
  setExactCounter,
  hasExactCounter,
  truncateToTokens,
  chunkToTokens,
} from '../src/reducer/tokenize.mjs'

test('estimateTokens returns 0 for empty and non-string input', () => {
  assert.equal(estimateTokens(''), 0)
  assert.equal(estimateTokens(null), 0)
  assert.equal(estimateTokens(undefined), 0)
  assert.equal(estimateTokens(42), 0)
})

test('estimateTokens never returns 0 for non-empty text', () => {
  assert.ok(estimateTokens('x') >= 1)
})

test('estimateTokens grows monotonically with text length', () => {
  const short = estimateTokens('hello world')
  const long = estimateTokens('hello world '.repeat(50))
  assert.ok(long > short * 10)
})

test('symbol-dense code estimates above the chars/4 baseline', () => {
  const code = 'const a={x:1,y:2,z:[3,4],f:(n)=>n*2};'
  assert.ok(estimateTokens(code) > code.length / 4)
})

test('exact counter overrides the estimator and is reported as exact', () => {
  const previous = hasExactCounter()
  try {
    setExactCounter(() => 7)
    assert.equal(hasExactCounter(), true)
    assert.equal(counterKind(), 'exact')
    assert.equal(count('anything at all'), 7)
    assert.equal(truncateToTokens('short', 100).text, 'short')
  } finally {
    setExactCounter(previous ? previous : null)
  }
})

test('counterKind is estimated when no exact counter is registered', () => {
  const previous = hasExactCounter()
  try {
    setExactCounter(null)
    assert.equal(counterKind(), 'estimated')
  } finally {
    if (previous) setExactCounter(previous)
  }
})

test('setExactCounter rejects a non-function', () => {
  assert.throws(() => setExactCounter(42), TypeError)
})

test('truncateToTokens leaves text that already fits untouched', () => {
  const result = truncateToTokens('short text', 10_000)
  assert.equal(result.truncated, false)
  assert.equal(result.text, 'short text')
})

test('truncateToTokens marks and shrinks text that does not fit', () => {
  const long = 'line of content\n'.repeat(200)
  const result = truncateToTokens(long, 50)
  assert.equal(result.truncated, true)
  assert.ok(count(result.text) <= 50)
  assert.ok(result.text.includes('[truncated]'))
})

test('truncateToTokens output is always smaller than its input when truncating', () => {
  const long = 'x'.repeat(5000)
  const result = truncateToTokens(long, 20)
  assert.ok(result.text.length < long.length)
})

test('truncateToTokens handles empty input', () => {
  assert.deepEqual(truncateToTokens('', 100), { text: '', truncated: false })
})

test('chunkToTokens returns the whole text as one chunk when it fits', () => {
  assert.deepEqual(chunkToTokens('a short file', 10_000), ['a short file'])
})

test('chunkToTokens splits a long text and preserves order', () => {
  const lines = Array.from({ length: 60 }, (_, i) => `line ${i}`)
  const chunks = chunkToTokens(lines.join('\n'), 20)
  assert.ok(chunks.length > 1)
  const rejoined = chunks.join('\n')
  for (const needle of ['line 0', 'line 30', 'line 59']) {
    assert.ok(rejoined.includes(needle), `expected ${needle} to survive chunking`)
  }
})

test('chunkToTokens returns no chunks for empty input', () => {
  assert.deepEqual(chunkToTokens('', 100), [])
})

test('counter injection does not break chunking after reset', () => {
  const previous = hasExactCounter()
  try {
    setExactCounter(() => 1_000_000)
    assert.deepEqual(chunkToTokens('anything', 10), ['anything'])
  } finally {
    setExactCounter(previous ? previous : null)
  }
})
