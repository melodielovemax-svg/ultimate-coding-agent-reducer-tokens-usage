import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { rulesForProfile, CONTEXT_FILES, AGENTS_EXTRA } from '../src/rules.mjs'
import { PROFILE_NAMES } from '../src/profiles.mjs'
import { surgicalRemove, writeConfig } from '../src/fsutil.mjs'

test('every profile has a rule body', () => {
  for (const name of PROFILE_NAMES) {
    const body = rulesForProfile(name)
    assert.equal(typeof body, 'string')
    assert.ok(body.length > 0, `${name} has an empty rule body`)
  }
})

test('an unknown profile falls back to deep', () => {
  assert.equal(rulesForProfile('nonexistent'), rulesForProfile('deep'))
})

test('a tighter profile gets a shorter body, not a bigger one', () => {
  // The rule text is injected on every request, so `ultimate` holds context so
  // small that the previous profile's body would eat the budget it protects.
  const lengths = PROFILE_NAMES.map((n) => rulesForProfile(n).length)
  const balanced = rulesForProfile('balanced').length
  const ultimate = rulesForProfile('ultimate').length
  assert.ok(ultimate < balanced, `ultimate (${ultimate}) not smaller than balanced (${balanced})`)
  assert.ok(Math.max(...lengths) === balanced)
})

test('rule bodies name the behaviour instead of restating the caps', () => {
  const body = rulesForProfile('deep')
  assert.match(body, /file:line/)
  // A number in the rule body would drift from profiles.mjs, which is the one
  // place the caps live.
  assert.doesNotMatch(body, /\d/)
})

test('workspace notes stay separate from the discipline rule', () => {
  assert.doesNotMatch(rulesForProfile('ultimate'), /build-advanced-ai-platform/)
  assert.match(AGENTS_EXTRA, /typecheck/)
})

test('CONTEXT_FILES is what install registers', () => {
  assert.ok(CONTEXT_FILES.includes('AGENTS.md'))
})

test('surgicalRemove drops one array entry and leaves the others', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tur-surgical-'))
  const file = path.join(dir, 'settings.json')
  writeConfig(file, {
    context: { fileName: ['AGENTS.md', 'CONTEXT.md', 'GEMINI.md'] },
    model: { maxSessionTurns: 20 },
  })

  const result = surgicalRemove(file, ['model.maxSessionTurns'], [
    { key: 'context.fileName', drop: (f) => f === 'AGENTS.md' },
  ])

  const after = JSON.parse(readFileSync(file, 'utf8'))
  assert.deepEqual(after.context.fileName, ['CONTEXT.md', 'GEMINI.md'])
  assert.equal(after.model, undefined)
  assert.ok(result.changes.length > 0)
})

test('surgicalRemove deletes the key when the last entry is dropped', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tur-surgical-'))
  const file = path.join(dir, 'settings.json')
  writeConfig(file, { context: { fileName: ['AGENTS.md'] } })

  surgicalRemove(file, [], [{ key: 'context.fileName', drop: (f) => f === 'AGENTS.md' }])

  // An empty `context: {}` left behind is noise in a config the user reads.
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {})
})

test('surgicalRemove ignores a non-array value instead of throwing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tur-surgical-'))
  const file = path.join(dir, 'settings.json')
  writeFileSync(file, JSON.stringify({ context: { fileName: 'AGENTS.md' } }))

  const result = surgicalRemove(file, [], [{ key: 'context.fileName', drop: () => true }])

  assert.deepEqual(result.changes, [])
})

test('dry-run reports the combined diff without writing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tur-surgical-'))
  const file = path.join(dir, 'settings.json')
  mkdirSync(dir, { recursive: true })
  const before = JSON.stringify({ context: { fileName: ['AGENTS.md'] }, model: { maxSessionTurns: 20 } })
  writeFileSync(file, before)

  const result = surgicalRemove(file, ['model.maxSessionTurns'], [
    { key: 'context.fileName', drop: (f) => f === 'AGENTS.md' },
  ], { dryRun: true })

  assert.equal(readFileSync(file, 'utf8'), before)
  // Both removals appear in one diff: the state after the operation, not the
  // state between two separate writes.
  const reported = result.changes.map((c) => c.path)
  assert.ok(reported.some((p) => p.includes('model.maxSessionTurns')))
  assert.ok(reported.some((p) => p.includes('fileName')))
})
