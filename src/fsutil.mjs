import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { deepMerge, diffPaths, isPlainObject } from './merge.mjs'
import { parseJsonc, toJsonc } from './jsonc.mjs'

export const home = () => os.homedir()

export function exists(p) {
  try {
    fs.accessSync(p)
    return true
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return false
    throw err
  }
}

export function readText(p) {
  return fs.readFileSync(p, 'utf8')
}

export function writeText(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content, 'utf8')
}

export function readConfig(p) {
  if (!exists(p)) return {}
  const raw = readText(p)
  try {
    const value = parseJsonc(raw)
    if (!isPlainObject(value)) throw new Error('config root must be an object')
    return value
  } catch (err) {
    const e = new Error(`${p} is not valid JSON: ${err.message}`)
    e.code = 'EBADJSON'
    throw e
  }
}

export function writeConfig(p, obj) {
  writeText(p, toJsonc(obj))
}

export function backup(p) {
  if (!exists(p)) return null
  const target = `${p}.tur-backup`
  fs.copyFileSync(p, target)
  return target
}

// Applies `patch` to the config at `p`, reporting the exact keys that moved.
export function applyConfig(p, patch, { dryRun = false } = {}) {
  const before = readConfig(p)
  const after = deepMerge(before, patch)
  const changes = diffPaths(before, after)
  if (!dryRun && changes.length > 0) {
    backup(p)
    writeConfig(p, after)
  }
  return { path: p, changes, before, after }
}

// Removes the keys named by `paths` (dotted) from the config at `p`.
export function removeKeys(p, paths, { dryRun = false } = {}) {
  const before = readConfig(p)
  if (Object.keys(before).length === 0) return { path: p, changes: [] }
  const after = structuredClone(before)
  for (const dotted of paths) {
    const parts = dotted.split('.')
    let node = after
    for (const part of parts.slice(0, -1)) {
      if (node === null || typeof node !== 'object') {
        node = undefined
        break
      }
      node = node[part]
    }
    if (node && typeof node === 'object') delete node[parts.at(-1)]
  }
  pruneEmpty(after)
  const changes = diffPaths(before, after)
  if (!dryRun && changes.length > 0) {
    backup(p)
    writeConfig(p, after)
  }
  return { path: p, changes }
}

function pruneEmpty(node) {
  if (Array.isArray(node)) return
  if (node === null || typeof node !== 'object') return
  for (const [k, v] of Object.entries(node)) {
    pruneEmpty(v)
    if (isEmptyObject(v)) delete node[k]
  }
}

function isEmptyObject(v) {
  if (Array.isArray(v)) return false
  if (v === null || typeof v !== 'object') return false
  return Object.keys(v).length === 0
}

// Markdown files carry a managed block so `uninstall` can excise exactly what
// was added and leave hand-written content untouched.
export const BEGIN = '<!-- tur:begin -->'
export const END = '<!-- tur:end -->'

export function upsertManagedBlock(p, body, { dryRun = false } = {}) {
  const block = `${BEGIN}\n${body.trim()}\n${END}`
  const current = exists(p) ? readText(p) : ''
  const start = current.indexOf(BEGIN)
  const end = current.indexOf(END)

  let next
  if (start !== -1 && end !== -1 && end > start) {
    next = current.slice(0, start) + block + current.slice(end + END.length)
    next = next.replace(/\n{3,}/g, '\n\n')
  } else {
    const prefix = current.trim()
    next = prefix === '' ? block + '\n' : `${current.replace(/\s*$/, '')}\n\n${block}\n`
  }

  if (!dryRun && next !== current) writeText(p, next)
  return { path: p, changed: next !== current }
}

// Fully-owned file: the tool created this path and rewrites it wholesale, so
// an older version of its own body can never linger as a stale duplicate.
// Used for files whose name the tool reserves (TOKEN-DISCIPLINE.md).
export function writeOwned(p, body, { dryRun = false } = {}) {
  const content = body.trim() + '\n'
  const current = exists(p) ? readText(p) : ''
  if (!dryRun && content !== current) writeText(p, content)
  return { path: p, changed: content !== current }
}

// Drops one entry from a top-level array-valued config key. Used when an
// installer added a path to `instructions` and that path's file is being
// deleted: the whole key must survive, since the user may have had entries in
// it before the install.
export function removeFromArray(p, key, predicate, { dryRun = false } = {}) {
  const before = readConfig(p)
  const list = before?.[key]
  if (!Array.isArray(list)) return { path: p, changes: [] }
  const kept = list.filter((v) => !predicate(v))
  if (kept.length === list.length) return { path: p, changes: [] }

  const after = { ...before, [key]: kept }
  if (kept.length === 0) {
    delete after[key]
  }
  const changes = diffPaths(before, after)
  if (!dryRun) {
    backup(p)
    writeConfig(p, after)
  }
  return { path: p, changes }
}

export function removeOwned(p, { dryRun = false } = {}) {
  if (!exists(p)) return { path: p, changed: false }
  if (!dryRun) fs.rmSync(p)
  return { path: p, changed: true }
}

export function removeManagedBlock(p, { dryRun = false } = {}) {
  if (!exists(p)) return { path: p, changed: false }
  const current = readText(p)
  const start = current.indexOf(BEGIN)
  const end = current.indexOf(END)
  if (start === -1 || end === -1 || end <= start) return { path: p, changed: false }
  let next = current.slice(0, start) + current.slice(end + END.length)
  next = next.replace(/\n{3,}/g, '\n\n')
  if (next.trim() === '') {
    if (!dryRun) fs.rmSync(p)
  } else if (!dryRun) {
    writeText(p, next)
  }
  return { path: p, changed: true }
}

export function rel(p) {
  const h = home()
  return p.startsWith(h) ? '~' + p.slice(h.length).replace(/\\/g, '/') : p
}