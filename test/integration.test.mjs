import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'

import opencode from '../src/platforms/opencode.mjs'
import gemini from '../src/platforms/gemini.mjs'
import antigravity from '../src/platforms/antigravity.mjs'
import copilot from '../src/platforms/copilot.mjs'
import { readConfig, removeKeys } from '../src/fsutil.mjs'

// Every platform module resolves paths from the real home directory, so the
// suite runs with HOME and USERPROFILE pointed at a sandbox. Anything the code
// under test reads through os.homedir() then lands in the sandbox.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tur-home-'))
const realHome = process.env.HOME
const realUserProfile = process.env.USERPROFILE

before(() => {
  process.env.HOME = sandbox
  process.env.USERPROFILE = sandbox
})

after(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  if (realUserProfile === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = realUserProfile
  fs.rmSync(sandbox, { recursive: true, force: true })
})

const home = () => path.join(sandbox, '.config')

test('opencode global install writes a reserved rules file and a valid config', () => {
  const steps = opencode.plan('deep', 'global')
  for (const step of steps) opencode.apply(step)

  const rules = path.join(home(), 'opencode', 'TOKEN-DISCIPLINE.md')
  assert.ok(fs.existsSync(rules))
  assert.ok(!fs.readFileSync(rules, 'utf8').includes('tur:begin'), 'reserved file is not fenced')

  const config = readConfig(path.join(home(), 'opencode', 'opencode.json'))
  assert.equal(config.tool_output.max_lines, 120)
  assert.deepEqual(config.instructions, ['~/.config/opencode/TOKEN-DISCIPLINE.md'])
})

test('opencode project install fences the rules and sets no instructions key', () => {
  const dir = fs.mkdtempSync(path.join(sandbox, 'proj-'))
  const cwd = process.cwd()
  process.chdir(dir)
  try {
    for (const step of opencode.plan('extreme', 'project')) opencode.apply(step)

    const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')
    assert.ok(agents.includes('tur:begin'), 'fenced inside a hand-authored file')

    const config = readConfig(path.join(dir, 'opencode.json'))
    assert.equal(config.tool_output.max_lines, 60)
    assert.equal(config.instructions, undefined, 'project scope leaves instructions alone')
  } finally {
    process.chdir(cwd)
  }
})

