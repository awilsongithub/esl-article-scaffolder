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
- Put a `/** */` comment above every function and route handler saying what it
  returns or why it exists. The comment blocks also visually separate functions,
  so a reader can focus on one at a time. Don't narrate the code line by line.
- Keep comment lines to 80 characters or fewer, indentation included.
- Put each separate idea on its own line: the summary first, then one line per
  step, status code or caveat.
  ```js
  /**
   * POST /articles/:id/retry: Try Again for every failed level of an article.
   * Claims all failed levels in one UPDATE.
   * 202 = started; 409 = levels still running; 200 = nothing to retry.
   */
  ```
- Short `//` comments are fine inside function bodies.
- Keep the `// REACT:`, `// POSTGRES:`, `// LOGIN:`, `// DRIVE:` migration markers.

## Project conventions
- Formatting: Prettier, configured in `.prettierrc.json` and `.editorconfig`: 4-space indent
  in JS, 2 spaces in CSS / HTML / JSON / Markdown, double quotes. Run `npm run format`.
- Server: Express 5, async handlers throw; errors are mapped in server/app.js.
  All SQL lives in server/db/repo.js. Prompts live in server/services/prompt.js.
- Frontend: vanilla ES modules in public/js/, no build step. Build DOM with
  `createElement`, building child elements into named variables before nesting them.
- Never put secrets in code; `.env` is git-ignored.
- Run `npm test` after changes; add a test for any bug fix or new route.
