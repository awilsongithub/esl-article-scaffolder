-- POSTGRES: INTEGER PRIMARY KEY AUTOINCREMENT → SERIAL
-- (or GENERATED ... AS IDENTITY), TEXT timestamps → TIMESTAMPTZ DEFAULT now(),
-- options_json/content_json → JSONB.

-- One row per uploaded article: the original text and the teacher's options.
-- Its leveled versions are in level_outputs.
CREATE TABLE IF NOT EXISTS articles (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  -- From the form, or derived from the article's heading or filename.
  title             TEXT NOT NULL,
  -- Free-text name from the form; null when left blank.
  -- LOGIN: becomes user_id REFERENCES users(id)
  uploaded_by       TEXT,
  -- 'file' | 'paste'  (DRIVE: add 'gdrive')
  source_type       TEXT NOT NULL,
  -- The uploaded file's name; null for pasted text.
  original_filename TEXT,
  -- Where the uploaded file is saved (data/uploads/<id>/original.<ext>).
  -- Null for pasted text.
  original_path     TEXT,
  -- The plain text every level is generated from.
  -- Kept so Try Again and Regenerate don't need the file again.
  extracted_text    TEXT NOT NULL,
  word_count        INTEGER NOT NULL,
  -- The teacher's choices, as JSON:
  -- { counts: { k: { terms, questions }, g5: {...}, g10: {...} },
  --   translationLanguage: "Spanish" | null }
  options_json      TEXT NOT NULL,
  -- UTC, as 'YYYY-MM-DD HH:MM:SS'.
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per article per reading level ('k', 'g5', 'g10'),
-- so every article has three rows here.
-- Each row holds that level's status and its generated worksheet content.
-- Rows are created 'pending' with the article, and deleted with it.
CREATE TABLE IF NOT EXISTS level_outputs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id   INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  -- A level id from LEVELS in config.js.
  level        TEXT NOT NULL,
  -- pending → processing → ready | failed.
  -- Try Again and Regenerate move it back to pending.
  status       TEXT NOT NULL DEFAULT 'pending',
  -- Everything generated for this level, as one JSON object:
  -- { title, paragraphs: [string],
  --   glossary: [{ term, definition, example,
  --                translatedTerm?, translatedDefinition? }],
  --   multipleChoice: [{ question, options: [4 strings], correctOption }],
  --   shortAnswer: [{ question, modelAnswer }] }
  -- The .docx and the in-browser preview are both rendered from it.
  -- Set when the level becomes ready; cleared when it runs again or fails.
  content_json TEXT,
  -- Where this level's .docx is saved (data/outputs/<id>/<level>.docx).
  -- Null until the level is ready.
  docx_path    TEXT,
  -- Teacher-readable reason the level failed; null otherwise.
  error        TEXT,
  -- Last status change, UTC.
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
-- At most one row per article and level.
CREATE UNIQUE INDEX IF NOT EXISTS idx_level_outputs_article_level ON level_outputs(article_id, level);

-- One row per billed model call, for the daily budget.
-- Usually one per level, but a retry, Try Again or Regenerate adds another.
-- No FK to articles: spend must still count after an article is deleted.
CREATE TABLE IF NOT EXISTS usage (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- YYYY-MM-DD in the budget time zone.
  day           TEXT NOT NULL,
  -- The article and level the call was for.
  -- The ids stay after the article is deleted.
  article_id    INTEGER,
  level         TEXT,
  -- The model that answered, which may be a fallback model.
  model         TEXT NOT NULL,
  -- Includes cache reads and writes, which are billed as input.
  input_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  -- Priced from MODEL_PRICES in config.js when the call was recorded.
  cost_usd      REAL NOT NULL,
  -- Model call time, to watch for long articles nearing the timeout.
  duration_ms   INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Today's spend is summed by day.
CREATE INDEX IF NOT EXISTS idx_usage_day ON usage(day);
