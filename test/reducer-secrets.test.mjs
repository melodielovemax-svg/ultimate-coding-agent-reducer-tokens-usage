import test from 'node:test'
import assert from 'node:assert/strict'
import { redactSecrets, findSecrets, PLACEHOLDER } from '../src/reducer/secrets.mjs'
import {
  ANTHROPIC,
  AWS_ACCESS_KEY,
  GITHUB_TOKEN,
  SLACK_TOKEN,
  GOOGLE_API_KEY,
  STRIPE_KEY,
  JWT,
  PEM_LINES,
  ASSIGNED_SECRET,
} from './fixtures/credentials.mjs'

const KEY = ANTHROPIC

test('redactSecrets leaves empty and non-string input alone', () => {
  assert.deepEqual(redactSecrets(''), { text: '', findings: [], removed: 0 })
  assert.deepEqual(redactSecrets(null), { text: '', findings: [], removed: 0 })
})

test('redactSecrets removes an anthropic key and never returns it', () => {
  const input = `const key = "${KEY}";`
  const result = redactSecrets(input)
  assert.ok(!result.text.includes(KEY), 'secret survived redaction')
  assert.ok(result.text.includes(PLACEHOLDER))
  assert.equal(result.findings.length, 1)
})

test('a finding never contains the secret value', () => {
  const result = redactSecrets(`token: ${KEY}`)
  const serialized = JSON.stringify(result.findings)
  assert.ok(!serialized.includes(KEY), 'finding leaked the secret')
  assert.ok(!serialized.includes(KEY.slice(0, 12)), 'finding leaked a secret fragment')
})

test('the output of redactSecrets contains no trace of the secret', () => {
  const secrets = [KEY, AWS_ACCESS_KEY, GITHUB_TOKEN, SLACK_TOKEN, GOOGLE_API_KEY, STRIPE_KEY]
  for (const secret of secrets) {
    const result = redactSecrets(`const value = "${secret}"`)
    assert.ok(!result.text.includes(secret), `secret survived: ${secret.slice(0, 8)}`)
    assert.ok(result.findings.length > 0, `no finding for ${secret.slice(0, 8)}`)
  }
})

test('a multi-line private key block is removed in full', () => {
  const input = PEM_LINES.join('\n')
  const result = redactSecrets(input)
  assert.ok(!result.text.includes('MIIEow'))
  assert.equal(result.findings[0].rule, 'private-key-block')
})

test('a jwt is redacted as one unit', () => {
  const jwt = JWT
  const result = redactSecrets(`Authorization: Bearer ${jwt}`)
  assert.ok(!result.text.includes(jwt))
  assert.ok(result.findings.some((f) => f.rule === 'jwt'))
})

test('connection string credentials are redacted but the shape survives', () => {
  const result = redactSecrets('DATABASE_URL=postgres://admin:hunter2@db.internal:5432/app')
  assert.ok(!result.text.includes('hunter2'))
  assert.ok(result.text.includes('postgres://admin:'))
  assert.ok(result.text.includes('@db.internal'))
})

test('an assigned secret is redacted by key name even with an unknown format', () => {
  const result = redactSecrets(`api_key = ${ASSIGNED_SECRET}`)
  assert.ok(!result.text.includes(ASSIGNED_SECRET))
  assert.ok(result.findings.some((f) => f.rule === 'assigned-secret'))
})

test('password and token key names are both recognised', () => {
  for (const line of ['password = "correct-horse-battery"', 'token: "abcdef1234567890"', 'SECRET_KEY="zzzzyyyyxxxxwwww"']) {
    const result = redactSecrets(line)
    assert.ok(result.findings.some((f) => f.rule === 'assigned-secret'), `missed: ${line}`)
  }
})

test('environment variable references are not redacted', () => {
  const input = 'api_key: process.env.API_KEY\nsecret = "${SECRET_VALUE}"\ntoken = <your-token-here>'
  const result = redactSecrets(input)
  assert.equal(result.text, input)
  assert.equal(result.findings.length, 0)
})

test('short values and non-secret assignments are left alone', () => {
  const input = 'timeout = 30\nretries: 5\npassword: ""'
  const result = redactSecrets(input)
  assert.equal(result.text, input)
})

test('ordinary prose and code are not flagged', () => {
  const input = 'export function handler(req, res) {\n  return res.json({ ok: true })\n}'
  const result = redactSecrets(input)
  assert.equal(result.text, input)
  assert.equal(result.findings.length, 0)
})

test('the same secret twice yields two findings with one fingerprint', () => {
  const result = redactSecrets(`a = "${KEY}"\nb = "${KEY}"`)
  const assigned = result.findings.filter((f) => f.rule === 'anthropic-api-key')
  assert.equal(assigned.length, 2)
  assert.equal(assigned[0].fingerprint, assigned[1].fingerprint)
})

test('findings carry a line number and are sorted by line', () => {
  const result = redactSecrets(['ok', '', `key = "${KEY}"`, '', `other = "${KEY}"`].join('\n'))
  const lines = result.findings.map((f) => f.line)
  assert.deepEqual([...lines].sort((a, b) => a - b), lines)
  assert.ok(lines[0] >= 1)
})

test('findSecrets reports without rewriting', () => {
  const input = `const k = "${KEY}"`
  assert.ok(findSecrets(input).length > 0)
  assert.equal(input, `const k = "${KEY}"`)
})

test('redaction is not defeated by an adjacent character class', () => {
  const result = redactSecrets(`x${KEY}y`)
  assert.ok(!result.text.includes(KEY))
})
