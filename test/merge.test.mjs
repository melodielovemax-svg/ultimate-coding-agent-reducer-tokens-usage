import test from 'node:test'
import assert from 'node:assert/strict'
import { deepMerge, diffPaths, flatten } from '../src/merge.mjs'

test('merges nested objects without dropping siblings', () => {
  const before = { tool_output: { max_lines: 2000, max_bytes: 51200 } }
  const after = deepMerge(before, { tool_output: { max_lines: 120 } })
  assert.deepEqual(after, { tool_output: { max_lines: 120, max_bytes: 51200 } })
})

test('adds keys that did not exist', () => {
  assert.deepEqual(deepMerge({}, { a: 1 }), { a: 1 })
})

test('arrays replace wholesale rather than concatenating', () => {
  assert.deepEqual(deepMerge({ a: [1, 2, 3] }, { a: [9] }), { a: [9] })
})

test('does not alias nested objects from the input', () => {
  const patch = { nested: { x: 1 } }
  const out = deepMerge({}, patch)
  out.nested.x = 99
  assert.equal(patch.nested.x, 1)
})

test('scalar overwrites object', () => {
  assert.deepEqual(deepMerge({ a: { b: 1 } }, { a: 5 }), { a: 5 })
})

test('flatten produces dotted paths', () => {
  assert.deepEqual(flatten({ a: { b: { c: 1 } }, d: 2 }), { 'a.b.c': 1, d: 2 })
})

test('diff reports added, removed and changed keys', () => {
  const changes = diffPaths({ a: 1, b: 2 }, { a: 9, c: 3 })
  assert.deepEqual(changes, [
    { path: 'a', from: 1, to: 9 },
    { path: 'b', from: 2, to: undefined },
    { path: 'c', from: undefined, to: 3 },
  ])
})

test('diff is empty for identical objects', () => {
  assert.deepEqual(diffPaths({ a: 1 }, { a: 1 }), [])
})