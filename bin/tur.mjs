#!/usr/bin/env node
import process from 'node:process'
import {
  PLATFORM_IDS,
  detected,
  resolvePlatforms,
  resolveProfile,
  resolveScope,
} from '../src/index.mjs'
import { install, uninstall, status, explain } from '../src/commands.mjs'
import { rel } from '../src/fsutil.mjs'
import { PROFILE_NAMES } from '../src/profiles.mjs'

const C = process.stdout.isTTY
  ? { dim: '\x1b[2m', red: '\x1b[31m', grn: '\x1b[32m', ylw: '\x1b[33m', bld: '\x1b[1m', off: '\x1b[0m' }
  : { dim: '', red: '', grn: '', ylw: '', bld: '', off: '' }

function usage() {
  return `${C.bld}tokens-usage-reducer${C.off} ${C.dim}(tur)${C.off}

  ${C.bld}tur install${C.off} [options]     apply a reduction profile
  ${C.bld}tur uninstall${C.off} [options]   remove what tur added, restore backups
  ${C.bld}tur status${C.off} [options]       show active settings per platform
  ${C.bld}tur explain${C.off} [profile]     show the numeric caps a profile sets

Options
  --profile <name>   ${PROFILE_NAMES.join(' | ')}   ${C.dim}(default: deep)${C.off}
  --platform <list>  ${PLATFORM_IDS.join(', ')}, all   ${C.dim}(default: detected)${C.off}
  --scope <where>    global | project   ${C.dim}(default: global)${C.off}
  --dry-run          print the diff without writing
  -h, --help         this text
  -v, --version      print version
`
}

function parseArgs(argv) {
  const out = { _: [], flags: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h' || a === '--help') out.flags.help = true
    else if (a === '-v' || a === '--version') out.flags.version = true
    else if (a === '--dry-run') out.flags.dryRun = true
    else if (a === '--profile' || a === '-p') out.flags.profile = argv[++i]
    else if (a === '--platform') out.flags.platform = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--scope' || a === '-s') out.flags.scope = argv[++i]
    else if (a.startsWith('-')) throw new Error(`unknown flag ${a}`)
    else out._.push(a)
  }
  return out
}

async function readVersion() {
  const { readFileSync } = await import('node:fs')
  const url = new URL('../package.json', import.meta.url)
  return JSON.parse(readFileSync(url, 'utf8')).version
}

// Rule steps report a boolean, config steps report a diff. Normalise both to
// one shape so the printer does not need to care which kind it is.
function steps(result) {
  return result.results.map((r) => ({
    path: r.path,
    kind: r.kind ?? 'config',
    changes: r.changes ?? (r.changed ? [{ path: '(rule body)', from: undefined, to: 'written' }] : []),
  }))
}

function printSteps(list, dryRun) {
  const label = dryRun ? `${C.ylw}would change${C.off}` : `${C.grn}updated${C.off}`
  for (const r of list) {
    if (r.changes.length === 0) {
      console.log(`  ${C.dim}no change${C.off}  ${rel(r.path)}`)
      continue
    }
    console.log(`  ${label}  ${rel(r.path)}${r.kind === 'rules' || r.kind === 'rule' ? C.dim + '  (rules)' + C.off : ''}`)
    for (const c of r.changes.slice(0, 14)) {
      console.log(`      ${C.dim}${c.path}${C.off}${C.dim}:${C.off} ${fmt(c.from)} ${C.dim}->${C.off} ${fmt(c.to)}`)
    }
    if (r.changes.length > 14) console.log(`      ${C.dim}... ${r.changes.length - 14} more${C.off}`)
  }
}

function fmt(v) {
  if (v === undefined) return `${C.dim}(unset)${C.off}`
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`${C.red}error${C.off} ${err.message}`)
    process.exit(2)
  }

  const cmd = args._[0]

  if (args.flags.help || !cmd) {
    console.log(usage())
    process.exit(0)
  }

  if (args.flags.version) {
    readVersion().then((v) => console.log(v))
    return
  }

  let profile, scope, platforms
  try {
    profile = resolveProfile(args.flags.profile)
    scope = resolveScope(args.flags.scope)
    const requested = args.flags.platform
    if (!requested || requested.includes('all')) {
      platforms = resolvePlatforms(null)
    } else {
      platforms = resolvePlatforms(requested)
    }
  } catch (err) {
    console.error(`${C.red}error${C.off} ${err.message}`)
    process.exit(2)
    return
  }

  const dryRun = Boolean(args.flags.dryRun)
  const present = detected().map((p) => p.id)

  try {
    if (cmd === 'install') {
      const result = install({ platforms, profile, scope, dryRun })
      console.log(
        `${C.bld}tur install${C.off} profile=${C.bld}${profile}${C.off} scope=${C.bld}${scope}${C.off}` +
          (dryRun ? ` ${C.ylw}(dry run, nothing written)${C.off}` : ''),
      )
      for (const [id, res] of Object.entries(result)) {
        const missing = !present.includes(id)
        console.log(`\n${C.bld}${id}${C.off}${missing ? ` ${C.dim}(not installed here)${C.off}` : ''}`)
        printSteps(steps(res), dryRun)
      }
      if (!dryRun) {
        console.log(
          `\n${C.dim}Restart opencode, gemini, and agy to pick up the new config.${C.off}`,
        )
      }
      return
    }

    if (cmd === 'uninstall') {
      const result = uninstall({ platforms, scope, dryRun })
      console.log(`${C.bld}tur uninstall${C.off} scope=${C.bld}${scope}${C.off}`)
      for (const [id, res] of Object.entries(result)) {
        console.log(`\n${C.bld}${id}${C.off}`)
        printSteps(steps(res), dryRun)
      }
      console.log(`\n${C.dim}Backups written next to each config as *.tur-backup.${C.off}`)
      return
    }

    if (cmd === 'status') {
      const result = status({ platforms, scope })
      for (const s of result) {
        console.log(
          `${C.bld}${s.platform}${C.off} ${s.active ? C.grn + 'active' + C.off : C.dim + 'inactive' + C.off}`,
        )
        console.log(`  config ${C.dim}${s.configFile}${C.off}${s.configFound ? '' : ` ${C.dim}(absent)${C.off}`}`)
        console.log(`  rules  ${C.dim}${s.rulesFile}${C.off}${s.rulesFound ? '' : ` ${C.dim}(absent)${C.off}`}`)
        for (const [k, v] of Object.entries(s.values)) {
          console.log(`    ${C.dim}${k}${C.off} = ${fmt(v)}`)
        }
      }
      return
    }

    if (cmd === 'explain') {
      const p = resolveProfile(args._[1])
      console.log(explain(p))
      return
    }

    console.error(`${C.red}error${C.off} unknown command "${cmd}"`)
    console.log(usage())
    process.exit(2)
  } catch (err) {
    if (err.code === 'EBADJSON') {
      console.error(`${C.red}error${C.off} ${err.message}`)
      console.error(`${C.dim}Fix the file, or restore the *.tur-backup next to it.${C.off}`)
      process.exit(1)
    }
    console.error(`${C.red}error${C.off} ${err.message}`)
    process.exit(1)
  }
}

main()