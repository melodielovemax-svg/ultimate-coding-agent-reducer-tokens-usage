import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { removeOwned, writeOwned } from '../src/fsutil.mjs'

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tur-owned-'))
}

test('writeOwned creates the file and its parent directory', () => {
  const file = path.join(tmp(), 'deep', 'TOKEN-DISCIPLINE.md')

  const res = writeOwned(file, 'BODY')

  assert.equal(res.changed, true)
  assert.equal(fs.readFileSync(file, 'utf8'), 'BODY\n')
})

test('writeOwned replaces a previous body instead of appending', () => {
  const file = path.join(tmp(), 'TOKEN-DISCIPLINE.md')
  writeOwned(file, 'VERSION ONE\n\n## Reading files\n- old advice that must not linger')
  writeOwned(file, 'VERSION TWO')

  const text = fs.readFileSync(file, 'utf8')
  assert.equal(text, 'VERSION TWO\n')
  assert.ok(!text.includes('old advice'), 'stale body did not survive')
})

test('writeOwned is a no-op when the content already matches', () => {
  const file = path.join(tmp(), 'TOKEN-DISCIPLINE.md')
  writeOwned(file, 'BODY')

  assert.equal(writeOwned(file, 'BODY').changed, false)
})

test('writeOwned dryRun leaves the previous version in place', () => {
  const file = path.join(tmp(), 'TOKEN-DISCIPLINE.md')
  writeOwned(file, 'OLD')

  const res = writeOwned(file, 'NEW', { dryRun: true })

  assert.equal(res.changed, true)
  assert.equal(fs.readFileSync(file, 'utf8'), 'OLD\n')
})

test('writeOwned leaves no stale tur markers behind', () => {
  const file = path.join(tmp(), 'TOKEN-DISCIPLINE.md')
  writeOwned(file, `<!-- tur:begin -->\nOLD\n<!-- tur:end -->`)

  writeOwned(file, 'CLEAN')

  const text = fs.readFileSync(file, 'utf8')
  assert.ok(!text.includes('tur:begin'))
  assert.ok(!text.includes('tur:end'))
})

test('removeOwned deletes the file and reports the change', () => {
  const file = path.join(tmp(), 'TOKEN-DISCIPLINE.md')
  writeOwned(file, 'BODY')

  assert.equal(removeOwned(file).changed, true)
  assert.ok(!fs.existsSync(file))
  assert.equal(removeOwned(file).changed, false)
})

test('removeOwned dryRun keeps the file', () => {
  const file = path.join(tmp(), 'TOKEN-DISCIPLINE.md')
  writeOwned(file, 'BODY')

  removeOwned(file, { dryRun: true })

  assert.ok(fs.existsSync(file))
})