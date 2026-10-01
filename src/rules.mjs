// Instruction text injected into every agent's rule or instruction file.
//
// This text is a token cost on every request, so each body is as short as it can
// be while still changing what the agent chooses to read and say. The numeric
// caps live in profiles.mjs; these lines do the work no config setting can,
// which is changing behaviour.
//
// A tighter profile gets a shorter body, and therefore a stricter rule, because
// `extreme` and `ultimate` hold context so small that a verbose discipline
// instruction would itself consume the budget it is protecting.
const RULES = {
  balanced: `## Keep context lean

Reading:
- Grep for the exact symbol before opening a file. Read ranges, not whole files.
- Never read a file twice. Re-read only an edited range, after the edit.

Searching:
- One targeted grep beats five broad ones. Always pass a pattern.
- No git log, diff, or directory listing to get oriented unless the task needs it.

Commands:
- Never re-run a build, typecheck, or test whose result you already saw.
- Redirect noisy output, then grep it:
  \`npm test > out.txt 2>&1; rg "failed|error" out.txt\`

Editing:
- Read the target range, then edit. Never read a whole file to change five lines.
- Add no comments unless asked. Do not restate a diff you just made.

Responding:
- Answer, then stop. No preamble, no recap, no offer of further help.
- Cite \`file:line\` instead of pasting code.
- No list when one sentence works. No table unless comparing 3+ items.

Context:
- When context grows long, stop exploring and make the smallest change that works.
- Ask one focused question rather than gathering more information.`,

  deep: `## Keep context lean

- Grep the exact symbol first; read ranges, never whole files.
- Reuse context. Re-read only an edited range, after the edit.
- Targeted search only. No git log, diff, or listing to get oriented.
- Never re-run a build, typecheck, or test whose result you already saw.
- Redirect noisy output and grep it.
- Read the target range, then edit.
- No comments unless asked. No restating a diff.
- Answer, then stop. No preamble, no recap, no follow-up offer.
- Cite \`file:line\`. No list when a sentence works.
- When context grows long, stop exploring. Ask one focused question.`,

  extreme: `Search exact symbols; read ranges only. Reuse context. Targeted tools only, run each check once. Edit the range, not the file. No comments, no recap, no preamble. Cite \`file:line\`. Stop exploring when context grows.`,

  // The tightest body that still names the behaviours worth changing. Below
  // roughly this length the rule stops being able to state what it wants.
  ultimate: `Search symbols, read ranges, reuse context. Run each check once. Edit ranges, not files. No comments, no recap. Cite \`file:line\`. Stop exploring early.`,
}

// Context filenames tur registers with Gemini CLI. Kept here because both
// install and uninstall need the identical list, and an uninstall that names a
// different file leaves a stale entry behind.
export const CONTEXT_FILES = ['AGENTS.md']

// Falls back to `deep` so an unknown profile name still produces a usable rule
// instead of an undefined body.
export function rulesForProfile(profile) {
  return RULES[profile] ?? RULES.deep
}

export const AGENTS_EXTRA = `## This workspace

- \`build-advanced-ai-platform/\` — Next.js 16, React 19, TypeScript 5.9,
  Tailwind 4, Drizzle ORM on Postgres.
- Verify with \`npm run typecheck\`. Add \`npm run lint\` only when touching
  lint-relevant files.
`
