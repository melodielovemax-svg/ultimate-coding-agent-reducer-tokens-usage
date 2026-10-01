import test from 'node:test'
import assert from 'node:assert/strict'
import { reduceContext, reduceText } from '../src/reducer/pipeline.mjs'
import { ANTHROPIC, GITHUB_TOKEN } from './fixtures/credentials.mjs'

const CODE = [
  'import express from "express"',
  '',
  '// Serves the user profile.',
  'export async function loadUser(id) {',
  '  const raw = await readFile("users/" + id, "utf8")',
  '  return JSON.parse(raw)',
  '}',
  '',
  'export function renderInvoice(order) {',
  '  return format(order.total)',
  '}',
].join('\n')

const KEY = ANTHROPIC

test('reduceContext requires a positive budget', () => {
  assert.throws(() => reduceContext([], {}), RangeError)
  assert.throws(() => reduceContext([], { budget: 0 }), RangeError)
  assert.throws(() => reduceContext([], { budget: -5 }), RangeError)
  assert.throws(() => reduceContext([], { budget: 'lots' }), RangeError)
})

test('reduceContext reports tokens in, out and the reduction', () => {
  const result = reduceContext([{ id: 'a.mjs', text: CODE }], { budget: 5000 })
  assert.ok(result.totals.tokensIn > 0)
  assert.ok(result.totals.tokensOut > 0)
  assert.ok(result.totals.tokensOut <= result.totals.tokensIn)
  assert.equal(result.totals.saved, result.totals.tokensIn - result.totals.tokensOut)
  assert.ok(result.totals.reduction >= 0)
})

test('reduceContext never exceeds the budget', () => {
  const items = Array.from({ length: 8 }, (_, i) => ({
    id: `file${i}.mjs`,
    text: `${CODE}\n${'// filler line\n'.repeat(40)}${i}`,
  }))
  const result = reduceContext(items, { budget: 400 })
  assert.ok(result.totals.tokensOut <= 400, `spent ${result.totals.tokensOut} of 400`)
})

test('reduceContext records which counter produced the numbers', () => {
  const result = reduceContext([{ id: 'a.mjs', text: CODE }], { budget: 1000 })
  assert.ok(['exact', 'estimated'].includes(result.totals.counter))
})

test('reduceContext redacts secrets before anything else sees them', () => {
  const result = reduceContext([{ id: 'config.mjs', text: `const k = "${KEY}"` }], { budget: 1000 })
  assert.ok(!result.output.includes(KEY), 'secret survived into the reducer output')
  assert.ok(result.findings.length > 0)
  assert.equal(result.findings[0].id, 'config.mjs')
})

test('a secret finding never carries the value', () => {
  const token = GITHUB_TOKEN
  const result = reduceContext([{ id: 'a.mjs', text: `token = "${token}"` }], { budget: 1000 })
  assert.ok(!JSON.stringify(result.findings).includes(token))
})

test('redacting a short credential does not report a negative saving', () => {
  // `[REDACTED]` is longer than the credential it replaces, so this stage can
  // increase the token count. Reporting that as a negative saving would look
  // like the stage cost tokens, which is noise rather than a measurement.
  const short = 'password = "abc123"'
  const result = reduceContext([{ id: 'a.mjs', text: short }], { budget: 1000 })
  const secrets = result.trace.find((s) => s.stage === 'secrets')
  assert.ok(secrets)
  assert.equal(secrets.saved, 0)
  assert.ok(secrets.findings > 0)
})

test('reduceContext drops a duplicate item', () => {
  const result = reduceContext(
    [
      { id: 'a.mjs', text: CODE },
      { id: 'copy.mjs', text: CODE },
    ],
    { budget: 5000 },
  )
  assert.equal(result.items.length, 1)
  assert.ok(result.dropped.some((d) => d.id === 'copy.mjs' && /duplicate/.test(d.reason)))
})

test('reduceContext skeletonizes code but not prose', () => {
  const code = reduceContext([{ id: 'a.mjs', text: CODE }], { budget: 5000 })
  const prose = reduceContext([{ id: 'notes.md', text: CODE }], { budget: 5000 })
  assert.ok(code.items[0].mode === 'skeleton')
  assert.ok(prose.items[0].mode === 'full')
})

test('reduceContext applies relevance only when given a query', () => {
  const withoutQuery = reduceContext([{ id: 'a.mjs', text: CODE }], { budget: 5000 })
  assert.ok(!withoutQuery.trace.some((s) => s.stage === 'relevance'))

  const withQuery = reduceContext([{ id: 'a.mjs', text: CODE }], {
    budget: 5000,
    query: 'renderInvoice',
  })
  assert.ok(withQuery.trace.some((s) => s.stage === 'relevance'))
})

