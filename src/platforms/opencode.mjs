import path from 'node:path'
import {
  applyConfig,
  home,
  exists,
  readConfig,
  rel,
  removeFromArray,
  removeKeys,
  removeManagedBlock,
  removeOwned,
  upsertManagedBlock,
  writeOwned,
} from '../fsutil.mjs'
import { PROFILES, OWNED_KEYS } from '../profiles.mjs'
import { RULES_BODY } from '../rules.mjs'

function globalDir() {
  return path.join(home(), '.config', 'opencode')
}

function globalConfig() {
  const dir = globalDir()
  const jsonc = path.join(dir, 'opencode.jsonc')
  return exists(jsonc) ? jsonc : path.join(dir, 'opencode.json')
}

// A filename tur reserves, so the body is written wholesale instead of fenced
// in a managed block. A managed block cannot work here: `instructions` would
// have to point at the same file on every run, and an older tur body sitting
// above the new one could never be told apart from a user's own edits.
const RULES_NAME = 'TOKEN-DISCIPLINE.md'
const RULES_REF = `~/.config/opencode/${RULES_NAME}`

// `instructions` is a list the user may already have entries in, and a deep
// merge would replace the whole array. Append instead, so installing never
// drops a path the user added by hand.
function withRulesEntry(existing) {
  const list = Array.isArray(existing?.instructions) ? existing.instructions : []
  if (list.includes(RULES_REF)) return list
  return [RULES_REF, ...list]
}

export default {
  id: 'opencode',
  label: 'opencode',

  detect() {
    return exists(globalDir())
  },

  targets(scope) {
    if (scope === 'global') {
      return [
        { kind: 'config', file: globalConfig() },
        { kind: 'owned', file: path.join(globalDir(), RULES_NAME) },
      ]
    }
    // Project scope has no reserved filename to write to and AGENTS.md is
    // hand-authored, so the rules go in a fenced block inside it.
    return [
      { kind: 'config', file: path.join(process.cwd(), 'opencode.json') },
      { kind: 'rules', file: path.join(process.cwd(), 'AGENTS.md') },
    ]
  },

  plan(profile, scope) {
    const [configTarget, rulesTarget] = this.targets(scope)

    // Only the global installer needs to register the rules file. Project
    // scope relies on opencode loading AGENTS.md on its own, and writing an
    // `instructions` key there would override the project's own list.
    const patch = { ...PROFILES[profile].opencode }
    if (scope === 'global') {
      patch.instructions = withRulesEntry(readConfig(configTarget.file))
    }

    return [
      { kind: rulesTarget.kind, file: rulesTarget.file, body: RULES_BODY },
      { kind: 'config', file: configTarget.file, patch },
    ]
  },

  apply(step, { dryRun } = {}) {
    if (step.kind === 'owned') return writeOwned(step.file, step.body, { dryRun })
    if (step.kind === 'rules') return upsertManagedBlock(step.file, step.body, { dryRun })
    return applyConfig(step.file, step.patch, { dryRun })
  },

  uninstall(scope, { dryRun } = {}) {
    const results = []
    const [configTarget, rulesTarget] = this.targets(scope)

    // Removing the file the entry points at while leaving the entry behind
    // would point opencode at a missing path, so drop just that one entry.
    // Entries the user had before installing survive.
    if (rulesTarget.kind === 'owned') {
      results.push(
        removeFromArray(configTarget.file, 'instructions', (v) => v === RULES_REF, { dryRun }),
      )
    }

    for (const target of [configTarget, rulesTarget]) {
      if (target.kind === 'owned') {
        results.push({ path: target.file, ...removeOwned(target.file, { dryRun }) })
      } else if (target.kind === 'rules') {
        results.push({ path: target.file, ...removeManagedBlock(target.file, { dryRun }) })
      } else {
        results.push(removeKeys(target.file, OWNED_KEYS.opencode, { dryRun }))
      }
    }
    return results
  },

  status(scope) {
    const [configTarget, rulesTarget] = this.targets(scope)
    const config = readConfig(configTarget.file)
    return {
      platform: this.id,
      configFile: rel(configTarget.file),
      configFound: exists(configTarget.file),
      rulesFile: rel(rulesTarget.file),
      rulesFound: exists(rulesTarget.file),
      active: Object.keys(config).length > 0,
      values: pick(config),
    }
  },
}

function pick(config) {
  const get = (obj, dotted) => dotted.split('.').reduce((n, k) => (n == null ? undefined : n[k]), obj)
  const out = {}
  for (const key of OWNED_KEYS.opencode) {
    const v = get(config, key)
    if (v !== undefined) out[key] = v
  }
  return out
}