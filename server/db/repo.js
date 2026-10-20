// All SQL lives in this file. Every function is async so callers don't change when the driver does.
// POSTGRES: swap getDb() for a pg Pool; `?` placeholders → `$1, $2…`; `lastID` → `RETURNING id`;
// datetime('now') → now(); LIKE → ILIKE for case-insensitive search.
import { getDb } from "./index.js";
import { LEVEL_IDS } from "../config.js";

// --- Articles ---

/** Inserts the article and one 'pending' row per level in a single transaction. Returns the new id. */
export async function createArticle({ title, uploadedBy, sourceType, originalFilename, extractedText, wordCount, options }) {
  return inTransaction(async (db) => {
    const { lastID } = await db.run(
      `INSERT INTO articles (title, uploaded_by, source_type, original_filename, extracted_text, word_count, options_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      title, uploadedBy, sourceType, originalFilename, extractedText, wordCount, JSON.stringify(options),
    );
    for (const level of LEVEL_IDS) {
      await db.run("INSERT INTO level_outputs (article_id, level) VALUES (?, ?)", lastID, level);
    }
    return lastID;
  });
}

export async function setOriginalPath(articleId, originalPath) {
  await getDb().run("UPDATE articles SET original_path = ? WHERE id = ?", originalPath, articleId);
}

/** All articles, newest first, optionally filtered by title or uploader, each with its levels. */
export async function listArticles(query) {
  const db = getDb();
  const [where, params] = query
    ? ["WHERE title LIKE ? OR uploaded_by LIKE ?", [`%${query}%`, `%${query}%`]]
    : ["", []];
  const articleRows = await db.all(`SELECT * FROM articles ${where} ORDER BY created_at DESC, id DESC`, params);
  const levelRows = await db.all("SELECT article_id, level, status, error, updated_at FROM level_outputs");
  const levelsByArticle = groupLevelsByArticle(levelRows);
  return articleRows.map((row) => toArticle(row, levelsByArticle.get(row.id) ?? []));
}

/** One article with its levels, in the shape the API returns; null if it doesn't exist. */
export async function getArticle(id) {
  const db = getDb();
  const row = await db.get("SELECT * FROM articles WHERE id = ?", id);
  if (!row) return null;
  const levelRows = await db.all("SELECT level, status, error, updated_at FROM level_outputs WHERE article_id = ?", id);
  return toArticle(row, sortLevels(levelRows.map(toLevel)));
}

/** Internal fields (file paths, source text) that the API doesn't expose. */
export async function getArticleInternal(id) {
  return getDb().get(
    "SELECT id, title, original_path, original_filename, extracted_text, word_count, options_json FROM articles WHERE id = ?",
    id,
  );
}

/** Deletes the article (its levels cascade). Returns whether it existed. */
export async function deleteArticle(id) {
  const { changes } = await getDb().run("DELETE FROM articles WHERE id = ?", id);
  return changes > 0;
}

// --- Levels ---

export async function getLevelOutput(articleId, level) {
  return getDb().get("SELECT * FROM level_outputs WHERE article_id = ? AND level = ?", articleId, level);
}

/** With `expectStatus`, only writes if the row is still in that status. Returns whether a row changed. */
export async function updateLevelOutput(articleId, level, { status, contentJson = null, docxPath = null, error = null, expectStatus = null }) {
  const { changes } = await getDb().run(
    `UPDATE level_outputs SET status = ?, content_json = ?, docx_path = ?, error = ?, updated_at = datetime('now')
     WHERE article_id = ? AND level = ? AND (? IS NULL OR status = ?)`,
    status, contentJson, docxPath, error, articleId, level, expectStatus, expectStatus,
  );
  return changes > 0;
}

/**
 * Atomically moves levels in one of `fromStatuses` to 'pending' and returns the levels it moved.
 * This single conditional UPDATE is the only thing that decides who gets to start a model call,
 * so two clicks (or two server processes) can never both claim the same level.
 */
export async function claimLevels(articleId, levels, fromStatuses) {
  const rows = await getDb().all(
    `UPDATE level_outputs SET status = 'pending', error = NULL, updated_at = datetime('now')
     WHERE article_id = ? AND level IN (${placeholders(levels)})
       AND status IN (${placeholders(fromStatuses)})
     RETURNING level`,
    articleId, ...levels, ...fromStatuses,
  );
  return rows.map((row) => row.level);
}

/** Jobs live in memory, so anything mid-flight when the server stopped will never finish. Returns how many were marked. */
export async function failInterruptedLevels() {
  const { changes } = await getDb().run(
    `UPDATE level_outputs SET status = 'failed', error = 'Interrupted by server restart. Click Try Again.',
     updated_at = datetime('now') WHERE status IN ('pending', 'processing')`,
  );
  return changes;
}

// --- Usage ---

export async function addUsage({ day, articleId, level, model, inputTokens, outputTokens, costUsd, durationMs = null }) {
  await getDb().run(
    `INSERT INTO usage (day, article_id, level, model, input_tokens, output_tokens, cost_usd, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    day, articleId, level, model, inputTokens, outputTokens, costUsd, durationMs,
  );
}

export async function getSpendForDay(day) {
  const row = await getDb().get("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM usage WHERE day = ?", day);
  return row.total;
}

// --- Helpers ---

/** Runs `work(db)` inside BEGIN/COMMIT, rolling back if it throws. Returns what `work` returns. */
async function inTransaction(work) {
  const db = getDb();
  await db.exec("BEGIN");
  try {
    const result = await work(db);
    await db.exec("COMMIT");
    return result;
  } catch (err) {
    await db.exec("ROLLBACK");
    throw err;
  }
}

/** "?, ?, ?" with one placeholder per value. */
function placeholders(values) {
  return values.map(() => "?").join(", ");
}

/** Map of article id → its levels in display order (K, Grade 5, Grade 10). */
function groupLevelsByArticle(levelRows) {
  const levelsByArticle = new Map();
  for (const row of levelRows) {
    const levels = levelsByArticle.get(row.article_id) ?? [];
    levelsByArticle.set(row.article_id, [...levels, toLevel(row)]);
  }
  for (const levels of levelsByArticle.values()) sortLevels(levels);
  return levelsByArticle;
}

function sortLevels(levels) {
  return levels.sort((a, b) => LEVEL_IDS.indexOf(a.level) - LEVEL_IDS.indexOf(b.level));
}

function toArticle(row, levels) {
  return {
    id: row.id,
    title: row.title,
    uploadedBy: row.uploaded_by,
    sourceType: row.source_type,
    originalFilename: row.original_filename,
    hasOriginalFile: Boolean(row.original_path),
    wordCount: row.word_count,
    options: JSON.parse(row.options_json),
    createdAt: row.created_at,
    status: overallStatus(levels),
    levels,
  };
}

function toLevel(row) {
  return { level: row.level, status: row.status, error: row.error, updatedAt: row.updated_at };
}

/** An article is processing while any level is, failed if any level failed, otherwise ready. */
function overallStatus(levels) {
  const statuses = levels.map((level) => level.status);
  if (statuses.some((status) => status === "pending" || status === "processing")) return "processing";
  if (statuses.includes("failed")) return "failed";
  return "ready";
}
