-- POSTGRES: INTEGER PRIMARY KEY AUTOINCREMENT → SERIAL (or GENERATED ... AS IDENTITY),
-- TEXT timestamps → TIMESTAMPTZ DEFAULT now(), options_json/content_json → JSONB.

CREATE TABLE IF NOT EXISTS articles (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  title             TEXT NOT NULL,
  uploaded_by       TEXT,              -- LOGIN: becomes user_id REFERENCES users(id)
  source_type       TEXT NOT NULL,     -- 'file' | 'paste'  (DRIVE: add 'gdrive')
  original_filename TEXT,
  original_path     TEXT,
  extracted_text    TEXT NOT NULL,
  word_count        INTEGER NOT NULL,
  options_json      TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS level_outputs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id   INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  level        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | processing | ready | failed
  content_json TEXT,
  docx_path    TEXT,
  error        TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_level_outputs_article_level ON level_outputs(article_id, level);

-- No FK to articles: spend must still count after an article is deleted.
CREATE TABLE IF NOT EXISTS usage (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  day           TEXT NOT NULL,         -- YYYY-MM-DD in the budget time zone
  article_id    INTEGER,
  level         TEXT,
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd      REAL NOT NULL,
  duration_ms   INTEGER,               -- model call time, to watch for long articles nearing the timeout
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_usage_day ON usage(day);
