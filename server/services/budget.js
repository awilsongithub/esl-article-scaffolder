// Daily spending cap.
// Spend is recorded from each response's real token usage.
// Before a job starts we also hold back its worst-case cost,
// so parallel jobs can't overshoot together.
// LOGIN: add a user_id to usage rows to support per-user limits.
import { config, MODEL_PRICES } from "../config.js";
import * as repo from "../db/repo.js";

/**
 * The daily limit was reached.
 * app.js maps it to a 429.
 */
export class BudgetError extends Error {}

let reservedUsd = 0; // worst-case cost of calls currently in flight

/** price falls back to the most expensive known rate */
const FALLBACK_PRICE = Object.values(MODEL_PRICES).reduce(
    (max, p) => ({
        input: Math.max(max.input, p.input),
        output: Math.max(max.output, p.output),
    }),
    { input: 0, output: 0 },
);

/**
 * USD per 1M tokens for `model`.
 * Unknown model ids are charged at the most expensive known rate,
 * to stay on the safe side.
 */
function priceFor(model) {
    return MODEL_PRICES[model] ?? FALLBACK_PRICE;
}

/** Today's date in the budget time zone, as YYYY-MM-DD. */
export function today() {
    // en-CA formats as YYYY-MM-DD
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: config.budgetTimeZone,
    }).format(new Date());
}

/** USD cost of a call on `model` with these token counts. */
export function costUsd(model, inputTokens, outputTokens) {
    const p = priceFor(model);
    // example: 100K input tokens at $10/M + 100K output tokens at $10/M = $2.00
    return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

/**
 * Worst-case USD cost of one call for this article.
 * Rough token estimate (~4 chars/token) plus room for the instructions,
 * priced at the maximum output.
 */
export function estimateCallUsd(articleText) {
    const inputTokens = Math.ceil(articleText.length / 4) + 2000;
    return costUsd(config.model, inputTokens, config.maxTokensPerLevel);
}

/**
 * Reserves the worst-case cost of `calls` calls against today's budget.
 * Returns the per-call reservation, to release as each call finishes.
 * Throws BudgetError when the daily limit would be passed,
 * or a 503 error when no API key is set.
 */
export async function reserve(articleText, calls) {
    const errMssg = "Claude API key is not set up. Add ANTHROPIC_API_KEY to .env and restart the server.";
    if (!config.hasApiCredentials) {
        throw Object.assign(new Error(errMssg), { status: 503 });
    }
    const perCall = estimateCallUsd(articleText);
    // Hold the amount before awaiting,
    // so parallel requests see each other's reservations.
    reservedUsd += perCall * calls;
    let spent;
    try {
        spent = await repo.getSpendForDay(today());
    } catch (err) {
        release(perCall * calls);
        throw err;
    }
    if (spent + reservedUsd > config.dailyBudgetUsd) {
        release(perCall * calls);
        throw new BudgetError("Daily limit reached, try again tomorrow.");
    }
    return perCall;
}

/** USD currently reserved for calls in flight. */
export const reservedTotal = () => reservedUsd;

/** Gives back a reservation once its call has finished or won't happen. */
export function release(amount) {
    reservedUsd = Math.max(0, reservedUsd - amount);
}

/** Records a billed call's real token usage and cost for today. */
export async function recordUsage({
    articleId,
    level,
    model,
    usage,
    durationMs,
}) {
    const inputTokens = totalInputTokens(usage);
    const outputTokens = usage.output_tokens ?? 0;
    await repo.addUsage({
        day: today(),
        articleId,
        level,
        model,
        inputTokens,
        outputTokens,
        costUsd: costUsd(model, inputTokens, outputTokens),
        durationMs,
    });
}

/** Today's spend and the daily cap, for the usage footer. */
export async function todaySummary() {
    const spent = await repo.getSpendForDay(today());
    return {
        spentUsd: Number(spent.toFixed(4)),
        capUsd: config.dailyBudgetUsd,
    };
}

/**
 * Total input tokens for a response.
 * Cache writes and reads are billed as input too, so they count toward it.
 */
function totalInputTokens(usage) {
    return (
        (usage.input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0)
    );
}
