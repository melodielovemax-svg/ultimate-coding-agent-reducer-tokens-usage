import path from 'node:path'
import {
  home,
  exists,
  readText,
  rel,
  removeManagedBlock,
  removeOwned,
  upsertManagedBlock,
  writeOwned,
} from '../fsutil.mjs'
import { RULES_BODY } from '../rules.mjs'

function geminiHome() {
  return path.join(home(), '.gemini')
}

// Reserved filename: tur owns the whole file, so the YAML header and the body
// are rewritten together. A managed block cannot be used here because
// Antigravity discards a rules/*.md file whose frontmatter is not byte-first.
const RULE_NAME = 'token-discipline.md'

// Activation mode decides the token cost:
//   manual          zero tokens until the rule is @-mentioned
//   model_decision  path + description only; body read on demand
//   always_on       full body injected on every turn
//
// A discipline file exists to shrink context, so it must not be always_on: that
// is the most expensive mode and it spends tokens restating the rules on every
// request. `manual` has a real floor, so it is the default. `balanced` opts
// into always_on for anyone who wants the discipline applied without having to
// remember to ask for it.
function modeFor(profile) {
  return profile === 'balanced' ? 'always_on' : 'manual'
}

function frontmatter(mode) {
  if (mode === 'manual') return '---\ntrigger: manual\n---'
  if (mode === 'always_on') return '---\ntrigger: always_on\n---'
  return [
    '---',
    'trigger: model_decision',
    'description: "Token discipline: read ranges not whole files, grep before reading, answer tersely. @mention to load."',
    '---',
  ].join('\n')
}

function ruleBody(mode) {
  return `${frontmatter(mode)}\n\n${RULES_BODY.trim()}\n`
}

function readMode(file) {
  if (!exists(file)) return null
  const m = readText(file).slice(0, 400).match(/trigger:\s*(\w+)/)
  return m ? m[1] : null
}

export default {
  id: 'antigravity',
  label: 'Antigravity CLI',

  detect() {
    return exists(path.join(geminiHome(), 'antigravity-cli'))
  },

  targets(scope) {
    if (scope === 'global') {
      return [
        {
          kind: 'owned',
          file: path.join(geminiHome(), 'antigravity-cli', 'rules', RULE_NAME),
        },
      ]
    }
    return [
      { kind: 'owned', file: path.join(process.cwd(), '.agents', 'rules', RULE_NAME) },
      { kind: 'rules', file: path.join(process.cwd(), 'AGENTS.md') },
    ]
  },

  plan(profile, scope) {
    const targets = this.targets(scope)
    const steps = [{ kind: 'owned', file: targets[0].file, body: ruleBody(modeFor(profile)) }]
    if (scope === 'project') {
      // The workspace rule is what actually enforces discipline everywhere,
      // since the reserved file defaults to manual activation.
      steps.push({ kind: 'rules', file: targets[1].file, body: RULES_BODY })
    }
    return steps
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
    const settings = path.join(geminiHome(), 'antigravity-cli', 'settings.json')
    const mode = readMode(target.file)
    return {
      platform: this.id,
      configFile: rel(settings),
      configFound: exists(settings),
      rulesFile: rel(target.file),
      rulesFound: exists(target.file),
      active: exists(target.file),
      values: mode ? { activationMode: mode } : {},
    }
  },
}