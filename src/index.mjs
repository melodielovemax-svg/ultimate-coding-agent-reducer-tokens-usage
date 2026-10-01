import { PLATFORMS, PLATFORM_IDS, detected, getPlatform } from './platforms/index.mjs'
import { PROFILES, PROFILE_NAMES } from './profiles.mjs'

export { PLATFORMS, PLATFORM_IDS, detected, getPlatform }
export { PROFILES, PROFILE_NAMES }

// Resolves the platform list for a run. `all` picks up every platform this
// tool knows about, including ones with no install present, so a config can be
// staged before the tool exists.
export function resolvePlatforms(requested) {
  if (!requested || requested.length === 0 || requested.includes('all')) {
    return PLATFORMS
  }
  const out = []
  for (const id of requested) {
    const p = getPlatform(id)
    if (!p) {
      throw new Error(`unknown platform "${id}". known: ${PLATFORM_IDS.join(', ')}`)
    }
    out.push(p)
  }
  return out
}

export function resolveProfile(requested) {
  if (!requested) return 'deep'
  if (!PROFILE_NAMES.includes(requested)) {
    throw new Error(`unknown profile "${requested}". known: ${PROFILE_NAMES.join(', ')}`)
  }
  return requested
}

export const SCOPES = ['global', 'project']

export function resolveScope(requested) {
  if (!requested) return 'global'
  if (!SCOPES.includes(requested)) {
    throw new Error(`unknown scope "${requested}". known: ${SCOPES.join(', ')}`)
  }
  return requested
}