# STATUS

Last updated: 2026-10-01

Two independent things live in this repository. Both work. Neither is the
Melodeath AI platform described in the parent brief, and that platform has not
been started.

## 1. Config profiles — complete

Applies numeric caps to four coding agents: opencode, Gemini CLI, Antigravity
CLI, GitHub Copilot.

| | |
|---|---|
| Commands | `install`, `uninstall`, `status`, `explain` |
| Profiles | `balanced`, `deep`, `extreme`, `ultimate` |
| Scope | global or project |
| Safety | `*.tur-backup` per write, managed blocks in Markdown, owned-file list per platform |
| Schema check | all 8 profile/platform combinations validate against the live opencode and Gemini CLI schemas |

`uninstall` restores the keys `tur` set. It does not revert a config edited by
hand after installation, and cannot: the original values are not recorded
anywhere.

## 2. Context reducer engine — complete

Reduces context before it reaches a model. This is the part that makes the
`ultimate` profile coherent; the profile alone sets caps low enough that a
single file read no longer returns a whole file.

| Stage | What it does | Cost |
|---|---|---|
| `secrets` | Replaces recognised credentials with `[REDACTED]` | can lengthen text |
| `dedupe` | Drops exact and near-duplicate documents | 64-bit SimHash + shingle overlap |
| `skeletonize` | Keeps declarations and member signatures for code | lexical, not a parser |
| `relevance` | BM25 line ranking, only when given a query | lexical, not embeddings |
| `budget` | Greedy fit in priority order with reservations | — |

Commands: `tur tokens analyze`, `tur tokens optimize`, `tur tokens benchmark`,
all with `--json`.

- 204 tests pass.
- Measured on this repo: 27,459 → 3,000 estimated tokens at a 3,000 budget,
  89.2% reduction, deterministic across 3 runs. See `benchmarks/`.

## What is not here

- **No Melodeath AI.** No Phoenix core, model router, RAG, memory, MCP,
  gateway, or agent orchestration. Not started.
- **No quality measurement.** The reducer's output has never been scored for
  correctness. A token reduction is not evidence that answers got better or
  even stayed the same. This is the largest gap.
- **Token counts are estimated.** `chars/4` adjusted for symbol density. No
  provider tokenizer is vendored, because each vendor has a different
  vocabulary. `setExactCounter()` accepts a real one and every figure reports
  which was used.
- **Skeletonizer is lexical.** No grammar, so it degrades rather than fails on
  syntax it does not understand. It will mis-handle braces inside template
  literals and heredocs.
- **Relevance is lexical.** BM25 over tokens with trivial suffix stripping.
  No embeddings, so a query sharing no vocabulary with the relevant code scores
  nothing. `--query` is optional and off by default.
- **Antigravity `ultimate` and `extreme` need manual activation.** The tool
  cannot toggle the reserved rules file.
- **Copilot gets prose rules only.** No numeric knobs exist to configure.
- **Not published to npm.** README says `npx tur`; that does not work yet.
  Install from git until then.

## Reproducing the numbers

```
npm install
npm run check
node bin/tur.mjs tokens benchmark src --budget 3000 --repeats 3
```
