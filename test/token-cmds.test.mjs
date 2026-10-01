import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { analyze, optimize, benchmark, resolveBudget, BUDGET_PRESETS } from '../src/token-cmds.mjs'
import { ANTHROPIC } from './fixtures/credentials.mjs'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'tur-test-'))
  mkdirSync(join(root, 'src'))
  writeFileSync(
    join(root, 'src', 'a.mjs'),
    [
      'export function alpha() {',
      ...Array.from({ length: 40 }, (_, i) => `  const value${i} = compute(${i})`),
      '  return value0',
      '}',
    ].join('\n'),
  )
  writeFileSync(join(root, 'src', 'b.mjs'), 'export function beta() {\n  return 1\n}\n')
  writeFileSync(join(root, 'notes.md'), '# Notes\n\nSome prose about the project.\n')
  return root
}

test('resolveBudget accepts presets, numbers and numeric strings', () => {
  assert.equal(resolveBudget(undefined), BUDGET_PRESETS.medium)
  assert.equal(resolveBudget('small'), BUDGET_PRESETS.small)
  assert.equal(resolveBudget('xl'), BUDGET_PRESETS.xl)
  assert.equal(resolveBudget('2000'), 2000)
  assert.equal(resolveBudget(500), 500)
})

test('resolveBudget rejects nonsense', () => {
  assert.throws(() => resolveBudget('enormous'), /unknown budget/)
  assert.throws(() => resolveBudget(0))
  assert.throws(() => resolveBudget(-1))
})

test('analyze reports files, tokens and per-file rows', () => {
  const root = fixture()
  const result = analyze({ paths: [root] })
  assert.ok(result.files.length >= 3)
  assert.ok(result.totals.tokens > 0)
  assert.equal(result.totals.counter, 'estimated')
  assert.ok(result.files.every((f) => f.tokens > 0))
})

test('analyze sorts files largest first', () => {
  const result = analyze({ paths: [fixture()] })
  const tokens = result.files.map((f) => f.tokens)
  assert.deepEqual(tokens, [...tokens].sort((a, b) => b - a))
})

test('analyze flags an over-budget project', () => {
  const result = analyze({ paths: [fixture()], budget: 'small' })
  assert.equal(result.totals.overBudget, result.totals.tokens > result.totals.budget)
})

test('analyze finds a secret without revealing it', () => {
  const root = mkdtempSync(join(tmpdir(), 'tur-secret-'))
  const key = ANTHROPIC
  writeFileSync(join(root, 'config.mjs'), `const key = "${key}"\n`)

  const result = analyze({ paths: [root] })
  assert.equal(result.totals.secrets, 1)
  assert.ok(!JSON.stringify(result.issues).includes(key))
})

test('analyze skips node_modules and dotfiles', () => {
  const root = mkdtempSync(join(tmpdir(), 'tur-skip-'))
  mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
  writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1\n')
  writeFileSync(join(root, '.hidden.js'), 'const secretish = 1\n')
  writeFileSync(join(root, 'real.js'), 'export const real = 1\n')
  // Byte-identical to real.js, so it must also be reported as a duplicate.
  writeFileSync(join(root, 'copy.js'), 'export const real = 1\n')

  const result = analyze({ paths: [root] })
  assert.equal(result.issues.filter((i) => i.kind === 'duplicate').length, 1)
  const ids = result.files.map((f) => f.id)
  assert.ok(ids.includes('real.js'))
  assert.ok(!ids.some((id) => id.includes('node_modules')))
  assert.ok(!ids.some((id) => id.includes('.hidden')))
})

test('analyze does not follow symlinks', () => {
  const root = mkdtempSync(join(tmpdir(), 'tur-link-'))
  writeFileSync(join(root, 'real.js'), 'export const real = 1\n')

  let made = true
  try {
    // Creating symlinks on Windows needs privilege, so this is skipped rather
    // than failed where the OS refuses.
    symlinkSync(join(root, 'real.js'), join(root, 'loop.js'))
  } catch {
    made = false
  }
  if (!made) return

  const ids = analyze({ paths: [root] }).files.map((f) => f.id)
  assert.ok(ids.includes('real.js'))
  assert.ok(!ids.includes('loop.js'), 'analyze followed a symlink')
})

test('analyze on an empty directory reports zeroes, not an error', () => {
  const root = mkdtempSync(join(tmpdir(), 'tur-empty-'))
  const result = analyze({ paths: [root] })
  assert.equal(result.totals.files, 0)
  assert.equal(result.totals.tokens, 0)
})

test('analyze reports a missing path clearly', () => {
  assert.throws(() => analyze({ paths: ['does-not-exist-xyz'] }), /cannot read/)
})

test('optimize produces output within the budget', () => {
  const result = optimize({ paths: [fixture()], budget: 500 })
  assert.ok(result.totals.tokensOut <= 500, `spent ${result.totals.tokensOut} of 500`)
  assert.ok(result.output.length > 0)
})

test('optimize reports a per-stage trace that adds up', () => {
  const result = optimize({ paths: [fixture()], budget: 800 })
  assert.ok(result.trace.length > 0)
  assert.equal(result.totals.tokensIn, result.trace[0].tokensBefore)
  assert.equal(result.totals.tokensOut, result.trace[result.trace.length - 1].tokensAfter)
})

test('optimize applies a query', () => {
  const root = mkdtempSync(join(tmpdir(), 'tur-query-'))
  writeFileSync(join(root, 'a.js'), 'export function wanted() { return 1 }\nexport function ignored() { return 2 }\n')
  const result = optimize({ paths: [root], budget: 4000, query: 'wanted' })
  assert.ok(result.output.includes('wanted'))
})

test('optimize on an empty directory is a no-op, not a crash', () => {
  const root = mkdtempSync(join(tmpdir(), 'tur-empty2-'))
  const result = optimize({ paths: [root] })
  assert.equal(result.output, '')
  assert.equal(result.totals.tokensIn, 0)
  assert.equal(result.totals.reduction, 0)
})

test('benchmark is deterministic on the same input', () => {
  const root = fixture()
  const a = benchmark({ paths: [root], budget: 1000, repeats: 3 })
  const b = benchmark({ paths: [root], budget: 1000, repeats: 3 })
  assert.deepEqual(a.runs, b.runs)
  assert.equal(a.summary.deterministic, true)
  assert.equal(a.summary.stdev, 0)
})

test('benchmark reports its own limits', () => {
  const result = benchmark({ paths: [fixture()], budget: 1000, repeats: 1 })
  assert.ok(result.caveats.length >= 3)
  assert.ok(result.caveats.some((c) => /No model was called/.test(c)))
  assert.ok(result.caveats.some((c) => /not a measured improvement/.test(c)))
})

test('benchmark accepts a single repeat', () => {
  const result = benchmark({ paths: [fixture()], repeats: 1 })
  assert.equal(result.runs.length, 1)
})

test('a larger budget reduces less', () => {
  const root = fixture()
  const small = optimize({ paths: [root], budget: 300 })
  const large = optimize({ paths: [root], budget: 100_000 })
  assert.ok(small.totals.reduction >= large.totals.reduction)
})