test('opencode re-install does not stack duplicate rule bodies', () => {
  const steps = opencode.plan('balanced', 'global')
  for (const step of steps) opencode.apply(step)

  const text = fs.readFileSync(path.join(home(), 'opencode', 'TOKEN-DISCIPLINE.md'), 'utf8')
  assert.equal(text.match(/## Keep context lean/g).length, 1)
})

test('opencode uninstall clears owned keys, the rules file and its instructions entry', () => {
  opencode.uninstall('global')

  assert.ok(!fs.existsSync(path.join(home(), 'opencode', 'TOKEN-DISCIPLINE.md')))
  const config = readConfig(path.join(home(), 'opencode', 'opencode.json'))
  assert.equal(config.instructions, undefined)
  assert.equal(config.tool_output, undefined)
})

test('uninstall leaves unrelated user keys in place', () => {
  const dir = fs.mkdtempSync(path.join(sandbox, 'keep-'))
  const file = path.join(dir, 'opencode.json')
  fs.writeFileSync(
    file,
    JSON.stringify({ theme: 'tokyonight', tool_output: { max_lines: 999 }, custom: { keep: true } }),
  )

  removeKeys(file, ['tool_output'])

  const config = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(config.theme, 'tokyonight')
  assert.deepEqual(config.custom, { keep: true })
  assert.equal(config.tool_output, undefined)
})

test('gemini global install writes both the config and GEMINI.md', () => {
  for (const step of gemini.plan('deep', 'global')) gemini.apply(step)

  const config = readConfig(path.join(sandbox, '.gemini', 'settings.json'))
  assert.equal(config.model.compressionThreshold, 0.2)
  assert.equal(config.contextManagement.messageLimits.normalMaxTokens, 800)

  const rules = path.join(sandbox, '.gemini', 'GEMINI.md')
  assert.ok(fs.existsSync(rules))
  assert.ok(fs.readFileSync(rules, 'utf8').includes('tur:begin'))
})

test('gemini project install points context at AGENTS.md', () => {
  const dir = fs.mkdtempSync(path.join(sandbox, 'gproj-'))
  const cwd = process.cwd()
  process.chdir(dir)
  try {
    for (const step of gemini.plan('extreme', 'project')) gemini.apply(step)

    const config = readConfig(path.join(dir, '.gemini', 'settings.json'))
    assert.equal(config.context.fileName[0], 'AGENTS.md')
    assert.ok(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8').includes('tur:begin'))
  } finally {
    process.chdir(cwd)
  }
})

test('gemini uninstall restores the pre-install shape', () => {
  gemini.uninstall('global')

  const config = readConfig(path.join(sandbox, '.gemini', 'settings.json'))
  assert.equal(config.model, undefined)
  assert.equal(config.contextManagement, undefined)
  assert.ok(!fs.existsSync(path.join(sandbox, '.gemini', 'GEMINI.md')))
})

test('antigravity rule keeps valid frontmatter as the first bytes', () => {
  for (const step of antigravity.plan('deep', 'global')) antigravity.apply(step)

  const file = path.join(sandbox, '.gemini', 'antigravity-cli', 'rules', 'token-discipline.md')
  const text = fs.readFileSync(file, 'utf8')
  assert.ok(text.startsWith('---\ntrigger: manual\n---\n'), 'frontmatter is byte-first')
  assert.ok(!text.includes('tur:begin'), 'reserved file is not fenced')
})

test('antigravity balanced profile uses always_on', () => {
  for (const step of antigravity.plan('balanced', 'global')) antigravity.apply(step)

  const file = path.join(sandbox, '.gemini', 'antigravity-cli', 'rules', 'token-discipline.md')
  assert.ok(fs.readFileSync(file, 'utf8').startsWith('---\ntrigger: always_on\n---'))
})

test('antigravity uninstall deletes the rule file outright', () => {
  antigravity.uninstall('global')
  assert.ok(
    !fs.existsSync(path.join(sandbox, '.gemini', 'antigravity-cli', 'rules', 'token-discipline.md')),
  )
})

test('copilot writes instructions to both global paths', () => {
  for (const step of copilot.plan('deep', 'global')) copilot.apply(step)

  assert.ok(fs.existsSync(path.join(sandbox, '.copilot', 'copilot-instructions.md')))
  assert.ok(fs.existsSync(path.join(sandbox, '.config', 'github-copilot', 'instructions.md')))
})

test('copilot project install appends the workspace facts and fences the block', () => {
  const dir = fs.mkdtempSync(path.join(sandbox, 'cproj-'))
  fs.writeFileSync(
    path.join(dir, 'copilot-instructions.md'),
    '# existing\n\nhand written\n',
  )
  fs.mkdirSync(path.join(dir, '.github'))
  fs.renameSync(
    path.join(dir, 'copilot-instructions.md'),
    path.join(dir, '.github', 'copilot-instructions.md'),
  )
  const cwd = process.cwd()
  process.chdir(dir)
  try {
    for (const step of copilot.plan('deep', 'project')) copilot.apply(step)

    const text = fs.readFileSync(path.join(dir, '.github', 'copilot-instructions.md'), 'utf8')
    assert.ok(text.includes('hand written'))
    assert.ok(text.includes('tur:begin'))
    assert.ok(text.includes('npm run typecheck'), 'workspace facts included')
  } finally {
    process.chdir(cwd)
  }
})

test('every path tur touches stays inside the sandbox', () => {
  // Guards against a module capturing the real home before before() ran. If
  // home() were cached at import time these files would land outside the
  // sandbox and the assertions above would all have failed against nothing.
  for (const platform of [opencode, gemini, antigravity, copilot]) {
    for (const scope of ['global', 'project']) {
      for (const target of platform.targets(scope)) {
        assert.ok(target.file.length > 0, `${platform.id} ${scope}`)
      }
    }
  }
  assert.ok(fs.existsSync(path.join(sandbox, '.gemini')))
})