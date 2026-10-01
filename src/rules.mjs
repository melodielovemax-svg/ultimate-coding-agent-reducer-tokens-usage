// Injected into every agent's instruction file. This text is itself a token
// cost on every request, so it is deliberately compact: the caps in
// profiles.mjs do the heavy lifting on numbers, and these lines do the work
// that no config setting can do, which is changing what the agent chooses to
// read and say.

export const RULES_BODY = `## Keep context lean

Reading:

- Grep for the exact symbol before opening a file. Read ranges, not whole files.
- Never read a file twice. Re-read only an edited range, after the edit.
- Use the narrowest tool that answers the question: grep before glob, glob
  before reading a directory.

Searching:

- One targeted grep beats five broad ones. Always pass a pattern.
- Do not run git log, git diff, or a directory listing to get oriented unless
  the task requires it.

Commands:

- Never re-run a build, typecheck, or test whose result you already saw.
- Redirect noisy output and grep the file:
  \`npm test > out.txt 2>&1; rg "failed|error" out.txt\`

Editing:

- Read the target range, then edit. Do not read a file in full to change five
  lines.
- Add no comments unless asked. Do not restate a diff you just made.

Responding:

- Answer, then stop. No preamble, no recap, no offer of further help.
- Cite \`file:line\` instead of pasting code.
- No list when one sentence works. No table unless comparing three or more
  items on shared attributes.

Context:

- When context grows long, stop exploring and make the smallest change that
  solves the task.
- Ask one focused question rather than gathering more information.
- Start a new session instead of letting one grow unbounded.
`

export const AGENTS_EXTRA = `
## This workspace

- \`build-advanced-ai-platform/\` — Next.js 16, React 19, TypeScript 5.9,
  Tailwind 4, Drizzle ORM on Postgres.
- Verify with \`npm run typecheck\`. Add \`npm run lint\` only when touching
  lint-relevant files.
`