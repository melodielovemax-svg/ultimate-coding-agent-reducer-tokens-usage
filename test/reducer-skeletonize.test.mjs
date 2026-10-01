import test from 'node:test'
import assert from 'node:assert/strict'
import { skeletonize, extractSymbol, summarizeImports, braceDelta } from '../src/reducer/skeletonize.mjs'

const TS = `
import { readFile } from 'node:fs/promises'
import express from 'express'

// Serves the user profile.
export async function loadUser(id: string) {
  const raw = await readFile('users/' + id, 'utf8')
  const parsed = JSON.parse(raw)
  console.log('loading', id)
  return parsed
}

export class UserService {
  constructor(private repo: Repo) {}

  async find(id: string) {
    return this.repo.get(id)
  }
}

export interface Repo {
  get(id: string): Promise<User>
}

type User = { id: string; name: string }

export default express()
`

test('skeletonize drops function bodies but keeps declarations', () => {
  const result = skeletonize(TS)
  assert.ok(result.text.includes('export async function loadUser'))
  assert.ok(result.text.includes('export class UserService'))
  assert.ok(result.text.includes('export interface Repo'))
  assert.ok(!result.text.includes("await readFile('users/'"))
  assert.ok(!result.text.includes('console.log'))
})

test('skeletonize keeps imports', () => {
  const result = skeletonize(TS)
  assert.ok(result.text.includes("import { readFile } from 'node:fs/promises'"))
  assert.ok(result.text.includes("import express from 'express'"))
})

test('skeletonize records the symbols it found with line numbers', () => {
  const names = skeletonize(TS).symbols.map((s) => s.name)
  for (const expected of ['loadUser', 'UserService', 'Repo', 'User']) {
    assert.ok(names.includes(expected), `expected symbol ${expected}, got ${names.join(', ')}`)
  }
  for (const symbol of skeletonize(TS).symbols) {
    assert.ok(symbol.line >= 1)
  }
})

test('skeletonize keeps a comment that documents a declaration', () => {
  const result = skeletonize(TS)
  assert.ok(result.text.includes('// Serves the user profile.'))
})

test('skeletonize reports fewer kept lines than total', () => {
  const result = skeletonize(TS)
  assert.ok(result.linesKept < result.linesTotal)
  assert.ok(result.linesKept > 0)
})

test('skeletonize respects maxLines and flags truncation', () => {
  const result = skeletonize(TS, { maxLines: 3 })
  assert.ok(result.linesKept <= 3)
  assert.equal(result.truncated, true)
})

test('every skeleton is brace balanced', () => {
  const src = [
    'export class Widget {',
    '  build() {',
    '    if (this.ok) {',
    '      return 1',
    '    }',
    '    return 0',
    '  }',
    '  async run() {',
    '    for (const x of this.list) {',
    '      this.use(x)',
    '    }',
    '  }',
    '}',
    'export function top() {',
    '  try {',
    '    work()',
    '  } catch (e) {',
    '    report(e)',
    '  }',
    '}',
  ].join('\n')

  const result = skeletonize(src)
  let depth = 0
  for (const line of result.text.split('\n')) {
    depth += braceDelta(line)
  }
  assert.equal(depth, 0, `skeleton is unbalanced by ${depth}:\n${result.text}`)
})

test('skeletonize handles empty and non-string input', () => {
  assert.deepEqual(skeletonize(''), {
    text: '',
    symbols: [],
    linesKept: 0,
    linesTotal: 0,
    truncated: false,
  })
  assert.equal(skeletonize(null).text, '')
})

test('a bare closing brace inside a body is never emitted as a member', () => {
  const src = [
    'export class Widget {',
    '  build() {',
    '    if (this.ok) {',
    '      return 1',
    '    }',
    '    return 0',
    '  }',
    '}',
  ].join('\n')
  const result = skeletonize(src)
  // Exactly one closer for the class and one for build(). The `}` inside the
  // if-block and the top-level `}` must not leak through.
  assert.equal(result.text.split('\n').filter((l) => l.trim() === '}').length, 2)
  assert.ok(!result.text.includes('return 1'))
})

test('a comment inside a function body is dropped', () => {
  const src = [
    '// Documents the function.',
    'export function run() {',
    '  // Explains an implementation detail.',
    '  const x = 1',
    '  return x',
    '}',
  ].join('\n')
  const result = skeletonize(src)
  assert.ok(result.text.includes('// Documents the function.'))
  assert.ok(!result.text.includes('Explains an implementation detail'))
})

test('skeletonize removes the bulk of a realistic module', () => {
  const src = [
    "import { readFileSync } from 'node:fs'",
    '',
    'export function readConfig(path) {',
    ...Array.from({ length: 80 }, (_, i) => `  const line${i} = parseLine(source, ${i})`),
    '  return build(source)',
    '}',
  ].join('\n')
  const result = skeletonize(src)
  assert.ok(result.linesKept < 10, `expected a small skeleton, kept ${result.linesKept} lines`)
})

test('extractSymbol returns the declaration and its signature', () => {
  const result = extractSymbol(TS, 'loadUser')
  assert.ok(result)
  assert.ok(result.text.includes('export async function loadUser'))
  assert.ok(result.startLine >= 1)
})

test('extractSymbol returns null for a name that is not there', () => {
  assert.equal(extractSymbol(TS, 'doesNotExist'), null)
  assert.equal(extractSymbol(TS, ''), null)
})

test('extractSymbol escapes a regex metacharacter in the name', () => {
  // The literal name `a.b` must match only `a.b`, never `axb`.
  const text = 'function axb() { return 1 }'
  assert.equal(extractSymbol(text, 'a.b'), null)
  assert.ok(extractSymbol(text, 'axb'))
})

test('summarizeImports collects import lines up to a cap', () => {
  const lines = summarizeImports(TS)
  assert.equal(lines.length, 2)
  assert.ok(lines[0].startsWith('import'))
})

test('summarizeImports caps a long list', () => {
  const many = Array.from({ length: 200 }, (_, i) => `import m${i} from 'm${i}'`).join('\n')
  assert.equal(summarizeImports(many).length, 60)
})

test('skeletonize keeps python declarations', () => {
  const py = 'import os\n\ndef load_user(uid):\n    print(uid)\n    return os.get(uid)\n\nclass Repo:\n    pass\n'
  const result = skeletonize(py)
  assert.ok(result.text.includes('def load_user(uid):'))
  assert.ok(result.text.includes('class Repo:'))
  assert.ok(!result.text.includes('print(uid)'))
})
