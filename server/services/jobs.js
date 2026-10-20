// In-process background runner: one Claude call per level, run in parallel.
// Callers must claim the level first (status 'pending' via repo.createArticle or repo.claimLevels);
// the claim in the DB, not anything in memory, is what prevents duplicate runs.
// Jobs are lost if the server stops; failInterruptedLevels() marks them failed on the next start.
// POSTGRES/hosting: with more than one server process, move this to a real queue
// (e.g. pg-boss on Postgres, or BullMQ on Redis) so jobs survive restarts.
import * as repo from "../db/repo.js";
import * as budget from "./budget.js";
import { generateLevel, LevelerError } from "./leveler.js";
import { buildDocx } from "./docx.js";
import { saveOutput } from "./storage.js";

const MAX_ATTEMPTS = 2; // the first call plus one retry

const inFlight = new Set(); // promises, only so tests (and a future graceful shutdown) can wait

/** Resolves once every job that is currently running has finished. */
export const whenIdle = () => Promise.all(inFlight);

/** Starts generating one claimed level in the background. `reservedUsd` was reserved by the caller for the first attempt. */
export function startLevel(articleId, levelId, reservedUsd) {
    const job = runLevel(articleId, levelId, reservedUsd)
        .catch((err) =>
            console.error(`[jobs] ${articleId}:${levelId} crashed:`, err),
        )
        .finally(() => inFlight.delete(job));
    inFlight.add(job);
}

/** Generates a level and stores the result, or the reason it failed. */
async function runLevel(articleId, levelId, reservedUsd) {
    const article = await repo.getArticleInternal(articleId);
    const isOurs = article && (await markProcessing(articleId, levelId));
    if (!isOurs) return budget.release(reservedUsd); // deleted, or not claimed for us

    const { result, error } = await generateWithOneRetry(
        article,
        levelId,
        reservedUsd,
    );
    if (error) return saveLevelFailure(articleId, levelId, error);
    try {
        await saveLevelResult(article, levelId, result);
    } catch (saveError) {
        await saveLevelFailure(articleId, levelId, saveError);
    }
}

// --- Steps ---

/** Moves the level from 'pending' to 'processing'. Returns false if it wasn't pending (deleted or not ours). */
function markProcessing(articleId, levelId) {
    return repo.updateLevelOutput(articleId, levelId, {
        status: "processing",
        expectStatus: "pending",
    });
}

/**
 * Calls the model, retrying once if the failure is one a second call could fix.
 * Records usage for every billed call. Returns { result } or { error }.
 */
async function generateWithOneRetry(article, levelId, firstReservation) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const reservation =
            attempt === 1 ? firstReservation : await reserveForRetry(article);
        if (reservation === null) {
            return {
                error: new LevelerError(
                    `${lastError.message} (Retry skipped: daily limit reached.)`,
                ),
            };
        }
        try {
            const result = await generateLevel(
                buildGenerateRequest(article, levelId, attempt),
            );
            await recordCallUsage(article.id, levelId, result);
            return { result };
        } catch (err) {
            if (err.usage) await recordCallUsage(article.id, levelId, err);
            console.warn(
                `[jobs] ${article.id}:${levelId} attempt ${attempt} failed: ${err.message}`,
            );
            lastError = err;
            if (!isWorthRetrying(err)) return { error: err };
        } finally {
            budget.release(reservation);
        }
    }
    return { error: lastError };
}

/** Builds the .docx, saves it, and marks the level ready. Skipped if the article was deleted meanwhile. */
async function saveLevelResult(article, levelId, result) {
    if (!(await repo.getArticleInternal(article.id))) return;
    const options = JSON.parse(article.options_json);
    const buffer = await buildDocx({
        content: result.content,
        levelId,
        originalTitle: article.title,
        translationLanguage: options.translationLanguage,
    });
    const docxPath = await saveOutput(article.id, levelId, buffer);
    await repo.updateLevelOutput(article.id, levelId, {
        status: "ready",
        contentJson: JSON.stringify(result.content),
        docxPath,
        expectStatus: "processing",
    });
}

/** Marks the level failed with a message teachers can read. */
function saveLevelFailure(articleId, levelId, error) {
    const message =
        error instanceof LevelerError
            ? error.message
            : `Something went wrong: ${error.message}`;
    return repo.updateLevelOutput(articleId, levelId, {
        status: "failed",
        error: message,
        expectStatus: "processing",
    });
}

// --- Helpers ---

/** Reserves budget for the retry; returns null (instead of throwing) when the daily limit is reached. */
async function reserveForRetry(article) {
    try {
        return await budget.reserve(article.extracted_text, 1);
    } catch (err) {
        if (err instanceof budget.BudgetError) return null;
        throw err;
    }
}

function buildGenerateRequest(article, levelId, attempt) {
    const options = JSON.parse(article.options_json);
    return {
        text: article.extracted_text,
        levelId,
        counts: options.counts[levelId],
        translationLanguage: options.translationLanguage,
        articleId: article.id,
        attempt,
        wordCount: article.word_count,
    };
}

/** Only timeouts, overload and unreadable output are worth a second identical call; bugs in our code aren't. */
function isWorthRetrying(err) {
    return err instanceof LevelerError && err.retryable;
}

function recordCallUsage(articleId, levelId, { model, usage, durationMs }) {
    return budget.recordUsage({
        articleId,
        level: levelId,
        model,
        usage,
        durationMs,
    });
}
