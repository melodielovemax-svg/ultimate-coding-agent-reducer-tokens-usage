import test from 'node:test'
import assert from 'node:assert/strict'
import { parseJsonc } from '../src/jsonc.mjs'

test('parses plain JSON', () => {
  assert.deepEqual(parseJsonc('{"a":1,"b":[1,2]}'), { a: 1, b: [1, 2] })
})

test('empty input yields empty object', () => {
  assert.deepEqual(parseJsonc('   \n  '), {})
})

test('strips line comments outside strings', () => {
  assert.deepEqual(parseJsonc('{\n // note\n "a": 1 // trailing\n}'), { a: 1 })
})

test('strips block comments', () => {
  assert.deepEqual(parseJsonc('{ /* multi\n line */ "a": 1 }'), { a: 1 })
})

test('keeps comment-like text inside strings', () => {
  assert.deepEqual(parseJsonc('{"url":"https://x.dev//path"}'), { url: 'https://x.dev//path' })
  assert.deepEqual(parseJsonc('{"s":"a /* not a comment */ b"}'), { s: 'a /* not a comment */ b' })
})

test('preserves escaped quotes', () => {
  assert.deepEqual(parseJsonc('{"s":"say \\"hi\\""}'), { s: 'say "hi"' })
})

test('drops trailing commas', () => {
  assert.deepEqual(parseJsonc('{"a":1,"b":2,}'), { a: 1, b: 2 })
  assert.deepEqual(parseJsonc('[1,2,3,]'), [1, 2, 3])
})

test('does not drop commas inside strings', () => {
  assert.deepEqual(parseJsonc('{"s":"a,}"}'), { s: 'a,}' })
})

test('throws on genuinely malformed input', () => {
  assert.throws(() => parseJsonc('{"a":'))
})