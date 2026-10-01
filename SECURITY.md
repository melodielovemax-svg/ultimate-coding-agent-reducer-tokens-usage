# SECURITY

## The reducer handles whatever you point it at

`tur tokens analyze .` reads your source tree into memory. It does not transmit
anything. It writes nothing. `install` is the only command that writes, and only
to the four agent config locations it owns.

## Secrets

The one genuinely dangerous path is a credential in a file that gets pasted into
a model prompt. Two protections:

**Redaction happens before anything else.** First stage of the pipeline, before
content can be kept, ranked, or logged.

**Findings never contain the value.** A finding carries the rule name, line
number, and an 8-character FNV fingerprint — enough to tell two occurrences of
the same secret apart, useless for recovering it. Tests assert the absence of
the value in `redactSecrets().text`, in `findings`, and in `analyze().issues`,
because a report written to a log file is itself a leak.

`tur tokens analyze` prints `fp=` and the rule name, never the match.

### Coverage is bounded

Detection is format-based for known credential shapes (AWS keys, GitHub and
Anthropic and OpenAI tokens, Slack, Stripe, Google API keys, JWTs, PEM private
key blocks, connection-string credentials) plus assignment-shaped detection
where the *variable name* says it is a secret.

It is not a scanner. It will not find a base64 blob, an obfuscated token, a
credential split across lines, or anything in a format not listed. Treat output
as a prompt to rotate what it finds, not as an assurance that nothing leaked.

Environment variable references (`process.env.API_KEY`, `${SECRET}`) are
deliberately left alone. Redacting them would break the code that reads them.

### If something does leak

Rotate it. A credential that reached a prompt should be considered exposed,
because prompt content may be logged by the agent, the provider, or an
intermediate. Removing it from a file afterwards does not undo that.

## Config writes

- **Backups.** Every write copies the previous file to `*.tur-backup` first.
- **Owned keys only.** `uninstall` and `status` touch only keys in `OWNED_KEYS`.
  An unrelated hand edit to the same file is never reverted.
- **Managed blocks.** Markdown uses `<!-- tur:begin -->` / `<!-- tur:end -->`, so
  surrounding human-written content survives.
- **Fully-owned files.** Where tur reserves a filename (`TOKEN-DISCIPLINE.md`,
  `token-discipline.md`) the body is rewritten wholesale, because a fenced block
  would strand a previous version's body after an upgrade.
- **Instructions arrays.** `uninstall` removes only tur's own entry from
  `instructions`, leaving the rest of the array intact.

## Filesystem traversal

`tur tokens` walks directories. It does not follow symlinks — a link can pull in
unrelated content or form a cycle. `node_modules`, `.git`, `dist`, `build`,
`out`, `coverage`, and other build directories are skipped. Dotfiles are skipped
except `.env`, which is exactly the file most likely to hold a credential worth
reporting.

Files over 2 MB are skipped: a token count of a minified bundle is meaningless
and reading it is a memory cost with no benefit.

`--json` output contains file paths and token counts. If paths are sensitive,
do not paste the output somewhere public.

## Network

None. Every stage is local computation. No telemetry, no update check, no remote
call. The `validate` script fetches the opencode and Gemini JSON schemas to check
profiles against them, and is the only command that touches the network.

## Known weaknesses

- `isExactDuplicate` and the SimHash filter read and compare full file contents
  in memory. On a very large tree, peak memory is proportional to total bytes
  read.
- `collectFiles` caps at 200 files by default and silently stops there. A large
  repository will report a reduction for the first 200 files and not say the
  walk was cut short.
- No permission checks beyond OS defaults. A config tur cannot read, it skips.
