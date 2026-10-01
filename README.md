# tokens-usage-reducer (`tur`)

Aggressive token-usage reduction for coding agents. One command configures
**opencode**, **Gemini CLI**, **Antigravity CLI** and **GitHub Copilot**.

Most of the waste in an agent session is not the model, it is the transcript:
whole files read to answer a one-line question, tool output dumped unfiltered,
history retained long after it stopped mattering, and replies padded with
recap. `tur` attacks all four.

```bash
npx tur install --profile deep
```

## Profiles

Three levels. See the real numbers with `tur explain`.

| | `balanced` | `deep` (default) | `extreme` |
| --- | --- | --- | --- |
| opencode tool output | 300 lines / 16 KB | 120 / 8 KB | 60 / 4 KB |
| opencode recent turns kept verbatim | 20 000 | 12 000 | 6 000 |
| opencode build steps | 60 | 40 | 25 |
| gemini shell-output summarisation | 4 000 | 1 000 | 400 |
| gemini history window | 120 000 | 40 000 | 16 000 |
| gemini compression threshold | 0.40 | 0.20 | 0.12 |
| antigravity rule activation | `always_on` | `manual` | `manual` |

`extreme` is a real constraint, not a bigger number: context is held so small
that a long task needs more than one session. It is there because some people
want that, and because the point of the tool is to make the limit explicit
rather than accidental.

## What each platform gets

**opencode** — `tool_output` caps, aggressive compaction with `prune` on,
`subagent_depth: 0` so subagents cannot spawn subagents, per-agent step
ceilings, and a global rules file at `~/.config/opencode/TOKEN-DISCIPLINE.md`
registered through `instructions`.

**Gemini CLI** — `summarizeToolOutput` so shell output is summarised rather
than pasted, `contextManagement.historyWindow` and `messageLimits` to bound
retained history, an early `compressionThreshold`, and no directory tree in the
first request.

**Antigravity CLI** — a rule under
`~/.gemini/antigravity-cli/rules/token-discipline.md`. Activation mode is the
lever: `always_on` injects the body every turn, `manual` costs nothing until
@-mentioned, `model_decision` injects only a description. `tur` uses `manual`
for the tighter profiles because a discipline rule that costs tokens on every
request is self-defeating.

**GitHub Copilot** — instructions only. Copilot exposes no setting for context
size, tool-output caps or compaction, so the instruction file is the only lever
that exists.

## Commands

```
tur install     apply a profile
tur uninstall   remove what tur added
tur status      show active settings per platform
tur explain     compare profiles numerically
```

Flags: `--profile <name>`, `--platform <list|all>`, `--scope global|project`,
`--dry-run`.

## Safety

`--dry-run` first, always available:

```bash
tur install --profile extreme --dry-run
tur install --profile extreme
```

- Config files are **merged**, never overwritten. Keys you already set that
  `tur` does not own are left alone.
- Every config file is copied to `*.tur-backup` before the first write.
- `tur uninstall` removes exactly the keys in `OWNED_KEYS` and the rules blocks
  it added, then restores the shape you had.
- Files `tur` reserves outright (`TOKEN-DISCIPLINE.md`,
  `token-discipline.md`, the two global Copilot paths) are rewritten wholesale,
  because a fenced block there would leave a stale copy of itself behind after
  an upgrade. Files you own (`AGENTS.md`,
  `.github/copilot-instructions.md`) get a fenced block instead, so your own
  writing survives.

If you lock yourself out of opencode with a bad config:
`OPENCODE_DISABLE_PROJECT_CONFIG=1` skips the project file, and
`OPENCODE_CONFIG_CONTENT='{"$schema":"https://opencode.ai/config.json"}'` gives
you a clean base to edit from.

## Verification

```bash
npm test                          # 66 unit + integration tests, no network
node scripts/validate-schemas.mjs # validates output against live vendor schemas
```

The schema check fetches the published schemas for opencode and Gemini CLI and
validates the fully merged config each profile produces, so a bad key fails
loudly here rather than at startup.

## Adding a platform

Drop a module in `src/platforms/` exporting `detect`, `targets`, `plan`,
`apply`, `uninstall` and `status`, then add it to the array in
`src/platforms/index.mjs`. The CLI, `--platform` flag and `status` output pick
it up with no other changes.

## License

MIT