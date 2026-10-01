import test from 'node:test'
import assert from 'node:assert/strict'
import { allocate, allocateDocuments, splitBudget } from '../src/reducer/budget.mjs'

const charCount = (t) => t.length

test('splitBudget divides a budget across items', () => {
  const items = [{ tokens: 10 }, { tokens: 10 }, { tokens: 10 }]
  const alloc = splitBudget(items, 30)
  assert.equal(alloc.length, 3)
  assert.equal(alloc.reduce((a, b) => a + b, 0), 30)
})

test('splitBudget handles a zero budget without dividing by zero', () => {
  const alloc = splitBudget([{ tokens: 5 }], 0)
  assert.ok(alloc.every((n) => n >= 1))
})

test('splitBudget handles an empty item list', () => {
  assert.deepEqual(splitBudget([], 100), [])
})

test('splitBudget gives remainder to items that need it most', () => {
  const alloc = splitBudget([{ tokens: 100 }, { tokens: 3 }], 10)
  assert.ok(alloc[1] >= alloc[0])
})

test('allocate keeps items that fit and reports utilization', () => {
  const result = allocate([{ id: 'a', tokens: 10 }, { id: 'b', tokens: 10 }], 100)
  assert.equal(result.kept.length, 2)
  assert.equal(result.spent, 20)
  assert.ok(result.utilization < 1)
  assert.equal(result.dropped.length, 0)
})

test('allocate respects higher priority first', () => {
  const result = allocate(
    [
      { id: 'low', tokens: 50, priority: 0 },
      { id: 'high', tokens: 50, priority: 10 },
    ],
    60,
  )
  assert.ok(result.kept.some((k) => k.id === 'high'))
  assert.ok(!result.kept.some((k) => k.id === 'low'))
})

test('allocate truncates a text item that does not fit', () => {
  const result = allocate([{ id: 'a', tokens: 500, text: 'x'.repeat(500) }], 100, {
    truncate: (t, max) => ({ text: t.slice(0, max), truncated: true }),
    tokensOf: charCount,
  })
  assert.equal(result.truncated.length, 1)
  assert.equal(result.truncated[0].truncated, true)
  assert.ok(result.spent <= 100)
})

test('allocate drops a non-truncatable item rather than mangling it', () => {
  const result = allocate([{ id: 'a', tokens: 500, text: null }], 10, {
    truncate: (t, max) => ({ text: t.slice(0, max), truncated: true }),
  })
  assert.equal(result.kept.length, 0)
  assert.equal(result.dropped.length, 1)
  assert.match(result.dropped[0].reason, /truncatable/)
})

test('allocate records a reason for every drop', () => {
  const result = allocate([{ id: 'a', tokens: 5000, text: null }], 10, { truncate: () => ({ text: 'x' }) })
  assert.equal(result.dropped.length, 1)
  assert.ok(result.dropped[0].reason.length > 0)
  assert.equal(result.dropped[0].id, 'a')
})

test('allocate never exceeds the budget', () => {
  const result = allocate(
    [
      { id: 'a', tokens: 300, text: 'a'.repeat(300) },
      { id: 'b', tokens: 300, text: 'b'.repeat(300) },
      { id: 'c', tokens: 300, text: 'c'.repeat(300) },
    ],
    500,
    { truncate: (t, max) => ({ text: t.slice(0, max), truncated: true }), tokensOf: charCount },
  )
  assert.ok(result.spent <= 500, `spent ${result.spent} over a 500 budget`)
})

test('allocate returns results in caller order regardless of priority', () => {
  const result = allocate(
    [
      { id: 'first', tokens: 10, priority: 0 },
      { id: 'second', tokens: 10, priority: 10 },
    ],
    100,
  )
  assert.deepEqual(result.kept.map((k) => k.id), ['first', 'second'])
})

test('allocate reserves budget so the first item cannot starve the rest', () => {
  // The ceiling is a reservation for items not yet placed, not an absolute cap.
  // With a second item still to come, the first must not consume everything.
  const result = allocate(
    [
      { id: 'first', tokens: 1000, text: 'x'.repeat(1000) },
      { id: 'second', tokens: 200, text: 'y'.repeat(200) },
    ],
    1000,
    { truncate: (t, max) => ({ text: t.slice(0, max), truncated: true }), tokensOf: charCount },
  )

  const first = [...result.kept, ...result.truncated].find((k) => k.id === 'first')
  assert.ok(first.allocated < 1000, 'first item consumed the entire budget')
})

test('a single item is kept whole when it fits the budget exactly', () => {
  const result = allocate([{ id: 'only', tokens: 1000, text: 'x'.repeat(1000) }], 1000, {
    truncate: (t, max) => ({ text: t.slice(0, max), truncated: true }),
    tokensOf: charCount,
  })
  assert.equal(result.spent, 1000)
  assert.equal(result.truncated.length, 0)
})

test('a wider ceiling lets an early item keep more of the budget', () => {
  const items = [
    { id: 'first', tokens: 1000, text: 'x'.repeat(1000) },
    { id: 'second', tokens: 200, text: 'y'.repeat(200) },
  ]
  const narrow = allocate(items, 1000, {
    ceiling: 0.05,
    truncate: (t, max) => ({ text: t.slice(0, max), truncated: true }),
    tokensOf: charCount,
  })
  const wide = allocate(items, 1000, {
    ceiling: 0.9,
    truncate: (t, max) => ({ text: t.slice(0, max), truncated: true }),
    tokensOf: charCount,
  })

  const firstOf = (r) => [...r.kept, ...r.truncated].find((k) => k.id === 'first').allocated
  assert.ok(firstOf(wide) > firstOf(narrow))
})

test('allocate handles an empty item list', () => {
  const result = allocate([], 100)
  assert.equal(result.kept.length, 0)
  assert.equal(result.spent, 0)
  assert.equal(result.utilization, 0)
})

test('allocateDocuments measures text it was not given a count for', () => {
  const result = allocateDocuments([{ id: 'a', text: 'hello world' }], 100, { count: charCount })
  assert.equal(result.kept[0].tokens, 11)
})

test('allocateDocuments honours a supplied token count over measuring', () => {
  const result = allocateDocuments([{ id: 'a', text: 'hello world', tokens: 3 }], 100, {
    count: charCount,
  })
  assert.equal(result.kept[0].tokens, 3)
})