test('the trace accounts for every stage it ran', () => {
  const result = reduceContext(
    [
      { id: 'a.mjs', text: CODE },
      { id: 'b.mjs', text: CODE },
    ],
    { budget: 200, query: 'renderInvoice' },
  )
  const stages = result.trace.map((s) => s.stage)
  assert.ok(stages.includes('dedupe'))
  assert.ok(stages.includes('skeletonize'))
  assert.ok(stages.includes('budget'))

  for (const entry of result.trace) {
    assert.equal(typeof entry.tokensBefore, 'number')
    assert.equal(typeof entry.tokensAfter, 'number')
    assert.equal(entry.saved, entry.tokensBefore - entry.tokensAfter)
  }
})

test('skipped stages are absent from the trace rather than reported as no-ops', () => {
  // Nothing to do: no query means no relevance stage, and a plain string is
  // not code so nothing is skeletonized.
  const plain = reduceContext([{ id: 'notes.md', text: 'a short note' }], { budget: 1000 })
  assert.deepEqual(plain.trace.map((s) => s.stage), ['budget'])
})

test('a stage that runs but saves nothing still appears in the trace', () => {
  // Relevance cannot shrink a single-line item, so saved is 0. The stage must
  // still be reported, or "did not help" is indistinguishable from "did not
  // run".
  const result = reduceContext([{ id: 'a.mjs', text: 'one line only' }], {
    budget: 1000,
    query: 'line',
  })
  const relevance = result.trace.find((s) => s.stage === 'relevance')
  assert.ok(relevance, 'relevance stage missing from the trace')
  assert.equal(relevance.saved, 0)
})

test('a dropped item always carries a reason', () => {
  const result = reduceContext(
    [
      { id: 'a.mjs', text: CODE },
      { id: 'b.mjs', text: CODE },
      { id: 'c.mjs', text: CODE },
    ],
    { budget: 20 },
  )
  for (const d of result.dropped) {
    assert.ok(d.reason.length > 0, `drop of ${d.id} has no reason`)
  }
})

test('reduceContext handles an empty item list', () => {
  const result = reduceContext([], { budget: 100 })
  assert.equal(result.items.length, 0)
  assert.equal(result.output, '')
  assert.equal(result.totals.tokensIn, 0)
  assert.equal(result.totals.reduction, 0)
})

test('reduceContext tolerates a missing text field', () => {
  const result = reduceContext([{ id: 'a.mjs' }], { budget: 100 })
  assert.equal(result.totals.tokensIn, 0)
})

test('the rendered output marks the stage that changed an item', () => {
  const result = reduceContext([{ id: 'a.mjs', text: CODE }], { budget: 5000 })
  assert.ok(result.output.includes('a.mjs'))
  assert.ok(result.output.includes('declarations only'))
})

test('a truncated item is marked in the output', () => {
  const long = Array.from({ length: 300 }, (_, i) => `export function fn${i}() { return ${i} }`).join('\n')
  const result = reduceContext([{ id: 'big.mjs', text: long }], { budget: 120 })
  assert.ok(result.output.includes('truncated'))
})

test('reduceText reduces a single string', () => {
  const result = reduceText(CODE, { budget: 5000 })
  assert.ok(result.totals.tokensIn > 0)
  assert.equal(result.items.length, 1)
})

test('the ultimate profile is registered alongside the others', async () => {
  const { PROFILES, PROFILE_NAMES } = await import('../src/profiles.mjs')
  assert.ok(PROFILE_NAMES.includes('ultimate'))
  assert.ok(PROFILES.ultimate)
  assert.ok(PROFILES.ultimate.opencode)
  assert.ok(PROFILES.ultimate.gemini)
  assert.ok(PROFILES.ultimate.description.length > 0)
})

test('the ultimate profile is stricter than extreme on every cap', async () => {
  const { PROFILES } = await import('../src/profiles.mjs')
  const u = PROFILES.ultimate
  const e = PROFILES.extreme

  assert.ok(u.opencode.tool_output.max_lines < e.opencode.tool_output.max_lines)
  assert.ok(u.opencode.tool_output.max_bytes < e.opencode.tool_output.max_bytes)
  assert.ok(u.opencode.compaction.tail_turns <= e.opencode.compaction.tail_turns)
  assert.ok(
    u.opencode.compaction.preserve_recent_tokens < e.opencode.compaction.preserve_recent_tokens,
  )
  assert.ok(u.gemini.contextManagement.historyWindow.maxTokens < e.gemini.contextManagement.historyWindow.maxTokens)
  assert.ok(u.gemini.model.compressionThreshold < e.gemini.model.compressionThreshold)
})
