import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  BEGIN,
  END,
  applyConfig,
  readConfig,
  removeKeys,
  removeManagedBlock,
  upsertManagedBlock,
} from '../src/fsutil.mjs'

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tur-test-'))
}

test('applyConfig merges into an existing file and backs it up', () => {
  const dir = tmp()
  const file = path.join(dir, 'settings.json')
  fs.writeFileSync(file, JSON.stringify({ keep: 1, tool_output: { max_lines: 2000 } }))

  const res = applyConfig(file, { tool_output: { max_lines: 120 } })

  assert.equal(readConfig(file).keep, 1)
  assert.equal(readConfig(file).tool_output.max_lines, 120)
  assert.ok(fs.existsSync(`${file}.tur-backup`), 'backup written')
  assert.ok(res.changes.some((c) => c.path === 'tool_output.max_lines'))
})

test('applyConfig with dryRun writes nothing', () => {
  const dir = tmp()
  const file = path.join(dir, 'settings.json')
  fs.writeFileSync(file, JSON.stringify({ a: 1 }))

  applyConfig(file, { a: 2 }, { dryRun: true })

  assert.equal(readConfig(file).a, 1)
  assert.ok(!fs.existsSync(`${file}.tur-backup`))
})

test('applyConfig on a missing file creates it', () => {
  const dir = tmp()
  const file = path.join(dir, 'nested', 'settings.json')

  applyConfig(file, { a: 1 })

  assert.deepEqual(readConfig(file), { a: 1 })
})

test('applyConfig is idempotent', () => {
  const dir = tmp()
  const file = path.join(dir, 'settings.json')

  applyConfig(file, { a: 1, b: { c: 2 } })
  const second = applyConfig(file, { a: 1, b: { c: 2 } })

  assert.deepEqual(second.changes, [])
})

test('removeKeys deletes dotted paths and prunes empty parents', () => {
  const dir = tmp()
  const file = path.join(dir, 'settings.json')
  fs.writeFileSync(
    file,
    JSON.stringify({ keep: 1, model: { compressionThreshold: 0.5, name: 'x' } }),
  )

  removeKeys(file, ['model.compressionThreshold'])

  const after = readConfig(file)
  assert.deepEqual(after, { keep: 1, model: { name: 'x' } })
})

test('removeKeys tolerates a missing nested parent', () => {
  const dir = tmp()
  const file = path.join(dir, 'settings.json')
  fs.writeFileSync(file, JSON.stringify({ keep: 1 }))

  assert.doesNotThrow(() => removeKeys(file, ['model.compressionThreshold']))
  assert.deepEqual(readConfig(file), { keep: 1 })
})

test('managed block is inserted into an empty file', () => {
  const dir = tmp()
  const file = path.join(dir, 'AGENTS.md')

  upsertManagedBlock(file, 'BODY')

  const text = fs.readFileSync(file, 'utf8')
  assert.ok(text.includes(BEGIN))
  assert.ok(text.includes('BODY'))
})

test('managed block preserves surrounding user content', () => {
  const dir = tmp()
  const file = path.join(dir, 'AGENTS.md')
  fs.writeFileSync(file, '# My notes\n\nhand written.\n')

  upsertManagedBlock(file, 'BODY')
  const first = fs.readFileSync(file, 'utf8')
  assert.ok(first.includes('hand written.'))
  assert.ok(first.includes('BODY'))

  upsertManagedBlock(file, 'BODY2')
  const second = fs.readFileSync(file, 'utf8')
  assert.ok(second.includes('hand written.'))
  assert.ok(second.includes('BODY2'))
  assert.ok(!second.includes('BODY\n'), 'old body replaced, not duplicated')
})

test('managed block appears exactly once after repeated inserts', () => {
  const dir = tmp()
  const file = path.join(dir, 'AGENTS.md')

  for (let i = 0; i < 5; i++) upsertManagedBlock(file, `v${i}`)

  const text = fs.readFileSync(file, 'utf8')
  assert.equal(text.split(BEGIN).length - 1, 1)
  assert.equal(text.split(END).length - 1, 1)
  assert.ok(text.includes('v4'))
})

test('removing a managed block leaves user content and deletes an emptied file', () => {
  const dir = tmp()
  const withUser = path.join(dir, 'A.md')
  fs.writeFileSync(withUser, 'keep me\n')
  upsertManagedBlock(withUser, 'BODY')
  removeManagedBlock(withUser)
  assert.equal(fs.readFileSync(withUser, 'utf8').trim(), 'keep me')

  const onlyManaged = path.join(dir, 'B.md')
  upsertManagedBlock(onlyManaged, 'BODY')
  removeManagedBlock(onlyManaged)
  assert.ok(!fs.existsSync(onlyManaged), 'file removed when nothing else was in it')
})

test('removing a managed block from an unmanaged file is a no-op', () => {
  const dir = tmp()
  const file = path.join(dir, 'C.md')
  fs.writeFileSync(file, 'untouched\n')

  const res = removeManagedBlock(file)

  assert.equal(res.changed, false)
  assert.equal(fs.readFileSync(file, 'utf8'), 'untouched\n')
})