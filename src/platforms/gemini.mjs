import path from 'node:path'
import {
  applyConfig,
  home,
  exists,
  rel,
  surgicalRemove,
  removeManagedBlock,
  readConfig,
  upsertManagedBlock,
} from '../fsutil.mjs'
import { PROFILES, OWNED_KEYS } from '../profiles.mjs'
import { CONTEXT_FILES, rulesForProfile } from '../rules.mjs'

function geminiHome() {
  return path.join(home(), '.gemini')
}

// The context file list accepts one name or several. Reading AGENTS.md first
// keeps the rules in scope for repos that already standardise on it, without
// dropping a GEMINI.md the user maintains.
function withContextEntry(existing) {
  const current = existing?.context?.fileName
  const list = Array.isArray(current) ? current : typeof current === 'string' ? [current] : []
  if (list.some((f) => CONTEXT_FILES.includes(f))) return list
  return [...CONTEXT_FILES, ...list]
}

export default {
  id: 'gemini',
  label: 'Gemini CLI',

  detect() {
    return exists(geminiHome())
  },

  targets(scope) {
    if (scope === 'global') {
      return [
        { kind: 'config', file: path.join(geminiHome(), 'settings.json') },
        { kind: 'rules', file: path.join(geminiHome(), 'GEMINI.md') },
      ]
    }
    return [
      { kind: 'config', file: path.join(process.cwd(), '.gemini', 'settings.json') },
      // Project scope writes into AGENTS.md, the cross-tool convention, and
      // registers it as a context file rather than creating a GEMINI.md the
      // other agents would never read.
      { kind: 'rules', file: path.join(process.cwd(), 'AGENTS.md') },
    ]
  },

  plan(profile, scope) {
    const [configTarget, rulesTarget] = this.targets(scope)
    const patch = deepMergeContext(
      PROFILES[profile].gemini,
      readConfig(configTarget.file),
    )
    return [
      { kind: 'rules', file: rulesTarget.file, body: rulesForProfile(profile) },
      { kind: 'config', file: configTarget.file, patch },
    ]
  },

  apply(step, { dryRun } = {}) {
    if (step.kind === 'rules') return upsertManagedBlock(step.file, step.body, { dryRun })
    return applyConfig(step.file, step.patch, { dryRun })
  },

  uninstall(scope, { dryRun } = {}) {
    const results = []
    for (const target of this.targets(scope)) {
      if (target.kind === 'rules') {
        results.push({ path: target.file, ...removeManagedBlock(target.file, { dryRun }) })
      } else {
        // `context.fileName` is shared with the user: the owned keys are removed,
        // and only tur's own entry is dropped from the list, so entries the user
        // added before install survive. One call, so the reported diff is the
        // state after both operations rather than the state between them.
        results.push(
          surgicalRemove(
            target.file,
            OWNED_KEYS.gemini,
            [{ key: 'context.fileName', drop: (f) => CONTEXT_FILES.includes(f) }],
            { dryRun },
          ),
        )
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

// `context.fileName` is a list the user may already have entries in, so it is
// read from the live config and prepended rather than replaced by the profile.
function deepMergeContext(patch, existing) {
  return {
    ...patch,
    context: { ...patch.context, fileName: withContextEntry(existing) },
  }
}

function pick(config) {
  const get = (obj, dotted) => dotted.split('.').reduce((n, k) => (n == null ? undefined : n[k]), obj)
  const out = {}
  for (const key of OWNED_KEYS.gemini) {
    const v = get(config, key)
    if (v !== undefined) out[key] = v
  }
  return out
}