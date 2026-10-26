# API contract: article versions

The request and response shapes for up to 3 versions per article, from
[ticket 1 of the article-form plan](decisions/2026-10-article-form.md#ticket-1-versions-contract).

The JSON fixtures in [`test/contracts/`](../test/contracts/) are the
source of truth. This page explains them. Both sides test against the
same files:

- **Frontend (ticket 3):** the function that builds the upload request
  from the form's state must produce `upload-request.json`.
- **Backend (tickets 5–7):** the server must answer each fixture request
  with the fixture response.

Until ticket 5 lands, the server still serves the old `levels` API.

## Fixtures

| File                             | What it holds                                                      |
| -------------------------------- | ------------------------------------------------------------------ |
| `upload-request.json`            | Valid upload: pasted text, 3 versions, images for versions 1 and 3 |
| `upload-request-minimal.json`    | Valid upload: a file, 1 version, everything off, no image          |
| `upload-response.json`           | `201 { id }`                                                       |
| `upload-errors.json`             | One case per validation rule, each with its `400` message          |
| `config-response.json`           | `GET /api/config`                                                  |
| `article-response.json`          | `GET /api/articles/:id` for the `upload-request.json` article      |
| `article-list-response.json`     | `GET /api/articles`, including an article migrated from levels     |
| `version-response-ready.json`    | A ready version, sections off, with translation, summary and cloze |
| `version-response-sections.json` | A ready version, sections on                                       |
| `version-response-failed.json`   | A failed version, `content: null`                                  |
| `version-actions.json`           | Retry, regenerate, retry all, and the `404`s                       |

**Requests** have `fields` and `files`, the parts of a multipart form:

- `fields` are text fields. `versions` is shown as an array for
  readability. Send it as `JSON.stringify(versions)`. When a fixture
  gives `versions` as a string, send that string as it is.
- `files` are keyed by form field name. `text` is the file's contents.
  `sizeBytes` means: build a file of that size, starting with the PNG or
  JPEG signature for its `contentType`.

**Responses** have `status` and either `body`, compared with
`deepStrictEqual`, or `bodyFixture`, naming another fixture whose `body`
is expected.

## Shapes

### Version options

What the teacher chooses for one version. It's sent in the upload,
returned in every version, and is the shape a saved option set will
reuse ([ticket 9](decisions/2026-10-article-form.md#ticket-9-roadmap-saved-option-sets)).
Every field is required.

| Field                 | Type           | Rule                                                 |
| --------------------- | -------------- | ---------------------------------------------------- |
| `number`              | integer        | 1, 2, 3 in array order                               |
| `grade`               | string         | `"k"` or `"g1"` … `"g12"`                            |
| `questions`           | integer        | 0–15                                                 |
| `terms`               | integer        | Glossary terms, 0–15                                 |
| `translationLanguage` | string or null | `null` for no translation, else one of `languages`   |
| `summary`             | boolean        | Short summary before the article                     |
| `sections`            | boolean        | Break the article into sections, each with questions |
| `cloze`               | boolean        | Cloze passage. Needs `terms` ≥ 1                     |

The image isn't an option field. It's sent as the file `image_<number>`.

### Version status

Each entry in an article's `versions`: the version options plus

| Field        | Type           | Notes                                                        |
| ------------ | -------------- | ------------------------------------------------------------ |
| `gradeLabel` | string         | `"Kindergarten"`, `"Grade 1"` …                              |
| `imageUrl`   | string or null | `/api/articles/:id/versions/:n/image`, or `null` if no image |
| `status`     | string         | `pending`, `processing`, `ready` or `failed`                 |
| `error`      | string or null | A message for teachers, when `failed`                        |
| `updatedAt`  | string         | Last status change, UTC, `YYYY-MM-DD HH:MM:SS`               |

### Version detail

`GET /api/articles/:id/versions/:n`: the version status plus `content`,
which is `null` until the version is ready.

### Content

| Field            | When                 | Shape                                                    |
| ---------------- | -------------------- | -------------------------------------------------------- |
| `title`          | Always               | string                                                   |
| `summary`        | `summary` on         | string, with glossary markers                            |
| `paragraphs`     | `sections` off       | string[], with glossary markers                          |
| `multipleChoice` | `sections` off       | `[{ question, options: [4 strings], correctOption }]`    |
| `shortAnswer`    | `sections` off       | `[{ question, modelAnswer }]`                            |
| `sections`       | `sections` on        | `[{ heading, paragraphs, multipleChoice, shortAnswer }]` |
| `glossary`       | Always (may be `[]`) | `[{ term, definition, example }]`                        |
| `cloze`          | `cloze` on           | `{ text, answers: [{ blank, answer, term }] }`           |

- `correctOption` is `"A"` to `"D"`.
- Below Grade 3 there's no short answer, so `shortAnswer` is `[]`.
- With a translation, each glossary entry also has `translatedTerm` and
  `translatedDefinition`.
- **Glossary markers:** in `summary` and `paragraphs`, each glossary word
  is wrapped in `**…**`, including other forms of the word
  (`**hunts**` for the term `hunt`). Renderers show it in bold without
  the asterisks. Versions generated before ticket 6 have no markers.
- **Cloze blanks:** `text` marks blank N as `[[N]]`, numbered from 1.
  `answers[i]` fills blank `i + 1`: `answer` is the word as it fits the
  sentence, and `term` is the glossary term it comes from.
- Versions migrated from levels have only `title`, `paragraphs`,
  `glossary`, `multipleChoice` and `shortAnswer`.

## Routes

All JSON. Errors are `{ "error": "message for the teacher" }`.

### `GET /api/config`

The settings the form needs. Fixture: `config-response.json`.

- **Added:** `grades` (`[{ id, label }]`, K–12), `maxVersions: 3`,
  `maxQuestions: 15`, `maxTerms: 15`, `versionDefaults` (the options a
  new version card starts with, without `number`), and
  `image: { types, extensions, maxBytes }`.
- **Removed:** `levels`, and `maxCount` from `limits`.
- **Unchanged:** `languages`, and the rest of `limits`.

### `POST /api/articles`

Multipart form. Fixtures: `upload-request.json`,
`upload-request-minimal.json`, `upload-response.json`,
`upload-errors.json`.

| Field                 | Rule                                                                         |
| --------------------- | ---------------------------------------------------------------------------- |
| `title`               | **Required**, up to 150 characters. No longer taken from the text when blank |
| `uploaded_by`         | **Required**, up to 60 characters                                            |
| `mode`                | `"file"` or `"paste"`                                                        |
| `file`                | With `mode=file`: `.pdf`, `.docx`, `.txt` or `.md`, 10 MB                    |
| `text`                | With `mode=paste`: up to 160,000 characters                                  |
| `versions`            | JSON string: an array of 1–3 version options                                 |
| `image_1` … `image_3` | Optional. PNG or JPEG, up to 5 MB, for the matching version                  |

- **201** `{ id }`: saved, and one job started per version.
- **400**: the first rule that fails, with the message in
  `upload-errors.json`. Nothing is saved and no budget is reserved.
  Two unchanged errors aren't in the fixture because they need large
  inputs: over 20,000 words, and an article file over 10 MB.
- **429**: the daily budget can't cover all the versions.
- **Removed fields:** `terms_<level>`, `questions_<level>`, `translate`,
  `language`.

Images aren't sent to the model.

### `GET /api/articles` and `GET /api/articles/:id`

The list (newest first, optional `?q=` search) and one article. Both use
the same article shape. Fixtures: `article-list-response.json`,
`article-response.json`. `404` if the article doesn't exist.

- `versions` (version status, ordered by `number`) replaces `levels`.
- The article-wide `options` is removed. Each version carries its own.
- `status` is `processing` while any version is pending or processing,
  `failed` if any failed, otherwise `ready`. Same rule as today.

### `GET /api/articles/:id/versions/:n`

One version's detail. Fixtures: `version-response-ready.json`,
`version-response-sections.json`, `version-response-failed.json`.

### Version files

- `GET /api/articles/:id/versions/:n/download`: the version's `.docx`,
  named `<title>-v<n>-<grade>.docx`, e.g.
  `fox-feeding-habits-grades-1-3-and-6-v1-grade-1.docx`. The version
  number keeps two versions with the same grade apart. `404` until ready.
- `GET /api/articles/:id/versions/:n/image`: the uploaded image, with
  its content type. `404` if the version has none.

### Version actions

Fixture: `version-actions.json`.

- `POST /api/articles/:id/versions/:n/retry`: Try Again for a failed
  version. `202 { articleId, number, status: "pending" }` when started;
  `200` with the version detail if it's already ready; `409` while it's
  running.
- `POST /api/articles/:id/versions/:n/regenerate`: run a ready or failed
  version again. `202` as above; `409` while it's running.
- `POST /api/articles/:id/retry`: Try Again for every failed version.
  `202 { articleId, claimed: [numbers] }`; `409` while any version is
  running; `200` with the article if nothing failed.
- A `:n` the article doesn't have, or that isn't a number, is `404`
  `Version not found.`

### Unchanged

`DELETE /api/articles/:id`, `GET /api/articles/:id/original` and
`GET /api/usage/today`.

### Removed

Every `/api/articles/:id/levels/:level/...` route. They now get the
general `404 Not found.`; there are no aliases.
