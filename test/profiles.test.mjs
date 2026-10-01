import test from 'node:test'
import assert from 'node:assert/strict'
import { PROFILES, PROFILE_NAMES, OWNED_KEYS } from '../src/profiles.mjs'
import { resolvePlatforms, resolveProfile, resolveScope, PLATFORM_IDS } from '../src/index.mjs'
import { getPlatform } from '../src/platforms/index.mjs'

test('every profile covers both configurable platforms', () => {
  for (const name of PROFILE_NAMES) {
    assert.ok(PROFILES[name].opencode, `${name}.opencode`)
    assert.ok(PROFILES[name].gemini, `${name}.gemini`)
  }
})

test('every profile value referenced by OWNED_KEYS actually exists', () => {
  const get = (obj, dotted) => dotted.split('.').reduce((n, k) => (n == null ? undefined : n[k]), obj)
  for (const name of PROFILE_NAMES) {
    for (const key of OWNED_KEYS.opencode) {
      assert.notEqual(get(PROFILES[name].opencode, key), undefined, `${name} opencode ${key}`)
    }
    for (const key of OWNED_KEYS.gemini) {
      assert.notEqual(get(PROFILES[name].gemini, key), undefined, `${name} gemini ${key}`)
    }
  }
})

test('reducing profile is monotonically tighter than the one above it', () => {
  const pairs = [
    ['balanced', 'deep'],
    ['deep', 'extreme'],
  ]
  const get = (obj, dotted) => dotted.split('.').reduce((n, k) => (n == null ? undefined : n[k]), obj)

  for (const [loose, tight] of pairs) {
    const caps = [
      ['opencode', 'tool_output.max_lines'],
      ['opencode', 'tool_output.max_bytes'],
      ['opencode', 'compaction.tail_turns'],
      ['opencode', 'compaction.preserve_recent_tokens'],
      ['opencode', 'agent.build.steps'],
      ['gemini', 'model.maxSessionTurns'],
      ['gemini', 'model.compressionThreshold'],
      ['gemini', 'contextManagement.historyWindow.maxTokens'],
      ['gemini', 'contextManagement.messageLimits.normalMaxTokens'],
      ['gemini', 'contextManagement.tools.distillation.maxOutputTokens'],
    ]
    for (const [platform, key] of caps) {
      const a = get(PROFILES[loose][platform], key)
      const b = get(PROFILES[tight][platform], key)
      assert.ok(b < a, `${platform}.${key}: ${loose}=${a} should exceed ${tight}=${b}`)
    }
  }
})

test('compression threshold stays a valid fraction', () => {
  for (const name of PROFILE_NAMES) {
    const t = PROFILES[name].gemini.model.compressionThreshold
    assert.ok(t > 0 && t < 1, `${name} threshold ${t}`)
  }
})

test('normalizeHeadRatio stays a valid fraction', () => {
  for (const name of PROFILE_NAMES) {
    const r = PROFILES[name].gemini.contextManagement.messageLimits.normalizationHeadRatio
    assert.ok(r > 0 && r <= 1, `${name} ratio ${r}`)
  }
})

test('resolvePlatforms returns every platform for no argument', () => {
  assert.equal(resolvePlatforms(null).length, PLATFORM_IDS.length)
})

test('resolvePlatforms rejects unknown ids', () => {
  assert.throws(() => resolvePlatforms(['nope']), /unknown platform/)
})

test('resolvePlatforms accepts an explicit subset', () => {
  assert.deepEqual(resolvePlatforms(['opencode', 'gemini']).map((p) => p.id), ['opencode', 'gemini'])
})

test('resolveProfile defaults to deep and validates input', () => {
  assert.equal(resolveProfile(undefined), 'deep')
  assert.equal(resolveProfile('extreme'), 'extreme')
  assert.throws(() => resolveProfile('ludicrous'), /unknown profile/)
})

test('resolveScope defaults to global and validates input', () => {
  assert.equal(resolveScope(undefined), 'global')
  assert.throws(() => resolveScope('galaxy'), /unknown scope/)
})

test('every platform implements the full interface', () => {
  for (const id of PLATFORM_IDS) {
    const p = getPlatform(id)
    for (const fn of ['detect', 'targets', 'plan', 'apply', 'uninstall', 'status']) {
      assert.equal(typeof p[fn], 'function', `${id}.${fn}`)
    }
  }
})

test('every platform targets a path for both scopes', () => {
  for (const id of PLATFORM_IDS) {
    const p = getPlatform(id)
    for (const scope of ['global', 'project']) {
      const targets = p.targets(scope)
      assert.ok(targets.length > 0, `${id} ${scope} has no targets`)
      for (const t of targets) assert.ok(t.file.length > 0, `${id} ${scope} bad path`)
    }
  }
})

test('plan produces steps for both scopes', () => {
  for (const id of PLATFORM_IDS) {
    const p = getPlatform(id)
    for (const scope of ['global', 'project']) {
      const steps = p.plan('deep', scope)
      assert.ok(steps.length > 0, `${id} ${scope} produced no steps`)
      for (const s of steps) {
        assert.ok(s.file, `${id} ${scope} step missing file`)
        assert.ok(s.body || s.patch, `${id} ${scope} step missing payload`)
      }
    }
  }
})