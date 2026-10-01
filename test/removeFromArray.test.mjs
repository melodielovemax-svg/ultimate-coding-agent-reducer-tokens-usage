import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readConfig, removeFromArray } from '../src/fsutil.mjs'

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tur-arr-'))
}

test('removes only the matching entry and keeps the rest', () => {
  const file = path.join(tmp(), 'opencode.jsonc')
  fs.writeFileSync(
    file,
    JSON.stringify({ instructions: ['./docs/style.md', '~/.config/opencode/TOKEN-DISCIPLINE.md', 'AGENTS.md'] }),
  )

  removeFromArray(file, 'instructions', (v) => String(v).endsWith('TOKEN-DISCIPLINE.md'))

  assert.deepEqual(readConfig(file).instructions, ['./docs/style.md', 'AGENTS.md'])
})

test('drops the key entirely when the last entry goes', () => {
  const file = path.join(tmp(), 'opencode.jsonc')
  fs.writeFileSync(file, JSON.stringify({ instructions: ['TOKEN-DISCIPLINE.md'], keep: 1 }))

  removeFromArray(file, 'instructions', (v) => String(v).endsWith('TOKEN-DISCIPLINE.md'))

  assert.deepEqual(readConfig(file), { keep: 1 })
})

test('no-ops when nothing matches', () => {
  const file = path.join(tmp(), 'opencode.jsonc')
  fs.writeFileSync(file, JSON.stringify({ instructions: ['AGENTS.md'] }))

  const res = removeFromArray(file, 'instructions', (v) => String(v).endsWith('TOKEN-DISCIPLINE.md'))

  assert.deepEqual(res.changes, [])
  assert.deepEqual(readConfig(file).instructions, ['AGENTS.md'])
})

test('no-ops when the key is absent or not an array', () => {
  const file = path.join(tmp(), 'opencode.jsonc')
  fs.writeFileSync(file, JSON.stringify({ instructions: 'AGENTS.md' }))

  assert.deepEqual(removeFromArray(file, 'instructions', () => true).changes, [])
  assert.deepEqual(removeFromArray(path.join(tmp(), 'missing.json'), 'instructions', () => true).changes, [])
})