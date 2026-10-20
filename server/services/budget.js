// Daily spending cap. Spend is recorded from each response's real token usage; before a job
// starts we also hold back its worst-case cost so parallel jobs can't overshoot together.
// LOGIN: add a user_id to usage rows to support per-user limits.
import { config, MODEL_PRICES } from '../config.js';
import * as repo from '../db/repo.js';

export class BudgetError extends Error {}

let reservedUsd = 0; // worst-case cost of calls currently in flight

const FALLBACK_PRICE = Object.values(MODEL_PRICES).reduce(
  (max, p) => ({ input: Math.max(max.input, p.input), output: Math.max(max.output, p.output) }),
  { input: 0, output: 0 },
);

function priceFor(model) {
  // Unknown model ids are charged at the most expensive known rate, to stay on the safe side.
  return MODEL_PRICES[model] ?? FALLBACK_PRICE;
}

export function today() {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.budgetTimeZone }).format(new Date());
}

export function costUsd(model, inputTokens, outputTokens) {
  const p = priceFor(model);
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

// Rough token estimate (~4 chars/token) plus room for the instructions, priced at max output.
export function estimateCallUsd(articleText) {
  const inputTokens = Math.ceil(articleText.length / 4) + 2000;
  return costUsd(config.model, inputTokens, config.maxTokensPerLevel);
}

// Reserves the worst case for `calls` calls, or throws BudgetError. Returns a per-call reservation.
export async function reserve(articleText, calls) {
  if (!config.hasApiCredentials) {
    throw Object.assign(new Error('Claude API key is not set up. Add ANTHROPIC_API_KEY to .env and restart the server.'), { status: 503 });
  }
  const perCall = estimateCallUsd(articleText);
  // Hold the amount before awaiting, so parallel requests see each other's reservations.
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
    throw new BudgetError('Daily limit reached, try again tomorrow.');
  }
  return perCall;
}

export const reservedTotal = () => reservedUsd;

export function release(amount) {
  reservedUsd = Math.max(0, reservedUsd - amount);
}

export async function recordUsage({ articleId, level, model, usage, durationMs }) {
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

export async function todaySummary() {
  const spent = await repo.getSpendForDay(today());
  return { spentUsd: Number(spent.toFixed(4)), capUsd: config.dailyBudgetUsd };
}

/** Cache writes and reads are billed as input too, so they count toward the input total. */
function totalInputTokens(usage) {
  return (
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  );
}
