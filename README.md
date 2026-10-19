# ESL Article Leveler

Upload an English article and get three editable Word files for ESL learners. There is one file each for **Kindergarten**, **Grade 5** and **Grade 10**, and each file contains:

- the article, rewritten for that reading level
- a glossary of key terms, with definitions and example sentences written at that level, plus an optional translation into the student's home language
- comprehension questions (multiple choice, plus short answer for Grades 5 and 10), with an answer key on the last page

Every upload and its generated files are saved together. Click an article's name to see the original and all three levels, preview them in the browser, download them, or regenerate one level. No login is needed.

## Setup

You need Node.js 20 or newer and an Anthropic API key from <https://console.anthropic.com>.

```bash
npm install
cp .env.example .env      # then put your key in ANTHROPIC_API_KEY
npm start                 # or: npm run dev  (restarts on file changes)
npm test                  # retry, race and prompt tests (fake model, temp database)
```

Open <http://localhost:3000>.

| Setting (`.env`)    | Default           | Meaning                                    |
|---------------------|-------------------|--------------------------------------------|
| `ANTHROPIC_API_KEY` | —                 | Required for generating levels.            |
| `CLAUDE_MODEL`      | `claude-sonnet-5-5` | Model used for all levels.               |
| `DAILY_BUDGET_USD`  | `5`               | Daily spending cap (see below).            |
| `PORT`              | `3000`            | Web server port.                           |
| `MODEL_TIMEOUT_MS`  | `180000`          | Time limit for one Claude call.            |

Everything is stored in `data/`:
- `app.db` is the SQLite database.
- `uploads/<id>/` holds the original files.
- `outputs/<id>/` holds the generated .docx files.

Back up this folder to keep your articles.

## How it works

1. **Upload.** The teacher either uploads a file (PDF, .docx, .txt or .md) or pastes text, then sets options. The server pulls out the text and checks the limits:
   - 20,000 words or fewer
   - 10 MB per file
   - title up to 150 characters
   - "uploaded by" name up to 60 characters
   - pasted text up to 160,000 characters

   The title and name are also run through a profanity filter.
2. **Background jobs.** The upload request returns right away. Three Claude calls then run in parallel, one per level. Each call returns **structured JSON** containing the title, paragraphs, glossary, multiple-choice questions and short-answer questions. That JSON is saved in the database.
3. **Rendering.** The JSON is turned into a `.docx` file using the `docx` package. The browser preview uses the same JSON.
4. **Status.** The page checks for updates every 3 seconds and shows each level as *Waiting*, *Processing…*, *Ready* or *Failed*.
5. **Failures.** A call is retried once on the server, but only when a second try could help: a timeout, a network error, an overloaded API, or a response that isn't valid JSON. Refusals, cut-off responses and bad requests are not retried. If the level still fails, it is marked failed with a reason, and nothing is saved for it. The level card then shows **Try Again**, which reuses the stored text (no re-upload). When more than one level failed, one button retries them all. If the server is restarted mid-job, unfinished levels are marked failed when it starts again.
6. **No duplicate calls.** Try Again, Regenerate and the upload all start work by moving the level to `pending` with one conditional `UPDATE … WHERE status = 'failed'`. Only the request that changes the row starts a model call, so double clicks get `409`.
7. **Timing.** Each Claude call logs one line, for example `[model] article=12 level=g5 attempt=1 chars=48211 words=8120 ms=41230 stop=end_turn ok=true`. The duration is also saved in `usage.duration_ms`, so you can check whether long articles are getting close to `MODEL_TIMEOUT_MS`.

Levels, default counts, translation languages and limits are all defined in `server/config.js`.

### Project layout

```
server/
  index.js              starts the server
  app.js                Express app + error handling
  config.js             levels, languages, limits, model prices
  db/schema.sql         tables
  db/index.js           opens SQLite
  db/repo.js            ALL SQL queries
  routes/articles.js    REST API
  services/
    extract.js          file → text (pdf-parse, mammoth)
    validate.js         character limits, profanity filter, option parsing
    prompt.js           instructions + JSON schema for one level
    leveler.js          Claude call, response checks, timing log
    docx.js             JSON → Word document
    jobs.js             background runner
    budget.js           daily spending cap
    storage.js          file save/delete on local disk
public/                 index.html, styles.css
  js/                   vanilla JS, native ES modules (no build step)
    main.js             entry point + hash routing
    upload-form.js      new-article form
    article-list.js     home-page list + search
    article-detail.js   article page, level cards, Try Again / Regenerate
    level-preview.js    in-browser preview of one level
    polling.js          3-second refresh + usage footer
    api.js, dom.js, format.js, state.js   shared helpers
```

### API

