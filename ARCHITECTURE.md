# ARCHITECTURE

Two independent layers. Layer 1 writes configuration. Layer 2 reduces context.
They do not depend on each other, which is deliberate: the reducer is useful to
any caller, and the profiles are useful to any agent that cannot run the reducer.

```
layer 2   tur tokens analyze | optimize | benchmark
          reduceContext()  src/reducer/pipeline.mjs
            1 secrets      redactSecrets()       src/reducer/secrets.mjs
            2 dedupe       findDuplicates()      src/reducer/dedupe.mjs
            3 skeletonize  skeletonize()         src/reducer/skeletonize.mjs
            4 relevance    selectByRelevance()   src/reducer/relevance.mjs
            5 budget       allocate()            src/reducer/budget.mjs
          count()  src/reducer/tokenize.mjs

layer 1   tur install | uninstall | status | explain
          install()  src/commands.mjs
            opencode     gemini     antigravity     copilot
            (owned keys, managed blocks, backups)    src/fsutil.mjs
```

## Layer 2: why this order

The sequence is load-bearing.

**Secrets first.** Every later stage either keeps text or drops it, and neither
is acceptable for a credential pasted by accident. Redaction also runs before
deduplication so a secret is stripped once rather than counted twice.

**Dedupe before shrinking.** Exact-duplicate removal is nearly free and often
removes the most tokens of any stage. Taking it after skeletonization would mean
skeletonizing a file that was about to be discarded.

**Skeletonize before ranking.** Ranking cost is linear in lines. Halving the
lines halves the work, and the lines that survive skeletonization are the
declarations a query is most likely to name.

**Relevance before budget.** Budget is measured in tokens; ranking changes what
those tokens contain. Reversing the two means ranking content that is about to
be thrown away.

**Budget last.** It can only reason about real costs after the stages above have
produced the final text.

## Design decisions worth knowing

**Token counting is pluggable.** `count()` prefers an exact counter and falls
back to `estimateTokens()`. Every trace entry and benchmark records which ran.
An estimate-based reduction claim and a tokenizer-based one are different claims,
and reporting them without distinguishing them is how a number stops meaning
anything.

**Every stage reports tokens before and after.** A reduction that cannot show
where the tokens went is not evidence. Stages that run but save nothing still
appear in the trace, because "did not help" and "did not run" need different
fixes.

**Every drop has a reason.** `dropped` entries always carry one. A silently
dropped file is the failure mode that makes a reducer untrustworthy.

**Skeleton output is brace-balanced.** Dropping function bodies leaves unbalanced
braces, which reads as broken code and breaks any stage that counts depth on the
result. Closers are re-indented to match their opener.

**SimHash is a filter, not a decision.** It converges on long documents: a
one-word edit to a 40-line file still hashes to distance 0. So a hash candidate
must also share 80% of its shingles before it is dropped. Without that check, a
collision silently deletes a file.

**Budget allocation reserves for items not yet placed.** Even division cannot
respect priority — it truncates items that would have fit whole and caps items
below their own size, which then get dropped. The reservation applies only to
trimmable items: an item that cannot be truncated is all-or-nothing, and
reserving against it just causes a drop.

## Extension points

| Want | Do this |
|---|---|
| Exact token counts | `setExactCounter(fn)` in `tokenize.mjs` |
| Better relevance | Replace `selectByRelevance`; keep the trace contract |
| Better structure | Replace `skeletonize`; keep brace balance |
| Secret rule | Append to `RULES` in `secrets.mjs` |

All are deliberately dependency-free. That is a constraint with a cost — no
embeddings, no parser — and the cost is stated in STATUS.md rather than hidden.

## Test layout

204 tests, one file per module, plus `token-cmds.test.mjs` for the filesystem
layer against temp-directory fixtures. `token-cmds.test.mjs` writes real files
rather than mocking `node:fs`, because the bugs worth finding here are in path
handling and traversal, which mocks do not exercise.
