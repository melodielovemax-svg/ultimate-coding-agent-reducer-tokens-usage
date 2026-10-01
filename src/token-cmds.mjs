// Filesystem-facing commands for the `tur tokens` group.
//
// These read user files, so path handling is deliberately conservative: every
// resolved path is reported back to the caller, and directories are walked
// without following symlinks. A tool that rewrites context should never quietly
// follow a link out of the project.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'
import { reduceContext } from './reducer/pipeline.mjs'
import { count, counterKind } from './reducer/tokenize.mjs'
import { findSecrets } from './reducer/secrets.mjs'
import { findDuplicates } from './reducer/dedupe.mjs'
import { skeletonize } from './reducer/skeletonize.mjs'

// Extensions worth reading as context. Deliberately excludes binaries and
// lockfiles: a token count of a minified bundle is meaningless, and
// package-lock.json is mostly integrity hashes.
const TEXT_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.rb', '.go', '.rs',
  '.java', '.kt', '.swift', '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.php',
  '.scala', '.sh', '.bash', '.zsh', '.sql', '.vue', '.svelte', '.json', '.jsonc',
  '.yaml', '.yml', '.toml', '.md', '.txt', '.env', '.ini', '.cfg', '.xml', '.html', '.css',
])

const SKIP_DIRECTORIES = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next',
  '.tur', 'vendor', '__pycache__', '.venv', 'venv', 'target', '.cache',
])

const MAX_FILE_BYTES = 2 * 1024 * 1024

function isTextFile(path) {
  if (TEXT_EXTENSIONS.has(extname(path).toLowerCase())) return true
  // Extensionless files that are conventionally config: Dockerfile, Makefile.
  return false
}

// Walks `root` and returns { id, path, text } for readable text files.
//
// Symlinks are not followed: a link out of the project would pull in unrelated
// content, and a link into it could form a cycle.
function collectFiles(root, { maxFiles = 200 } = {}) {
  const out = []
  const rootResolved = resolve(root)

  const walk = (dir) => {
    if (out.length >= maxFiles) return

    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (out.length >= maxFiles) return
      if (entry.name.startsWith('.') && entry.name !== '.env') continue
      if (SKIP_DIRECTORIES.has(entry.name)) continue

      const full = join(dir, entry.name)

      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      if (!isTextFile(full)) continue

      try {
        const stat = statSync(full)
        if (stat.size > MAX_FILE_BYTES) continue

        out.push({
          id: relative(rootResolved, full).split(sep).join('/'),
          path: full,
          text: readFileSync(full, 'utf8'),
        })
      } catch {
        // Unreadable file: skip rather than abort the whole scan.
      }
    }
  }

  walk(rootResolved)
  return out
}

export const BUDGET_PRESETS = {
  small: 4_000,
  medium: 16_000,
  large: 64_000,
  xl: 256_000,
}

export function resolveBudget(requested) {
  if (requested === undefined || requested === null) return BUDGET_PRESETS.medium
  if (typeof requested === 'number' && Number.isFinite(requested) && requested > 0) return requested
  const key = String(requested).toLowerCase()
  if (BUDGET_PRESETS[key]) return BUDGET_PRESETS[key]
  const parsed = Number.parseInt(key, 10)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  throw new Error(
    `unknown budget "${requested}". use a preset (${Object.keys(BUDGET_PRESETS).join(', ')}) or a token count`,
  )
}