| Method & path                                    | Purpose                                                        |
|--------------------------------------------------|----------------------------------------------------------------|
| `GET /api/config`                                | Levels, languages and limits for the form                      |
| `GET /api/articles?q=`                           | List articles, with optional search by title or uploader       |
| `POST /api/articles`                             | Multipart form: `mode` (`file`/`paste`), `file` or `text`, `title`, `uploaded_by`, `terms_<level>`, `questions_<level>`, `translate`, `language` |
| `GET /api/articles/:id`                          | One article with the status of each level                      |
| `GET /api/articles/:id/levels/:level`            | A level's content JSON, used for the preview                   |
| `POST /api/articles/:id/levels/:level/retry`     | Try a failed level again: `202` started, `409` already running, `200` already done (returns the content) |
| `POST /api/articles/:id/retry`                   | Try all failed levels again: `202 { claimed }`, `409` or `200` |
| `POST /api/articles/:id/levels/:level/regenerate`| Run a failed or ready level again: `202`, or `409` if it is already running |
| `GET /api/articles/:id/original`                 | Download the original file                                     |
| `GET /api/articles/:id/levels/:level/download`   | Download a level's .docx                                       |
| `DELETE /api/articles/:id`                       | Delete the article, its database rows and all of its files     |
| `GET /api/usage/today`                           | `{ spentUsd, capUsd }`                                         |

Level ids are `k`, `g5` and `g10`.

## Daily spending cap

The app is meant to run on a personal API account, so it stops itself from spending more than `DAILY_BUDGET_USD` (default **$5**) per day. Days are counted in US Eastern time.

- **Recording spend.** Every Claude response reports the tokens it used. The app works out the cost from the per-model prices in `config.js` and saves it in the `usage` table. Deleting an article does not remove its usage rows, so deleted work still counts toward the day.
- **Checking before work starts.** Before any generation or regeneration, the app adds up three things:
  - what has already been spent today
  - the worst-case cost of jobs that are still running
  - the worst-case cost of the new job, based on the article's length and the maximum output allowed per level

  If the total would go over the cap, the request is refused with *"Daily limit reached, try again tomorrow."* No job is started and nothing is charged.
- **Seeing spend.** The page footer shows "Today's usage: $x.xx of $5.00".
- **Changing the cap.** Set `DAILY_BUDGET_USD` in `.env` and restart the server.
- **Backstop.** As a second safety net, also set a monthly spend limit in the Anthropic Console.

A typical article costs well under the cap. With the default model (Sonnet 5.5), the worst case for a 20,000-word article is about $0.50 (three levels at the maximum output length), and shorter articles cost much less. To keep that cost down, rewritten articles are capped at about 1,000 words (Grade 5) and 1,500 words (Grade 10). Switching `CLAUDE_MODEL` to `claude-opus-5-5` roughly doubles the cost per article.

If you change models or Anthropic changes its prices, update `MODEL_PRICES` in `server/config.js`. Models that aren't in that table are charged at the most expensive rate listed, so the cap stays safe.

## Migrating later (TypeScript, React, Postgres)

The code is arranged so each of these can be done on its own. Look for the `// POSTGRES:`, `// REACT:`, `// LOGIN:` and `// DRIVE:` comments; they mark the exact places that will change.

### TypeScript
- Convert the files in this order: `config.js` → `db/repo.js` → `services/*` → `routes/*` → `index.js`.
- Start with the content JSON shape, `{ title, paragraphs, glossary, multipleChoice, shortAnswer }`, which is produced in `services/leveler.js`. Make it a shared type that both the server and a React frontend import.
- The Claude SDK already ships with TypeScript types. You can also replace the hand-written JSON schema in `leveler.js` with a Zod schema and use `zodOutputFormat`.

### React frontend
- The server only returns JSON, apart from file downloads, so React can call the same `/api/*` endpoints without changing the backend.
- Each file in `public/js/` maps to a component: `ArticleList`, `ArticleDetail` (with `LevelCard`), `LevelPreview` and `UploadForm`.
- The hash routing becomes React Router.
- The 3-second polling becomes a data-fetching hook with a refetch interval, such as React Query.
- Build the app (for example with Vite) and serve its `dist/` folder from `server/index.js` in place of `public/`.

### Postgres
Only `server/db/` needs to change:
- `db/index.js`: replace sqlite with a `pg` Pool, and run the schema through a migration tool such as node-pg-migrate.
- `db/repo.js`: change the placeholders from `?` to `$1, $2…`, use `RETURNING id` instead of `lastID`, and switch `LIKE` to `ILIKE`.
- `schema.sql`: change the column types as follows.

  | SQLite                              | Postgres                         |
  |-------------------------------------|----------------------------------|
  | `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL` / `GENERATED AS IDENTITY` |
  | `TEXT` timestamps                   | `TIMESTAMPTZ DEFAULT now()`      |
  | `options_json`, `content_json` TEXT | `JSONB`                          |

When the app is hosted on more than one server, two other things also have to change:
- **File storage:** move from local disk to S3 or Google Cloud Storage. Only `services/storage.js` changes.
- **Background jobs:** move to a real queue (`services/jobs.js`), for example pg-boss on Postgres.

## Roadmap

These features are planned but not built yet:

- **Google Drive links** as an input, alongside file upload and pasted text.
- **Login.** "Uploaded by" would be filled in automatically from the signed-in teacher, so teachers could follow colleagues' materials. This would also allow per-user usage limits.
- **TypeScript, React and Postgres**, as described above.
- **Cloud file storage** (S3, Google Cloud Storage or Drive) instead of local disk.
- **OCR for scanned PDFs.** Right now, only PDFs that contain real text can be read.
- **More grade levels**, such as Grades 2 and 8. Adding a level only needs a new entry in `LEVELS` in `config.js`.
- **More question types**, such as true/false.
- **Part-of-speech labels** in the glossary.
- **Optional PDF output** alongside .docx.
- **More translation languages.**
- **A higher or per-user budget** once the app moves off a personal API account.
