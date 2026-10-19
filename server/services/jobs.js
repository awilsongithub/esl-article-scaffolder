// In-process background runner: one Claude call per level, run in parallel.
// Callers must claim the level first (status 'pending' via repo.createArticle or repo.claimLevels);
// the claim in the DB, not anything in memory, is what prevents duplicate runs.
// Jobs are lost if the server stops; failInterruptedLevels() marks them failed on the next start.
// POSTGRES/hosting: with more than one server process, move this to a real queue
// (e.g. pg-boss on Postgres, or BullMQ on Redis) so jobs survive restarts.
import * as repo from '../db/repo.js';
import * as budget from './budget.js';
import { generateLevel, LevelerError } from './leveler.js';
import { buildDocx } from './docx.js';
import { saveOutput } from './storage.js';

const inFlight = new Set(); // promises, only so tests (and a future graceful shutdown) can wait

export const whenIdle = () => Promise.all(inFlight);

// `reservedUsd` was already reserved by the caller for the first attempt.
export function startLevel(articleId, levelId, reservedUsd) {
  const job = runLevel(articleId, levelId, reservedUsd)
    .catch((err) => console.error(`[jobs] ${articleId}:${levelId} crashed:`, err))
    .finally(() => inFlight.delete(job));
  inFlight.add(job);
}

async function runLevel(articleId, levelId, reservedUsd) {
  const article = await repo.getArticleInternal(articleId);
  if (!article) return budget.release(reservedUsd);
  const options = JSON.parse(article.options_json);
  if (!(await repo.updateLevelOutput(articleId, levelId, { status: 'processing', expectStatus: 'pending' }))) {
    return budget.release(reservedUsd); // deleted, or not claimed for us
  }

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let reservation = reservedUsd;
    if (attempt === 2) {
      try {
        reservation = await budget.reserve(article.extracted_text, 1);
      } catch (err) {
        if (!(err instanceof budget.BudgetError)) throw err;
        lastError = new LevelerError(`${lastError.message} (Retry skipped: daily limit reached.)`);
        break;
      }
    }
    try {
      const result = await generateLevel({
        text: article.extracted_text,
        levelId,
        counts: options.counts[levelId],
        translationLanguage: options.translationLanguage,
        articleId,
        attempt,
        wordCount: article.word_count,
      });
      await budget.recordUsage({ articleId, level: levelId, model: result.model, usage: result.usage, durationMs: result.durationMs });

      // The article may have been deleted while Claude was working.
      if (!(await repo.getArticleInternal(articleId))) return;
      const buffer = await buildDocx({
        content: result.content,
        levelId,
        originalTitle: article.title,
        translationLanguage: options.translationLanguage,
      });
      const docxPath = await saveOutput(articleId, levelId, buffer);
      await repo.updateLevelOutput(articleId, levelId, {
        status: 'ready',
        contentJson: JSON.stringify(result.content),
        docxPath,
        expectStatus: 'processing',
      });
      return;
    } catch (err) {
      if (err.usage) {
        await budget.recordUsage({ articleId, level: levelId, model: err.model, usage: err.usage, durationMs: err.durationMs });
      }
      lastError = err;
      console.warn(`[jobs] ${articleId}:${levelId} attempt ${attempt} failed: ${err.message}`);
      // Only timeouts, overload and unreadable output are worth a second identical call.
      if (!(err instanceof LevelerError && err.retryable)) break;
    } finally {
      budget.release(reservation);
    }
  }
  await repo.updateLevelOutput(articleId, levelId, {
    status: 'failed',
    error: lastError instanceof LevelerError ? lastError.message : `Something went wrong: ${lastError.message}`,
    expectStatus: 'processing',
  });
}
