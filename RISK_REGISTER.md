# RISK REGISTER

Ordered by how likely the risk is to cost you something real.

## 1. No quality measurement

**Severity: high. Status: open.**

The reducer has never been scored for correctness. A 89% token reduction on
source files says the text is smaller. It does not say an agent can still do its
job. The skeletonizer drops every function body; if a query needs the body, the
output is not smaller, it is wrong.

This is the gap that matters. Every number in `benchmarks/` is a token count, and
the repository states that plainly rather than implying otherwise.

**Mitigation now:** `--query` is optional and off by default, so the default path
is dedupe + skeletonize + budget. `tur tokens optimize` prints every stage's
saving and every drop with its reason, so a bad reduction is visible rather than
silent.

**Would fix it:** a task suite that runs real coding tasks with and without the
reducer and scores the diff. Needs model access this repository does not have.

## 2. Token counts are estimates

**Severity: medium. Status: open by design.**

`chars/4` adjusted for symbol density. No provider tokenizer is vendored,
because every vendor has its own vocabulary and a wrong vendored tokenizer is
worse than an honest estimate.

An estimate-based reduction figure and a billed-token figure can differ
materially. Everything reported says which counter ran.

**Mitigation now:** `setExactCounter()` accepts a real tokenizer; every trace and
benchmark records `counter_kind`.

## 3. `ultimate` makes single file reads lossy

**Severity: medium. Status: by design, documented.**

`tool_output.max_lines: 40`, `max_bytes: 3072`. A file read returns a fragment.
That is the point of the profile, and it is only coherent alongside the reducer.

**Mitigation now:** the profile description says a single file read no longer
returns whole files; STATUS.md lists it under what is not here. Skeletonizer
output is brace-balanced so a fragment still parses.

## 4. Skeletonizer is lexical

**Severity: medium. Status: open.**

No grammar. It counts braces after stripping comments and string literals, so
braces inside template literals, heredocs, or unterminated strings shift the depth
count and can drop later declarations or emit stray closers.

**Mitigation now:** brace balance is asserted by test; the failure mode is a
truncated or noisy skeleton, not a crash.

## 5. Relevance is lexical

**Severity: low. Status: open.**

BM25 over tokens with trivial suffix stripping. A query sharing no vocabulary
with the relevant code scores nothing. `stability`, `stable` and `stable()`
tokenise differently.

**Mitigation now:** relevance only runs when `--query` is passed. Off by default.

## 6. Silently truncated file walk

**Severity: low. Status: open.**

`collectFiles` stops at 200 files and does not report that it did. On a large
repository the reported reduction covers a prefix of the tree and looks total.

**Mitigation now:** per-file rows make the file count visible in `analyze`
output.

## 7. `SECRET_KEY="..."` detection is name-based

**Severity: low. Status: by design.**

Any assignment whose *variable name* looks secret is redacted, whatever the
value. A config key like `secret_mode = "production"` gets replaced.

**Mitigation now:** environment variable references and obvious placeholders are
excluded. Values under 6 characters are ignored.

## 8. `uninstall` cannot restore overwritten values

**Severity: low. Status: accepted.**

`uninstall` removes the keys tur set. It does not restore pre-install values,
because they are not recorded — only the pre-install file, in `*.tur-backup`.

**Mitigation now:** backups exist per write. Documented in `--help` output and
STATUS.md.

## 9. Not published to npm

**Severity: low. Status: open.**

README says `npx tur`, which does not resolve. Anyone following it gets an error.

**Mitigation now:** install from git. Noted in STATUS.md.
