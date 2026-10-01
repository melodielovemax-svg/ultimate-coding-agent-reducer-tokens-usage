// One-off validator: checks the configs tur writes against the official
// schemas published by each tool. Run with:
//
//   node scripts/validate-schemas.mjs
//
// Ajv is a devDependency of this script only; tur itself has no runtime deps.

import fs from 'node:fs'
import Ajv from 'ajv'

import opencode from '../src/platforms/opencode.mjs'
import gemini from '../src/platforms/gemini.mjs'
import { PROFILES, PROFILE_NAMES } from '../src/profiles.mjs'
import { parseJsonc, toJsonc } from '../src/jsonc.mjs'
import { deepMerge } from '../src/merge.mjs'

const SCHEMAS = {
  opencode: 'https://opencode.ai/config.json',
  gemini:
    'https://raw.githubusercontent.com/google-gemini/gemini-cli/main/schemas/settings.schema.json',
}

async function fetchSchema(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return res.json()
}

// opencode's schema is loaded over the network, so strip the external model
// $ref it carries; without the referenced document Ajv refuses to compile.
function derefModel(node) {
  if (Array.isArray(node)) return node.map(derefModel)
  if (node && typeof node === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && String(v).includes('models.dev')) continue
      out[k] = derefModel(v)
    }
    return out
  }
  return node
}

function build(existing, patch) {
  return deepMerge(existing, patch)
}

const results = []
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false, validateSchema: false })

for (const id of Object.keys(SCHEMAS)) {
  const platform = id === 'opencode' ? opencode : gemini
  const key = id === 'opencode' ? 'opencode' : 'gemini'

  let schema
  try {
    schema = derefModel(await fetchSchema(SCHEMAS[id]))
  } catch (err) {
    results.push({ id, ok: false, note: `schema fetch failed: ${err.message}` })
    continue
  }

  const validate = ajv.compile(schema)

  // Start from whatever the machine already has, so the check covers the real
  // merged shape rather than an empty object.
  const configFile = platform.targets('global')[0].file
  const existing = fs.existsSync(configFile) ? parseJsonc(fs.readFileSync(configFile, 'utf8')) : {}

  for (const profile of PROFILE_NAMES) {
    const merged = build(existing, PROFILES[profile][key])
    const text = toJsonc(merged)

    let reparsed
    try {
      reparsed = parseJsonc(text)
    } catch (err) {
      results.push({ id, profile, ok: false, note: `emitted JSONC does not reparse: ${err.message}` })
      continue
    }

    if (!validate(reparsed)) {
      results.push({
        id,
        profile,
        ok: false,
        note: validate.errors.map((e) => `${e.instancePath || '/'} ${e.message}`).join('; '),
      })
      continue
    }
    results.push({ id, profile, ok: true, note: 'valid' })
  }
}

let failures = 0
for (const r of results) {
  if (!r.ok) failures++
  const tag = r.ok ? 'PASS' : 'FAIL'
  console.log(`${tag}  ${r.id}${r.profile ? '/' + r.profile : ''}  ${r.note}`)
}

console.log(`\n${results.length - failures}/${results.length} passed`)
process.exit(failures === 0 ? 0 : 1)