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
import { analyze, optimize, benchmark, BUDGET_PRESETS } from '../src/token-cmds.mjs'

const C = process.stdout.isTTY
  ? { dim: '\x1b[2m', red: '\x1b[31m', grn: '\x1b[32m', ylw: '\x1b[33m', ylm: '\x1b[93m', bld: '\x1b[1m', off: '\x1b[0m' }
  : { dim: '', red: '', grn: '', ylw: '', ylm: '', bld: '', off: '' }

function usage() {
  return `${C.bld}tokens-usage-reducer${C.off} ${C.dim}(tur)${C.off}

  ${C.bld}tur install${C.off} [options]     apply a reduction profile
  ${C.bld}tur uninstall${C.off} [options]   remove what tur added, restore backups
  ${C.bld}tur status${C.off} [options]       show active settings per platform
  ${C.bld}tur explain${C.off} [profile]     show the numeric caps a profile sets

  ${C.bld}tur tokens analyze${C.off} [path...]   report token cost and what would be dropped
  ${C.bld}tur tokens optimize${C.off} [path...]  print the reduced context
  ${C.bld}tur tokens benchmark${C.off} [path...] measure the reduction on real files

Options
  --profile <name>   ${PROFILE_NAMES.join(' | ')}   ${C.dim}(default: deep)${C.off}
  --platform <list>  ${PLATFORM_IDS.join(', ')}, all   ${C.dim}(default: detected)${C.off}
  --scope <where>    global | project   ${C.dim}(default: global)${C.off}
  --budget <n>       ${Object.keys(BUDGET_PRESETS).join(', ')} or a token count   ${C.dim}(default: medium)${C.off}
  --query <text>     relevance query, selects the lines worth keeping
  --repeats <n>      benchmark runs   ${C.dim}(default: 3)${C.off}
  --json             machine-readable output
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
    else if (a === '--json') out.flags.json = true
    else if (a === '--profile' || a === '-p') out.flags.profile = argv[++i]
    else if (a === '--platform') out.flags.platform = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--scope' || a === '-s') out.flags.scope = argv[++i]
    else if (a === '--budget' || a === '-b') out.flags.budget = argv[++i]
    else if (a === '--query' || a === '-q') out.flags.query = argv[++i]
    else if (a === '--repeats' || a === '-n') out.flags.repeats = argv[++i]
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

function pct(n) {
  return `${(n * 100).toFixed(1)}%`
}

function printAnalyze(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  const t = result.totals
  console.log(
    `${C.bld}tokens analyze${C.off}  ${t.files} files, ${C.bld}${t.tokens}${C.off} tokens ` +
      `${C.dim}(${t.counter})${C.off}`,
  )
  console.log(
    `  declarations only ${C.bld}${t.skeletonTokens}${C.off} ${C.dim}(${pct(1 - t.skeletonReduction)} smaller)${C.off}`,
  )
  if (t.duplicateTokens > 0) {
    console.log(`  duplicates        ${C.dim}${t.duplicateTokens} tokens removable${C.off}`)
  }
  if (t.overBudget) {
    console.log(
      `  ${C.ylw}over budget${C.off}      ${t.tokens} > ${t.budget} ` +
        `${C.dim}(run: tur tokens optimize --budget ${t.budget})${C.off}`,
    )
  }

  const secrets = result.issues.filter((i) => i.kind === 'secret')
  if (secrets.length > 0) {
    console.log(`\n${C.red}secrets${C.off} ${secrets.length} finding(s), values withheld:`)
    for (const s of secrets.slice(0, 20)) {
      console.log(`  ${s.id}:${s.line}  ${C.dim}${s.rule}  fp=${s.fingerprint}${C.off}`)
    }
  }

  console.log(`\n${C.bld}largest files${C.off}`)
  for (const f of result.files.slice(0, 15)) {
    console.log(
      `  ${String(f.tokens).padStart(7)}  ${C.dim}${f.lines}L -> ${f.skeletonLines}L${C.off}  ${rel(f.id)}`,
    )
  }
  if (result.files.length > 15) console.log(`  ${C.dim}... ${result.files.length - 15} more${C.off}`)
}

function printOptimize(result, json) {
  if (json) {
    console.log(JSON.stringify({ output: result.output, trace: result.trace, totals: result.totals, dropped: result.dropped }, null, 2))
    return
  }

  console.log(
    `${C.bld}tokens optimize${C.off}  ${result.totals.tokensIn} -> ${C.bld}${result.totals.tokensOut}${C.off} tokens ` +
      `${C.dim}(${pct(result.totals.reduction)} reduction, ${result.totals.counter})${C.off}`,
  )
  console.log(
    `  budget ${result.totals.budget}, used ${pct(result.totals.utilization)}   ` +
      `${C.dim}reduction is a token count, not a quality measurement${C.off}`,
  )

  if (result.trace.length > 0) {
    console.log(`\n${C.bld}where the tokens went${C.off}`)
    for (const s of result.trace) {
      const bar = s.saved > 0 ? C.grn : C.dim
      console.log(`  ${s.stage.padEnd(12)} ${bar}${s.tokensBefore} -> ${s.tokensAfter} (saved ${s.saved})${C.off}`)
    }
  }

  if (result.dropped.length > 0) {
    console.log(`\n${C.bld}dropped${C.off} ${result.dropped.length}`)
    for (const d of result.dropped.slice(0, 15)) {
      console.log(`  ${rel(String(d.id))}  ${C.dim}${d.reason}${C.off}`)
    }
  }

  if (result.output) {
    console.log(`\n${C.bld}reduced context${C.off}`)
    console.log(result.output)
  }
}

function printBenchmark(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  const s = result.summary
  console.log(
    `${C.bld}tokens benchmark${C.off}  ${result.runs.length} runs over real files  ` +
      `${C.dim}(${result.counter})${C.off}`,
  )
  console.log(`  mean reduction  ${C.bld}${pct(s.meanReduction)}${C.off}`)
  console.log(`  stdev           ${C.dim}${s.stdev.toFixed(6)}${C.off}`)
  console.log(`  deterministic   ${s.deterministic ? C.grn + 'yes' + C.off : C.ylw + 'no' + C.off}`)

  console.log(`\n${C.bld}per-stage savings${C.off}`)
  const first = result.runs[0].stageSavings
  for (const [stage, saved] of Object.entries(first)) {
    console.log(`  ${stage.padEnd(12)} ${saved}`)
  }

  console.log(`\n${C.ylm}limits${C.off}`)
  for (const caveat of result.caveats) console.log(`  ${C.dim}${caveat}${C.off}`)
}

function runTokens(args) {
  const sub = args._[1]
  const flags = args.flags
  // Everything after the subcommand is a path, so `tur tokens analyze src` works
  // without a separator.
  const paths = args._.slice(2)
  const targets = paths.length > 0 ? paths : ['.']

  if (sub === 'analyze') {
    printAnalyze(analyze({ paths: targets, budget: flags.budget }), Boolean(flags.json))
    return
  }
  if (sub === 'optimize') {
    printOptimize(
      optimize({ paths: targets, budget: flags.budget, query: flags.query }),
      Boolean(flags.json),
    )
    return
  }
  if (sub === 'benchmark') {
    const repeats = Number.parseInt(flags.repeats ?? '3', 10)
    if (!Number.isFinite(repeats) || repeats < 1) {
      throw new Error(`--repeats must be a positive integer, got "${flags.repeats}"`)
    }
    printBenchmark(
      benchmark({ paths: targets, budget: flags.budget, repeats }),
      Boolean(flags.json),
    )
    return
  }

  console.error(`${C.red}error${C.off} ${sub ? `unknown tokens subcommand "${sub}"` : 'tokens needs a subcommand'}`)
  console.log(`  ${C.dim}analyze | optimize | benchmark${C.off}`)
  process.exit(2)
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

  // The tokens group operates on files rather than agent configs, so it runs
  // before profile and platform resolution: `tur tokens analyze` must work
  // without a platform installed and without naming a profile.
  if (cmd === 'tokens') {
    if (args.flags.help) {
      console.log(usage())
      return
    }
    try {
      runTokens(args)
    } catch (err) {
      console.error(`${C.red}error${C.off} ${err.message}`)
      process.exit(1)
    }
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