// Reports what the reducer would find, without producing reduced output.
// Separated from `optimize` so a caller can inspect cost and risk before
// anything is dropped.
export function analyze({ paths = ['.'], budget } = {}) {
  const limit = resolveBudget(budget)
  const files = []

  for (const p of paths) {
    let stat
    try {
      stat = statSync(p)
    } catch (err) {
      throw new Error(`cannot read "${p}": ${err.code ?? err.message}`)
    }
    if (stat.isDirectory()) files.push(...collectFiles(p))
    else if (isTextFile(p)) files.push({ id: p, path: p, text: readFileSync(p, 'utf8') })
    else files.push({ id: p, path: p, text: readFileSync(p, 'utf8') })
  }

  if (files.length === 0) {
    return { files: [], totals: { files: 0, tokens: 0, budget: limit, counter: counterKind() }, issues: [] }
  }

  const findings = []
  for (const file of files) {
    for (const f of findSecrets(file.text)) {
      findings.push({ id: file.id, ...f })
    }
  }

  const { dropped } = findDuplicates(files)
  const skeleton = files.map((f) => skeletonize(f.text))

  const rows = files.map((f, i) => ({
    id: f.id,
    tokens: count(f.text),
    skeletonTokens: count(skeleton[i].text),
    lines: f.text.split('\n').length,
    skeletonLines: skeleton[i].linesKept,
  }))

  const total = rows.reduce((s, r) => s + r.tokens, 0)
  const skeletonTotal = rows.reduce((s, r) => s + r.skeletonTokens, 0)
  const duplicated = rows.filter((r) => dropped.some((d) => d.id === r.id))

  return {
    files: rows.sort((a, b) => b.tokens - a.tokens),
    totals: {
      files: rows.length,
      tokens: total,
      skeletonTokens: skeletonTotal,
      duplicateTokens: duplicated.reduce((s, r) => s + r.tokens, 0),
      secrets: findings.length,
      budget: limit,
      counter: counterKind(),
      // Reported as the arithmetic consequence of the numbers above, never as
      // a measured saving: no model was called here.
      skeletonReduction: total > 0 ? 1 - skeletonTotal / total : 0,
      overBudget: total > limit,
    },
    issues: [...findings.map((f) => ({ kind: 'secret', ...f })), ...dropped.map((d) => ({ kind: 'duplicate', ...d }))],
  }
}

// Runs the full pipeline over paths and returns the reduced context.
export function optimize({ paths = ['.'], budget, query } = {}) {
  const limit = resolveBudget(budget)
  const files = analyze({ paths, budget: limit }).files.length > 0 ? collect(paths) : []

  if (files.length === 0) {
    return {
      output: '',
      items: [],
      trace: [],
      totals: { tokensIn: 0, tokensOut: 0, saved: 0, reduction: 0, counter: counterKind(), budget: limit, utilization: 0 },
      dropped: [],
      findings: [],
    }
  }

  const result = reduceContext(files, { budget: limit, query })

  return {
    output: result.output,
    items: result.items,
    trace: result.trace,
    totals: result.totals,
    dropped: result.dropped,
    findings: result.findings,
  }
}

function collect(paths) {
  const files = []
  for (const p of paths) {
    let stat
    try {
      stat = statSync(p)
    } catch (err) {
      throw new Error(`cannot read "${p}": ${err.code ?? err.message}`)
    }
    if (stat.isDirectory()) files.push(...collectFiles(p))
    else files.push({ id: p, path: p, text: readFileSync(p, 'utf8') })
  }
  return files
}

// A deterministic measurement over the project's own files.
//
// What this measures: how much context the reducer removes from this tree,
// measured with the current counter. What it does not measure: model quality,
// accuracy, or cost, because no model is called. Stating that limit is the
// point; a token reduction that silently implied a quality result would be a
// fabricated benchmark.
export function benchmark({ paths = ['.'], budget, repeats = 3 } = {}) {
  const limit = resolveBudget(budget)
  const runs = []

  for (let i = 0; i < Math.max(1, repeats); i++) {
    const result = optimize({ paths, budget: limit })
    runs.push({
      tokensIn: result.totals.tokensIn,
      tokensOut: result.totals.tokensOut,
      reduction: result.totals.reduction,
      stageSavings: Object.fromEntries(result.trace.map((t) => [t.stage, t.saved])),
    })
  }

  const reductions = runs.map((r) => r.reduction)
  const mean = reductions.reduce((a, b) => a + b, 0) / reductions.length
  const variance = reductions.reduce((a, b) => a + (b - mean) ** 2, 0) / reductions.length

  return {
    runs,
    summary: {
      meanReduction: mean,
      stdev: Math.sqrt(variance),
      // The pipeline is deterministic, so any spread is a determinism failure
      // rather than measurement noise. Reported instead of hidden.
      deterministic: Math.sqrt(variance) === 0,
    },
    totals: runs[0],
    counter: counterKind(),
    budget: limit,
    caveats: [
      'Measures context reduction only. No model was called.',
      `Token counts are ${counterKind()}, not a provider tokenizer.`,
      'A reduction in tokens is not a measured improvement in answer quality.',
    ],
  }
}
