# ESL Article Scaffolder: coding guidelines

## Readability first: declarative, top-down code
- Each main or exported function reads like a table of contents: a short list of named
  steps, e.g. `const body = [...createWorksheetHeader(...), ...createGlossarySection(...)]`.
  A reader should understand what it does without opening any helper.
- Put helpers below the function that uses them, in call order, so files read top-down.
  Exception: small building blocks used many times in a file (e.g. `heading`, `paragraph`
  in docx.js) go at the top, so the reader learns that vocabulary first.
- Prefer building values (map / flatMap / filter / spreads / returning arrays) over
  mutating shared state (push into a shared array, `n++` counters across sections).
- Use `function` declarations for helpers below their caller (hoisted, so they're safe
  in any order).
- Name things by intent: `buildRetryOrRegenerateButton`, `assertWithinWordLimit`,
  not `h`, `doIt`, `handle`. Booleans read as questions: `isBusy`, `hasOriginalFile`.
- Give meaningful numbers a name (`INDENT_TWIPS = 360`, `POLL_INTERVAL_MS = 3000`).

## Don't over-abstract
- Extract a helper only if its name says more than its body, or it's used more than once.
  No single-use one-line wrappers.
- Keep tests in arrange / act / assert form, inline. Don't hide assertions in helpers.

## Comments
- One short comment above each non-obvious function saying what it returns or why it
  exists. Don't narrate the code line by line.
- Keep the `// REACT:`, `// POSTGRES:`, `// LOGIN:`, `// DRIVE:` migration markers.

## Project conventions
- Formatting: Prettier defaults (double quotes, trailing commas).
- Server: Express 5, async handlers throw; errors are mapped in server/app.js.
  All SQL lives in server/db/repo.js. Prompts live in server/services/prompt.js.
- Frontend: vanilla ES modules in public/js/, no build step. Build DOM with
  `createElement`, building child elements into named variables before nesting them.
- Never put secrets in code; `.env` is git-ignored.
- Run `npm test` after changes; add a test for any bug fix or new route.
