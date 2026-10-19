// All SQL lives in this file. Every function is async so callers don't change when the driver does.
// POSTGRES: swap getDb() for a pg Pool; `?` placeholders → `$1, $2…`; `lastID` → `RETURNING id`;
// datetime('now') → now(); LIKE → ILIKE for case-insensitive search.
import { getDb } from './index.js';
import { LEVEL_IDS } from '../config.js';

function deriveStatus(levels) {
  const statuses = levels.map((l) => l.status);
  if (statuses.some((s) => s === 'pending' || s === 'processing')) return 'processing';
  if (statuses.some((s) => s === 'failed')) return 'failed';
  return 'ready';
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
    status: deriveStatus(levels),
    levels,
  };
}

function toLevel(row) {
  return { level: row.level, status: row.status, error: row.error, updatedAt: row.updated_at };
}

export async function createArticle({ title, uploadedBy, sourceType, originalFilename, extractedText, wordCount, options }) {
  const db = getDb();
  await db.exec('BEGIN');
  try {
    const { lastID } = await db.run(
      `INSERT INTO articles (title, uploaded_by, source_type, original_filename, extracted_text, word_count, options_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      title, uploadedBy, sourceType, originalFilename, extractedText, wordCount, JSON.stringify(options),
    );
    for (const level of LEVEL_IDS) {
      await db.run('INSERT INTO level_outputs (article_id, level) VALUES (?, ?)', lastID, level);
    }
    await db.exec('COMMIT');
    return lastID;
  } catch (err) {
    await db.exec('ROLLBACK');
    throw err;
  }
}

export async function setOriginalPath(articleId, originalPath) {
  await getDb().run('UPDATE articles SET original_path = ? WHERE id = ?', originalPath, articleId);
}

export async function listArticles(query) {
  const db = getDb();
  const params = [];
  let where = '';
  if (query) {
    where = 'WHERE title LIKE ? OR uploaded_by LIKE ?';
    params.push(`%${query}%`, `%${query}%`);
  }
  const rows = await db.all(`SELECT * FROM articles ${where} ORDER BY created_at DESC, id DESC`, params);
  const levelRows = await db.all('SELECT article_id, level, status, error, updated_at FROM level_outputs');
  const byArticle = new Map();
  for (const l of levelRows) {
    if (!byArticle.has(l.article_id)) byArticle.set(l.article_id, []);
    byArticle.get(l.article_id).push(toLevel(l));
  }
  return rows.map((r) => toArticle(r, sortLevels(byArticle.get(r.id) || [])));
}

function sortLevels(levels) {
  return levels.sort((a, b) => LEVEL_IDS.indexOf(a.level) - LEVEL_IDS.indexOf(b.level));
}

export async function getArticle(id) {
  const db = getDb();
  const row = await db.get('SELECT * FROM articles WHERE id = ?', id);
  if (!row) return null;
  const levels = await db.all('SELECT level, status, error, updated_at FROM level_outputs WHERE article_id = ?', id);
  return toArticle(row, sortLevels(levels.map(toLevel)));
}

// Internal fields (file paths, source text) that the API doesn't expose.
export async function getArticleInternal(id) {
  return getDb().get('SELECT id, title, original_path, original_filename, extracted_text, word_count, options_json FROM articles WHERE id = ?', id);
}

export async function getLevelOutput(articleId, level) {
  return getDb().get('SELECT * FROM level_outputs WHERE article_id = ? AND level = ?', articleId, level);
}

// With `expectStatus`, only writes if the row is still in that status; returns whether a row changed.
export async function updateLevelOutput(articleId, level, { status, contentJson = null, docxPath = null, error = null, expectStatus = null }) {
  const { changes } = await getDb().run(
    `UPDATE level_outputs SET status = ?, content_json = ?, docx_path = ?, error = ?, updated_at = datetime('now')
     WHERE article_id = ? AND level = ? AND (? IS NULL OR status = ?)`,
    status, contentJson, docxPath, error, articleId, level, expectStatus, expectStatus,
  );
  return changes > 0;
}

// Atomically moves levels in one of `fromStatuses` to 'pending' and returns the levels it moved.
// This single conditional UPDATE is the only thing that decides who gets to start a model call,
// so two clicks (or two server processes) can never both claim the same level.
export async function claimLevels(articleId, levels, fromStatuses) {
  const rows = await getDb().all(
    `UPDATE level_outputs SET status = 'pending', error = NULL, updated_at = datetime('now')
     WHERE article_id = ? AND level IN (${levels.map(() => '?').join(', ')})
       AND status IN (${fromStatuses.map(() => '?').join(', ')})
     RETURNING level`,
    articleId, ...levels, ...fromStatuses,
  );
  return rows.map((r) => r.level);
}

export async function deleteArticle(id) {
  const { changes } = await getDb().run('DELETE FROM articles WHERE id = ?', id);
  return changes > 0;
}

// Jobs live in memory, so anything mid-flight when the server stopped will never finish.
export async function failInterruptedLevels() {
  const { changes } = await getDb().run(
    `UPDATE level_outputs SET status = 'failed', error = 'Interrupted by server restart. Click Regenerate.',
     updated_at = datetime('now') WHERE status IN ('pending', 'processing')`,
  );
  return changes;
}

export async function addUsage({ day, articleId, level, model, inputTokens, outputTokens, costUsd, durationMs = null }) {
  await getDb().run(
    `INSERT INTO usage (day, article_id, level, model, input_tokens, output_tokens, cost_usd, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    day, articleId, level, model, inputTokens, outputTokens, costUsd, durationMs,
  );
}

export async function getSpendForDay(day) {
  const row = await getDb().get('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM usage WHERE day = ?', day);
  return row.total;
}
