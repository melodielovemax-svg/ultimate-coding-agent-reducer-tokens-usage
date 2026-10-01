# tokens-usage-reducer (`tur`)

Token-usage reduction for coding agents, in two layers.

**Config profiles** apply numeric caps to **opencode**, **Gemini CLI**,
**Antigravity CLI** and **GitHub Copilot**.

**A context reducer** (`tur tokens`) shrinks context before it reaches a model:
secret redaction, deduplication, structure extraction, relevance ranking, and
budget allocation — with a per-stage trace so any reduction can be explained.

```bash
git clone https://github.com/melodielovemax-svg/ultimate-coding-agent-reducer-tokens-usage
cd ultimate-coding-agent-reducer-tokens-usage && npm install

node bin/tur.mjs install --profile deep     # config profiles
node bin/tur.mjs tokens analyze src         # what does this tree cost?
node bin/tur.mjs tokens optimize src --budget 4000
```

> Not on npm yet, so `npx tur` in older instructions does not work. Run
> `node bin/tur.mjs` from a clone.

## Profiles

| | `balanced` | `deep` (default) | `extreme` | `ultimate` |
| --- | --- | --- | --- | --- |
| opencode tool output | 300 lines / 16 KB | 120 / 8 KB | 60 / 4 KB | 40 / 3 KB |
| opencode recent turns kept | 20 000 | 12 000 | 6 000 | 4 000 |
| opencode compaction reserve | 40 000 | 32 000 | 24 000 | 28 000 |
| opencode build steps | 60 | 40 | 25 | 18 |
| gemini shell-output budget | 4 000 | 1 000 | 400 | 200 |
| gemini history window | 120 000 | 40 000 | 16 000 | 8 000 |
| gemini compression threshold | 0.40 | 0.20 | 0.12 | 0.08 |
| antigravity activation | `always_on` | `manual` | `manual` | `manual` |

`tur explain <profile>` prints the real numbers.

`extreme` and `ultimate` are real constraints, not bigger numbers: context is
held so small that long tasks need more than one session, and at `ultimate` a
single file read no longer returns a whole file. That last one is why the reducer
exists — the profiles are only coherent if something trims context before it
reaches the model.

`ultimate` keeps a *larger* compaction `reserved` value than `extreme` on
purpose. `reserved` is headroom for compaction to write into; shrinking it makes
compaction itself overflow and retry.

## The reducer

```bash
tur tokens analyze src                  # token cost, secrets, duplicates
tur tokens optimize src --budget 4000   # the reduced context
tur tokens benchmark src                # measured, with its own limits stated
```

Flags: `--budget <preset|n>`, `--query <text>`, `--repeats <n>`, `--json`.

```bash
tur tokens analyze src
  21 files, 27459 tokens (estimated)
  declarations only 5905 (21.5% smaller)
  over budget      27459 > 16000 (run: tur tokens optimize --budget 16000)

tur tokens optimize src --budget 3000
  tokens optimize  27459 -> 3000 tokens (89.2% reduction, estimated)
  budget 3000, used 100.0%

where the tokens went
  secrets      0
  skeletonize  23857
  budget       1094
```

Stage order is load-bearing and explained in `ARCHITECTURE.md`. Each stage
reports tokens before and after; every dropped item carries a reason.

## What the numbers mean

Token counts are **estimated** (`chars/4`, adjusted for symbol density), not a
provider tokenizer. Every report says which counter ran. Register a real one with
`setExactCounter()`.

`tur tokens benchmark` measures **context reduction only**. No model is called,
so no answer was scored and no cost was incurred. A reduction in tokens is not
evidence of better answers. `benchmarks/context-reduction.json` records what was
measured and, explicitly, what was not.

## Config commands

```
tur install     apply a profile
tur uninstall   remove what tur added
tur status      show active settings per platform
tur explain     compare profiles numerically
```

Flags: `--profile <name>`, `--platform <list|all>`, `--scope global|project`,
`--dry-run`.

### What each platform gets

**opencode** — `tool_output` caps, compaction with `prune`, `subagent_depth: 0`,
per-agent step ceilings, and a global rules file at
`~/.config/opencode/TOKEN-DISCIPLINE.md`.

**Gemini CLI** — `summarizeToolOutput`, `contextManagement.historyWindow` and
`messageLimits`, an early `compressionThreshold`, no directory tree in the first
request.

**Antigravity CLI** — a rule under
`~/.gemini/antigravity-cli/rules/token-discipline.md`. `always_on` injects it
every turn, `manual` costs nothing until @-mentioned. `tur` uses `manual` for
tighter profiles, because a discipline rule that costs tokens every request is
self-defeating.

**GitHub Copilot** — instructions only. Copilot exposes no setting for context
size or tool-output caps.

## Safety

Config writes:

- Files are **merged**, never overwritten. Keys `tur` does not own are untouched.
- Every config is copied to `*.tur-backup` before the first write.
- `tur uninstall` removes exactly the keys in `OWNED_KEYS` and the rule blocks it
  added. It does not revert a value you edited by hand afterwards — the original
  is not recorded, only the backup.
- Reserved filenames are rewritten wholesale (a fenced block would strand a
  previous version's body after an upgrade). Files you own get a fenced block
  instead: `AGENTS.md`, `.github/copilot-instructions.md`.

```bash
tur install --profile ultimate --dry-run    # always first
tur install --profile ultimate
```

Recover from a bad opencode config with
`OPENCODE_DISABLE_PROJECT_CONFIG=1`, or set
`OPENCODE_CONFIG_CONTENT='{"$schema":"https://opencode.ai/config.json"}'`.

Secrets: `tur tokens` redacts recognised credential formats before anything else
runs, and never puts a value in a finding — only a rule name, line, and a short
non-reversible fingerprint. Coverage is format-based and bounded; see
`SECURITY.md`. Treat a finding as a prompt to rotate, not as an assurance.

`tur tokens` makes no network calls and writes nothing.

## Verification

```bash
npm run check    # lint + 204 tests + schema validation
```

`npm test` is 204 tests, no network. `npm run validate` fetches the live opencode
and Gemini CLI schemas and validates the fully merged config each profile
produces, so a bad key fails here rather than at startup. All 8 profile/platform
combinations pass.

## Docs

- `STATUS.md` — what works, what does not, what is unmeasured
- `ARCHITECTURE.md` — stage order and the decisions behind it
- `SECURITY.md` — redaction coverage and its limits
- `RISK_REGISTER.md` — the nine known risks, worst first
- `benchmarks/context-reduction.json` — measured figures and how to reproduce

## License

MIT
