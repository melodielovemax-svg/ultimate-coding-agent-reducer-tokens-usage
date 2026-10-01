// Deep merge used to layer a reduction profile on top of an existing user
// config without destroying unrelated keys.
//
// Arrays replace wholesale by default. `permission` style maps where later
// matching rules win get their object keys merged instead, which is what the
// caller wants when adding a pattern to an existing rule set.

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function deepMerge(base, patch) {
  if (!isPlainObject(base)) return clone(patch)
  if (!isPlainObject(patch)) return clone(patch)

  const out = { ...base }
  for (const [key, patchValue] of Object.entries(patch)) {
    if (!(key in out)) {
      out[key] = clone(patchValue)
      continue
    }
    const baseValue = out[key]
    if (Array.isArray(baseValue) || Array.isArray(patchValue)) {
      out[key] = clone(patchValue)
      continue
    }
    if (isPlainObject(baseValue) && isPlainObject(patchValue)) {
      out[key] = deepMerge(baseValue, patchValue)
      continue
    }
    out[key] = clone(patchValue)
  }
  return out
}

export function clone(value) {
  if (Array.isArray(value)) return value.map(clone)
  if (isPlainObject(value)) {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = clone(v)
    return out
  }
  return value
}

// Structural comparison. Reference equality is wrong here: a re-merged config
// rebuilds every array, so `!==` reports a change on every run and makes a
// clean install look like it rewrote the file.
export function deepEqual(a, b) {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]))
  }
  return false
}

// Flattens an object into dotted paths so a diff can report exact keys.
export function flatten(value, prefix = '', out = {}) {
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out)
    }
    return out
  }
  out[prefix] = value
  return out
}

export function diffPaths(before, after) {
  const a = flatten(before ?? {})
  const b = flatten(after ?? {})
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  const changes = []
  for (const key of keys) {
    if (!(key in a)) changes.push({ path: key, from: undefined, to: b[key] })
    else if (!(key in b)) changes.push({ path: key, from: a[key], to: undefined })
    else if (!deepEqual(a[key], b[key])) changes.push({ path: key, from: a[key], to: b[key] })
  }
  return changes
}