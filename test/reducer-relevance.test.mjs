import test from 'node:test'
import assert from 'node:assert/strict'
import { rankLines, selectByRelevance, tokenizeQuery } from '../src/reducer/relevance.mjs'
import { setCounter } from '../src/reducer/relevance.mjs'

const CODE = [
  'import express from "express"',
  '',
  'export function loadUserProfile(id) {',
  '  const raw = readFileSync(id)',
  '  return JSON.parse(raw)',
  '}',
  '',
  'export function renderInvoice(order) {',
  '  return format(order.total)',
  '}',
].join('\n')

test('tokenizeQuery lowercases and drops stopwords', () => {
  const terms = tokenizeQuery('How does the user Profile LOADER work?')
  assert.ok(terms.includes('profile'))
  assert.ok(terms.includes('loader'))
  assert.ok(!terms.includes('the'))
  assert.ok(!terms.includes('does'))
})

test('tokenizeQuery handles empty and non-string input', () => {
  assert.deepEqual(tokenizeQuery(''), [])
  assert.deepEqual(tokenizeQuery(null), [])
})

test('rankLines puts the matching function first', () => {
  const { ranked } = rankLines(CODE, 'loadUserProfile')
  assert.ok(ranked.length > 0)
  assert.equal(ranked[0].index, 2)
  assert.ok(ranked[0].text.includes('loadUserProfile'))
})

test('rankLines returns nothing for a query that does not appear', () => {
  const { ranked } = rankLines(CODE, 'quantumTeleport')
  assert.equal(ranked.length, 0)
})

test('rankLines returns nothing when the query is empty', () => {
  assert.equal(rankLines(CODE, '').ranked.length, 0)
  assert.equal(rankLines('', 'anything').ranked.length, 0)
})

test('rankLines scores are descending', () => {
  const { ranked } = rankLines(CODE, 'function return loadUserProfile renderInvoice')
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].score >= ranked[i].score)
  }
})

test('rankLines expands a hit to neighbouring lines', () => {
  const withWindow = rankLines(CODE, 'loadUserProfile', { window: 1 })
  const indices = withWindow.ranked.map((r) => r.index)
  assert.ok(indices.includes(3), 'expected the line after the hit to be boosted')
})

test('rankLines can rank without a neighbour window', () => {
  const noWindow = rankLines(CODE, 'loadUserProfile', { window: 0 })
  assert.ok(noWindow.ranked.length > 0)
})

test('a term present in every line does not produce a negative score', () => {
  const repeated = Array.from({ length: 20 }, () => 'function handler() { return 1 }').join('\n')
  const { ranked } = rankLines(repeated, 'function handler return')
  assert.ok(ranked.every((r) => r.score > 0))
})

test('selectByRelevance keeps matching lines and marks the gaps', () => {
  // window 1 pulls in lines 6 and 8 around the hit at 7, leaving 0-5 skipped
  // and therefore requiring an elision marker.
  const result = selectByRelevance(CODE, 'renderInvoice', { window: 1 })
  assert.ok(result.text.includes('renderInvoice'))
  assert.ok(result.text.includes('…'), 'expected an elision marker for the skipped lines')
  assert.ok(result.selected.length > 0)
})

test('selectByRelevance with no window keeps only the matching line', () => {
  const result = selectByRelevance(CODE, 'renderInvoice', { window: 0 })
  assert.deepEqual(result.selected, [7])
  assert.ok(result.text.includes('export function renderInvoice(order) {'))
  assert.ok(result.text.includes('…'), 'leading and trailing gaps must both be marked')
})

test('a wider neighbour window keeps more context around a hit', () => {
  const narrow = selectByRelevance(CODE, 'renderInvoice', { window: 0 })
  const wide = selectByRelevance(CODE, 'renderInvoice', { window: 3 })
  assert.ok(wide.selected.length > narrow.selected.length)
})

test('selectByRelevance preserves original line order', () => {
  const result = selectByRelevance(CODE, 'renderInvoice loadUserProfile')
  const selected = result.selected
  assert.deepEqual([...selected].sort((a, b) => a - b), selected)
})

test('selectByRelevance returns the input untouched when nothing matches', () => {
  const result = selectByRelevance(CODE, 'nonexistentSymbol')
  assert.equal(result.text, CODE)
  assert.deepEqual(result.selected, [])
})

test('selectByRelevance drops the file when it cannot fit maxTokens', () => {
  setCounter((t) => t.length)
  try {
    const result = selectByRelevance(CODE, 'loadUserProfile', { maxTokens: 5 })
    assert.equal(result.text, '')
    assert.equal(result.truncated, true)
  } finally {
    setCounter(null)
  }
})

test('selectByRelevance keeps content that fits maxTokens', () => {
  setCounter((t) => t.length)
  try {
    const result = selectByRelevance(CODE, 'renderInvoice', { maxTokens: 100_000 })
    assert.ok(result.text.includes('renderInvoice'))
  } finally {
    setCounter(null)
  }
})

test('a longer query term is not starved by a shorter one', () => {
  const { ranked } = rankLines(CODE, 'loadUserProfile')
  const top = ranked[0]
  assert.ok(top.score > 0)
  assert.ok(top.text.includes('loadUserProfile'))
})
