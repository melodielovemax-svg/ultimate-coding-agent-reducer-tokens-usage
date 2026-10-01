import { PROFILES, PROFILE_NAMES, OWNED_KEYS } from './profiles.mjs'

function get(obj, dotted) {
  return dotted.split('.').reduce((n, k) => (n == null ? undefined : n[k]), obj)
}

export function install({ platforms, profile, scope, dryRun }) {
  const out = {}
  for (const platform of platforms) {
    const results = []
    for (const step of platform.plan(profile, scope)) {
      const result = platform.apply(step, { dryRun })
      results.push({ path: result.path, ...result, kind: step.kind })
    }
    out[platform.id] = { platform: platform.label, results }
  }
  return out
}

export function uninstall({ platforms, scope, dryRun }) {
  const out = {}
  for (const platform of platforms) {
    const results = platform.uninstall(scope, { dryRun })
    out[platform.id] = { platform: platform.label, results }
  }
  return out
}

export function status({ platforms, scope }) {
  return platforms.map((p) => p.status(scope))
}

// One row per leaf value so the table stays readable. A row holding a whole
// object prints as a wall of JSON, which defeats the point of the command.
// One row per leaf so the table stays readable: a row holding a whole object
// prints as a wall of JSON, which defeats the point of the command.
function leafRows(platformKey, ownedKeys) {
  const rows = []
  const prefix = platformKey === 'gemini' ? 'gemini:' : ''

  const add = (key) => {
    rows.push({
      key: prefix + key,
      values: PROFILE_NAMES.map((p) => fmt(get(PROFILES[p][platformKey], key))),
    })
  }

  const walk = (key) => {
    const probe = get(PROFILES.extreme[platformKey], key)
    if (probe === undefined) return
    if (typeof probe === 'object' && probe !== null) {
      for (const child of Object.keys(probe)) walk(key ? `${key}.${child}` : child)
      return
    }
    add(key)
  }

  for (const key of ownedKeys) walk(key)
  return rows
}

export function explain(profileName) {
  if (!PROFILE_NAMES.includes(profileName)) {
    throw new Error(`unknown profile "${profileName}". known: ${PROFILE_NAMES.join(', ')}`)
  }

  const rows = [...leafRows('opencode', OWNED_KEYS.opencode), ...leafRows('gemini', OWNED_KEYS.gemini)]
  const keyWidth = Math.max(...rows.map((r) => r.key.length), 12)
  const colWidth = Math.max(...rows.flatMap((r) => r.values.map((v) => v.length)), 8)

  const pad = (s, n) => (s.length >= n ? s : s + ' '.repeat(n - s.length))
  const line = (cells) => '  ' + cells.map((c, i) => (i === 0 ? pad(c, keyWidth) : pad(c, colWidth))).join('  ').trimEnd()

  return [
    'profile comparison',
    'opencode caps are lines/bytes and token counts; gemini caps are tokens and 0-1 fractions',
    '',
    line(['setting', ...PROFILE_NAMES.map((p) => p.toUpperCase())]),
    '  ' + '-'.repeat(keyWidth) + '  ' + PROFILE_NAMES.map(() => '-'.repeat(colWidth)).join('  '),
    ...rows.map((r) => line([r.key, ...r.values])),
    '',
    'antigravity activation mode:  balanced=always_on  deep=manual  extreme=manual',
    'opencode global rules land in ~/.config/opencode/TOKEN-DISCIPLINE.md',
    'gemini/antigravity global rules land in ~/.gemini/',
  ].join('\n')
}

function fmt(v) {
  if (v === undefined) return '-'
  if (v === null) return 'null'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}