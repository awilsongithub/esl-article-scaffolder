# Article form: up to 3 configurable versions (October 2026)

Mockups: [2026-10-article-form-mockups/](2026-10-article-form-mockups/)
(`Main.dc.html` desktop 1280px, `Tablet.dc.html` 834px, `Mobile.dc.html` 390px).
They load a `./support.js` design-tool runtime that isn't in the repo,
so read them as markup and CSS; they won't render on their own.
They're three fixed-width snapshots with inline styles and no media
queries. The build is one responsive form (requirements 5 and 6).

## Where we are today

- Every article gets exactly three levels, fixed in `LEVELS` in
  `server/config.js`: Kindergarten (`k`), Grade 5 (`g5`), Grade 10 (`g10`).
- Per level the teacher picks a glossary-term count and a question count
  (0–20). Translation is one choice for the whole article.
- `level_outputs` has one row per (article, level). The generated content
  is one JSON object per row: title, paragraphs, glossary, multiple choice,
  short answer.

## Requirements

1. **One title** covers all versions.
   Placeholder: `Example: Fox Feeding Habits Grades 1, 3 and 6`.
2. **1 to 3 versions** per article, as in the mockups.
3. **"Uploaded by" is required** (today it's optional).
4. **Per version:**
   - **Grade level**, Kindergarten through Grade 12. It sets the complexity
     of everything produced: article, summary, glossary, questions, cloze.
   - **Questions, 0–15.** Prioritize evidence and inference questions over
     recall, following published best practice for text-dependent questions.
   - **Glossary terms, 0–15.** Choose words that carry the article's meaning
     and are useful across subjects, not every hard word, following
     published best practice for vocabulary selection.
   - **Glossary translation:** "No translation" or one of the languages in
     today's `TRANSLATION_LANGUAGES` list (14, not the 6 in the mockups).
   - **Image, optional:** one uploaded picture, placed with this version.
   - **Short summary** before the article, on or off.
   - **Break into sections**, on or off. Each section is followed by its
     own questions instead of all questions at the end. The glossary stays
     one complete list.
   - **Cloze passage**, on or off: a summary with glossary words blanked
     out. Requires at least one glossary term.
5. **Styles in global stylesheets, as their own layer:**
   - All CSS lives in global files in `public/assets/styles/`, next to
     `public/assets/images/`: `tokens.css` (custom properties) and
     `styles.css` (layout and components, moved from `public/`).
   - No inline `style="…"` attributes, no `<style>` blocks, and no styles
     set from JavaScript. JS toggles classes or attributes (`is-collapsed`,
     `aria-checked`) and the stylesheet styles them.
   - `tokens.css` is the source of truth for the mockups' design decisions
     (e.g. `--black-ish: #141414`, `--border-control: #d6d6d6`,
     `--radius-control: 10px`, `--control-height: 44px`). Component CSS
     only reads from it.
6. **Responsive, with breakpoints:** one form that adapts to the width,
   not three layouts. Mobile-first: the phone layout is the default, and
   `min-width` media queries add the tablet and desktop layouts. The
   breakpoints are set in ticket 2.
7. **No Bootstrap or other component library** on the form. A component
   library may come with the React refactor.
8. **Keep the logo** at the far left of the site `<header>`:
   `public/assets/images/logo-esl-scaffolder-icon-size.svg`, 36×36. The
   mockups only show the form, not the site header, so this isn't in them.
9. **Output order.** The Word download and the preview show each
   version's parts in this order, skipping any that are off or empty:
   1. Title header, as today
   2. Image (optional)
   3. Summary (optional)
   4. Article. With sections on, each section's questions follow that
      section.
   5. Glossary, one complete list
   6. Questions, when sections are off: after the glossary, as today
   7. Cloze passage (optional)
   8. Answer key, at the end of the Word file only, as today
10. **Bold glossary words** wherever they appear in the summary and the
    article, every time, including other forms of the word ("habitats"
    for the term "habitat"). Not in the questions or the cloze passage.
    Articles generated before this change stay without bold.

**Roadmap only, not in these tickets:** saved, named option sets. See
[Ticket 9](#ticket-9-roadmap-saved-option-sets).

## How the work is split

### Feature branches and merge order

Every ticket is its own branch and PR, so each review is small. To keep
`main` working while the frontend and backend change shape, the ticket PRs
target an integration branch, `feat/article-versions`. One final PR merges
that branch into `main`.

```
main
 └─ feat/article-versions            (integration; final PR → main)
     ├─ 1  versions-contract          contract + shared fixtures
     ├─ 2  design-tokens              FE: tokens.css, no behavior change
     ├─ 3  article-form               FE: the new form
     ├─ 4  db-versions                DB: migration runner + schema
     ├─ 5  api-versions               BE: routes, validation, uploads
     ├─ 6  prompt-versions            BE: prompt, schema, research
     ├─ 7  docx-versions              BE: Word output
     └─ 8  detail-versions            FE: detail page + preview
```

### Frontend first, with a consumer-driven contract

Starting with the frontend makes sense: the form decides what data the
backend must accept. Ticket 1 turns that into a contract the backend is
tested against.

- The contract is the request and response shapes, plus JSON fixtures in
  `test/contracts/`.
- Backend tests (tickets 5–7) check the server against the same fixtures.
- The frontend's payload-building code is a pure function, so a Node test
  can check that it produces the fixture payload.

So both sides test against the same files, without a separate contract
tool.

Review order is 1 → 2 → 3, then backend 4 → 7, then 8. Ticket 3 can be
reviewed early but only works end to end once ticket 5 lands. That's fine,
because it merges into the integration branch, not `main`.

### Why the database changes come before the API

Yes, the schema has to change before the API can store the new choices:

- Rows are keyed by level id (`k`, `g5`, `g10`). Versions need a key of
  their own (1–3), because two versions may share a grade, e.g. Grade 3 in
  Spanish and Grade 3 in Arabic.
- The options live in one article-wide JSON keyed by level. Each version
  now has its own grade, counts, translation, toggles and image.
- `initDb()` only runs `CREATE TABLE IF NOT EXISTS` plus one hand-written
  `ALTER TABLE`. Reshaping tables safely needs a small, ordered migration
  runner.

## Tickets

### Ticket 1: Versions contract

Branch `feat/versions-contract`. Docs and fixtures only.

- `docs/api-contract.md`: the request and response shapes below, with
  field types, limits and error responses.
- `POST /api/articles` (multipart): `title`, `uploaded_by`, `mode`,
  `file` or `text`, `versions` (a JSON string, array of 1–3), and
  `image_1` … `image_3` files matched to versions by number.
  `uploaded_by` is required.
  Each version:
  `{ number, grade, questions, terms, translationLanguage, summary, sections, cloze }`.
- `GET /api/config`: adds `grades` (K–12 ids and labels), `maxVersions: 3`,
  `maxQuestions: 15`, `maxTerms: 15`, image types and size limit.
- `GET /api/articles/:id`: `versions` replaces `levels`.
- `GET /api/articles/:id/versions/:n`: content adds `summary`,
  `sections: [{ heading, paragraphs, questions }]`, `cloze`, `imageUrl`.
  In `summary` and the paragraphs, glossary words are wrapped in
  `**…**` markers (requirement 10).
- Fixtures in `test/contracts/` for a valid upload, each validation error,
  and each response.
- The old `/levels/:level` routes are removed, not kept as aliases.

### Ticket 2: Design tokens

Branch `feat/design-tokens`. Frontend, no behavior change.

- `public/assets/styles/tokens.css`: every color, radius, size, spacing
  and font value from the mockups as a custom property, named by intent
  (`--color-text`, `--border-control`, `--control-height`,
  `--radius-card`, …).
- Move `public/styles.css` to `public/assets/styles/styles.css`.
  `index.html` links `tokens.css` first, then `styles.css`.
- `styles.css` reads only from tokens. No raw hex values outside
  `tokens.css`.
- **Breakpoints,** mobile-first, set between the mockup widths:
  - Default (no media query): phone layout, the 390px mockup.
  - `min-width: 600px`: tablet layout, the 834px mockup.
  - `min-width: 1024px`: desktop layout, the 1280px mockup.

  Custom properties don't work inside `@media`, so write these values
  literally and list them by name in a comment at the top of
  `tokens.css`.

- Replace the one style set from JS, `counter.style.color` for the
  word-count warning in `upload-form.js`, with a class.
- The mockups set new values: monochrome `#141414` replaces today's blue
  accent, and controls are 44px tall (48px on mobile). The whole app takes
  the new look, by pointing today's variables at the new tokens, so the
  form and the detail page don't look like two different products.
- The site header keeps the logo at the far left. The logo's stroke color
  (`#141414`) is written into the SVG file, so it can't read a token. If
  `--black-ish` ever changes, either update the SVG to match or inline it
  with `stroke="currentColor"`.

### Ticket 3: Article form

Branch `feat/article-form`. Frontend.

- The new form from the mockups: an Upload file / Paste text segmented
  control, the drop zone, title and uploaded-by fields, and version cards
  you can add, remove, collapse and expand.
  - The add button reads "Add version". At 3 versions it's replaced by
    the note "You've reached the maximum of 3 versions."
  - The submit button reads "Create N versions".
  - Collapsed cards show a one-line summary, e.g.
    "8 questions · 8 terms · Spanish · Sections".
- **Responsive layout:** one form that matches the mockups at 390, 834
  and 1280px, using the ticket 2 breakpoints. On mobile the footer is
  sticky. No horizontal scroll down to 320px.
- Move every inline style from the mockups into classes in
  `styles.css`. The mockups have no media queries, so turn the
  differences between the three files into breakpoint rules.
- **Controls:** number steppers (0–15), switches, a per-version image
  picker with a preview and remove button, and info tooltips.
- **Accessibility:**
  - The mockups put the info button inside the `<label>`, so clicking the
    label can open the tooltip instead of focusing the field. Move the info
    button out of the label and link the tooltip with `aria-describedby`.
  - Tooltips open on focus and tap, not just hover, and close with Escape.
  - Switches use `role="switch"` and `aria-checked`.
- **Client-side checks:**
  - "Uploaded by" is required. It's still remembered in the browser
    between uploads, as today.
  - Cloze is disabled while glossary terms are 0, with a note saying why.
  - The image's type and size are checked before upload.
- **Build the request:** a pure function turns the form's state into the
  contract payload, tested against the ticket 1 fixture.
- Vanilla ES modules built with `createElement`, per CLAUDE.md. No
  Bootstrap, and no inline styles (requirement 5).
- Leave the site header and its logo as they are; only the form is
  replaced. Update the header tagline, which still says "Kindergarten,
  Grade 5 and Grade 10", to describe choosing up to 3 grade levels.

### Ticket 4: Database migration

Branch `feat/db-versions`.

- **Migration runner:** numbered SQL files in `server/db/migrations/`,
  tracked with `PRAGMA user_version`, each applied in a transaction on
  startup. `schema.sql` becomes migration 1. The `duration_ms` ALTER in
  `initDb()` becomes migration 2.
- **Migration 3:**
  - `level_outputs` becomes `article_versions`, with `version_number`
    (1–3), `grade`, `options_json` (that version's choices) and
    `image_path`. Unique on (article_id, version_number).
  - Existing `k`, `g5` and `g10` rows become versions 1–3 with grades K, 5
    and 10. Their options are copied from the article's `options_json`.
  - `usage` gains `version_number`.
- **Repo:** update the `repo.js` functions to the new names and keys.
- **Tests:**
  - Migrating a database built with today's schema keeps every article,
    level and usage row.
  - Running the migrations twice is a no-op.
- `POSTGRES:` notes on each migration where the SQL differs.

### Ticket 5: API for versions

Branch `feat/api-versions`.

- **Upload:** multer `.fields()` takes the article file plus up to 3 images.
  Images must be PNG or JPEG, up to 5 MB each, and aren't sent to the
  model. They're saved under `data/uploads/<id>/version-<n>.<ext>`.
- **Validation in `validate.js`:**
  - "Uploaded by" is required (`cleanText` with `required: true`).
    Existing articles without one keep their null value; upload tests that
    leave it out are updated.
  - 1–3 versions.
  - Grade must be K–12.
  - Counts must be 0–15.
  - The language must be in the list.
  - Cloze requires terms ≥ 1.
  - Version numbers must be unique.
- **Budget:** reserve for N versions instead of a fixed 3. Start one job per
  version.
- **Routes:** retry, regenerate, preview and download move to
  `/articles/:id/versions/:n/...`. Add `GET .../image`.
- `/api/config` serves the ticket 1 additions.
- Contract tests from ticket 1 pass. Every new route gets a test, per
  CLAUDE.md.
- **Cost check:** summary, sections and cloze add output to each version.
  - Measure output tokens, and raise `maxTokensPerLevel` if needed.
  - A worst-case 20,000-word article at 3 versions on Sonnet 5.5 costs
    about $0.45 today. Expect somewhat more with every option on, against
    the $5 daily cap.

### Ticket 6: Prompt and generation

Branch `feat/prompt-versions`.

- **Research first:** summarize the guidance in the PR description, with
  sources. Starting points to verify:
  - Text-dependent question guidance from Student Achievement Partners /
    Achieve the Core.
  - The Question-Answer Relationship (QAR) framework.
  - Beck, McKeown & Kucan's "Tier 2" words for vocabulary selection. The
    mockup's tooltip already describes Tier 2 words: they carry meaning
    and show up across subjects.
- **Grade guidance:** replace the three fixed `LEVELS` entries with K–12
  guidance, written as grade bands (K–1, 2–3, 4–5, 6–8, 9–10, 11–12) plus
  the exact grade.
- **Questions:**
  - Prioritize evidence and inference over recall.
  - Multiple choice only below Grade 3, as the mockup tooltip says.
  - With sections on, questions are distributed across sections.
- **Output schema:** add `summary`, `sections`, and `cloze`
  (`{ text with numbered blanks, answers }`), each present only when
  chosen. `normalizeContent` validates them, e.g. that cloze blanks only
  use glossary terms.
- **Glossary markers:** the model wraps each glossary word in the summary
  and paragraphs in `**…**`, including other forms of the word.
  `normalizeContent` removes markers around words that aren't glossary
  terms, so a stray marker shows as plain text.
- Golden prompt fixtures updated; unit tests for the schema per option.

### Ticket 7: Word output

Branch `feat/docx-versions`.

- **Render the new parts in the requirement 9 order:** image
  (`ImageRun`, with alt text), summary, the reading (each section
  followed by its questions when sections are on), the whole glossary,
  the questions when sections are off, then the cloze passage.
- **Bold glossary words:** turn `**…**` markers in the summary and
  paragraphs into bold `TextRun`s, without the asterisks.
- **Answer key:** covers per-section questions and the cloze answers.
- Old articles without these fields still render.
- Golden docx fixtures for each option.

### Ticket 8: Detail page and preview

Branch `feat/detail-versions`. Frontend.

- **Version cards:** one card per version (1–3), labelled with the version
  number and grade. Retry, regenerate and download call the version routes.
- **Preview:** renders the image, summary, sections, glossary, questions
  and cloze in the requirement 9 order, the same as the Word file.
- **Bold glossary words:** turn `**…**` markers into `<strong>` elements
  built with `createElement` and text nodes, never `innerHTML`.
- **Retry all:** "Try again for all N failed versions" keeps working.
- Styled with the ticket 2 tokens and breakpoints, in the global
  stylesheets.

### Ticket 9 (roadmap): Saved option sets

Not scheduled. Depends on login (`LOGIN:` markers).

- **User story:** as a teacher of several classes, I want to save the form's
  version settings under a name for each class, so I can produce materials
  for that class quickly.
- **Example:** "Period 3 English Fall 2026" might contain:
  - Kindergarten: 5 glossary terms, 5 questions, Spanish translation, no
    image, no summary, sections on, cloze on.
  - Grade 3 with its own settings, and so on.
- **UI sketch:** a checkbox at the end of the form, "Save these selections
  for use on other articles?", with a name field, plus a picker at the top
  of the form to load a saved set.
- **Data sketch:** an `option_sets` table owned by a user, holding the
  versions array in the ticket 1 contract shape. Images aren't saved.
- Tickets 1 and 4 should keep version options as one self-contained JSON
  shape, so a saved set can reuse it unchanged.

## Decisions

1–8 confirmed 2026-10-23; 9–12 added 2026-10-26.

| #   | Question                                    | Decision                                                                                             |
| --- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | Max versions                                | 3, as in the mockups                                                                                 |
| 2   | New look for the whole app or only the form | Whole app (ticket 2)                                                                                 |
| 3   | "Uploaded by" required or optional          | Required                                                                                             |
| 4   | Keep old `/levels/:level` routes as aliases | No, remove them                                                                                      |
| 5   | Image limits                                | PNG or JPEG, up to 5 MB each, not sent to the model                                                  |
| 6   | Allow two versions with the same grade      | Yes, keyed by version number                                                                         |
| 7   | Ticket PRs target an integration branch     | Yes, `feat/article-versions`                                                                         |
| 8   | Translation languages                       | Keep today's 14                                                                                      |
| 9   | Where CSS lives                             | Global files in `public/assets/styles/`, no inline styles                                            |
| 10  | Responsive approach                         | Mobile-first; breakpoints at 600px and 1024px                                                        |
| 11  | Output order                                | Image, summary, article, glossary, questions, cloze; with sections on, questions follow each section |
| 12  | Bold glossary words                         | Yes, in the summary and article, marked by the model as `**…**`                                      |
