import test from 'node:test'
import assert from 'node:assert/strict'
import {
  simhash,
  hamming,
  shingleOverlap,
  findDuplicates,
  isExactDuplicate,
  DEFAULT_NEAR_DUP_DISTANCE,
} from '../src/reducer/dedupe.mjs'

const DOC = Array.from({ length: 40 }, (_, i) => `function handler${i}() { return ${i} }`).join('\n')

test('simhash is deterministic', () => {
  assert.deepEqual(simhash(DOC), simhash(DOC))
})

test('identical text has distance 0', () => {
  assert.equal(hamming(simhash(DOC), simhash(DOC)), 0)
})

test('identical text is detected as an exact duplicate', () => {
  assert.equal(isExactDuplicate(DOC, DOC), true)
})

test('whitespace and line-ending differences still count as identical', () => {
  const a = 'line one\r\nline two   \nline three'
  const b = 'line one\nline two\nline three'
  assert.equal(isExactDuplicate(a, b), true)
})

test('a small word edit is still detected as a near duplicate', () => {
  // A word edit, not a digit edit: single-character tokens are filtered out of
  // the hash, so changing `7` to `8` is invisible to it by design.
  const edited = DOC.replace('function handler12', 'function processInput12')
  assert.ok(hamming(simhash(DOC), simhash(edited)) <= DEFAULT_NEAR_DUP_DISTANCE)
  assert.ok(shingleOverlap(DOC, edited) >= 0.8)
})

test('unrelated documents are far apart', () => {
  const other = Array.from({ length: 40 }, (_, i) => `class Widget${i} implements Renderer { paint() {} }`).join('\n')
  assert.ok(hamming(simhash(DOC), simhash(other)) > DEFAULT_NEAR_DUP_DISTANCE)
})

test('isExactDuplicate returns false when one side is empty', () => {
  assert.equal(isExactDuplicate('', DOC), false)
  assert.equal(isExactDuplicate(DOC, '   '), false)
})

test('findDuplicates keeps the first occurrence and drops the repeat', () => {
  const result = findDuplicates([
    { id: 'a', text: DOC },
    { id: 'b', text: DOC },
  ])
  assert.deepEqual(result.kept, ['a'])
  assert.equal(result.dropped.length, 1)
  assert.equal(result.dropped[0].id, 'b')
  assert.equal(result.dropped[0].reason, 'exact')
  assert.equal(result.dropped[0].duplicateOf, 'a')
})

test('findDuplicates reports a near duplicate separately from an exact one', () => {
  const result = findDuplicates([
    { id: 'a', text: DOC },
    { id: 'exact', text: DOC },
    { id: 'near', text: DOC.replace('function handler12', 'function processInput12') },
  ])
  const reasons = Object.fromEntries(result.dropped.map((d) => [d.id, d.reason]))
  assert.equal(reasons.exact, 'exact')
  assert.equal(reasons.near, 'near')
})

test('findDuplicates keeps three distinct documents', () => {
  const result = findDuplicates([
    { id: 'a', text: 'export function alpha() { return 1 }' },
    { id: 'b', text: 'export class Beta { constructor() { this.x = 1 } }' },
    { id: 'c', text: 'SELECT id, name FROM users WHERE active = true ORDER BY name' },
  ])
  assert.equal(result.kept.length, 3)
  assert.equal(result.dropped.length, 0)
})

test('findDuplicates drops empty documents rather than keeping them', () => {
  const result = findDuplicates([
    { id: 'a', text: 'real content here' },
    { id: 'empty', text: '   \n  ' },
  ])
  assert.deepEqual(result.kept, ['a'])
  assert.equal(result.dropped[0].reason, 'empty')
})

test('findDuplicates tolerates a missing text field', () => {
  const result = findDuplicates([{ id: 'a' }, { id: 'b', text: 'something' }])
  assert.equal(result.dropped[0].id, 'a')
})

test('findDuplicates respects a custom distance', () => {
  // Measured: this pair sits at hamming 9, overlap 0.25. A tight distance
  // keeps both; a loose one treats the second as near, but only once the
  // overlap threshold is also relaxed.
  const a = Array.from({ length: 30 }, (_, i) => `shared line ${i}`).join('\n')
  const b = `${a}\n${Array.from({ length: 30 }, (_, i) => `unique tail ${i}`).join('\n')}`

  const strict = findDuplicates([{ id: 'a', text: a }, { id: 'b', text: b }], { distance: 2 })
  const loose = findDuplicates([{ id: 'a', text: a }, { id: 'b', text: b }], {
    distance: 20,
    overlap: 0.2,
  })

  assert.equal(strict.dropped.length, 0)
  assert.equal(loose.dropped.length, 1)
  assert.equal(loose.dropped[0].reason, 'near')
})

test('a hash collision alone never drops a document', () => {
  // SimHash converges on long documents, so a pair can hash close while sharing
  // almost no content. Overlap is what prevents that from being treated as a
  // duplicate: measured hamming 35 for this pair, so force the distance wide
  // enough that only overlap can reject it.
  const a = Array.from({ length: 60 }, (_, i) => `shared filler line number ${i}`).join('\n')
  const b = Array.from({ length: 60 }, (_, i) => `completely other content ${i * 7919}`).join('\n')

  assert.equal(shingleOverlap(a, b), 0)
  const result = findDuplicates([{ id: 'a', text: a }, { id: 'b', text: b }], { distance: 64 })
  assert.deepEqual(result.kept, ['a', 'b'])
  assert.equal(result.dropped.length, 0)
})

test('shingleOverlap is 1 for identical text and low for different text', () => {
  assert.equal(shingleOverlap(DOC, DOC), 1)
  assert.ok(shingleOverlap(DOC, 'something completely else entirely here') < 0.2)
})

test('findDuplicates respects a custom overlap threshold', () => {
  // Measured: hamming 9, overlap 0.25.
  const a = Array.from({ length: 30 }, (_, i) => `shared line ${i}`).join('\n')
  const b = `${a}\n${Array.from({ length: 30 }, (_, i) => `unique tail ${i}`).join('\n')}`

  const permissive = findDuplicates([{ id: 'a', text: a }, { id: 'b', text: b }], {
    distance: 20,
    overlap: 0.1,
  })
  const strict = findDuplicates([{ id: 'a', text: a }, { id: 'b', text: b }], {
    distance: 20,
    overlap: 0.99,
  })

  assert.equal(permissive.dropped.length, 1)
  assert.equal(strict.dropped.length, 0)
})

test('an empty document list is handled', () => {
  assert.deepEqual(findDuplicates([]), { kept: [], dropped: [] })
})
