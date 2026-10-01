import path from 'node:path'
import {
  home,
  exists,
  rel,
  removeManagedBlock,
  removeOwned,
  upsertManagedBlock,
  writeOwned,
} from '../fsutil.mjs'
import { rulesForProfile, AGENTS_EXTRA } from '../rules.mjs'

// Copilot exposes no setting for context window size, tool-output caps, or
// compaction, so the instruction file is the only lever available. That is
// also where most of the savings come from: an agent told to grep before
// reading sends a fraction of the tokens one told to "look at the codebase"
// does.

function copilotHome() {
  return path.join(home(), '.copilot')
}

export default {
  id: 'copilot',
  label: 'GitHub Copilot',

  detect() {
    return exists(copilotHome()) || exists(path.join(process.cwd(), '.github'))
  },

  targets(scope) {
    if (scope === 'global') {
      return [
        // Both paths are names tur creates, so neither is fenced: a managed
        // block would strand a previous tur body in place after an upgrade.
        { kind: 'owned', file: path.join(copilotHome(), 'copilot-instructions.md') },
        { kind: 'owned', file: path.join(home(), '.config', 'github-copilot', 'instructions.md') },
      ]
    }
    return [
      // .github/copilot-instructions.md is a repo file a human may edit, so it
      // is fenced instead of overwritten.
      { kind: 'rules', file: path.join(process.cwd(), '.github', 'copilot-instructions.md') },
    ]
  },

  plan(profile, scope) {
    const targets = this.targets(scope)
    // Project scope also gets the workspace facts, since Copilot will not read
    // AGENTS.md unless the repo opts in.
    const rules = rulesForProfile(profile)
    const body = scope === 'global' ? rules : `${rules}\n${AGENTS_EXTRA.trim()}\n`
    return targets.map((t) => ({ kind: t.kind, file: t.file, body }))
  },

  apply(step, { dryRun } = {}) {
    if (step.kind === 'owned') return writeOwned(step.file, step.body, { dryRun })
    return upsertManagedBlock(step.file, step.body, { dryRun })
  },

  uninstall(scope, { dryRun } = {}) {
    return this.targets(scope).map((t) => ({
      path: t.file,
      ...(t.kind === 'owned'
        ? removeOwned(t.file, { dryRun })
        : removeManagedBlock(t.file, { dryRun })),
    }))
  },

  status(scope) {
    const target = this.targets(scope)[0]
    return {
      platform: this.id,
      configFile: 'no config surface',
      configFound: false,
      rulesFile: rel(target.file),
      rulesFound: exists(target.file),
      active: exists(target.file),
      values: exists(target.file) ? { instructions: 'installed' } : {},
    }
  },
}