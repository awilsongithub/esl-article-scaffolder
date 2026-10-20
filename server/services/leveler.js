// Turns source text into structured leveled content (JSON) for one reading level, using Claude.
// The JSON is stored in the DB and rendered to .docx separately, so a future React UI can
// render the same JSON for previews and the output format can change without new AI calls.
// The prompt itself is built in prompt.js.
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { buildPrompt, questionSplit } from "./prompt.js";

// Created on first use so the server can start (and show errors in the UI) without a key.
// maxRetries 0: jobs.js owns the single retry, so every attempt is logged and budgeted.
let client;
const getClient = () =>
  (client ??= new Anthropic({ maxRetries: 0, timeout: config.modelTimeoutMs }));

/** Tests swap in a fake with the same beta.messages.stream().finalMessage() shape. */
export function setClientForTests(fake) {
  client = fake;
}

// Models that accept server-side refusal fallbacks (the Haiku models do not).
const FALLBACK_CAPABLE = new Set(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1"]);

/**
 * A failure with a message that's safe to show teachers. `retryable` is true only for failures
 * a second identical call could fix (timeouts, network errors, overload, unreadable or empty output).
 */
export class LevelerError extends Error {
  constructor(message, { retryable = false } = {}) {
    super(message);
    this.retryable = retryable;
  }
}

/**
 * Generates one level's content. Returns { content, model, usage, durationMs }.
 * Throws LevelerError; when the call was billed, `model`, `usage` and `durationMs` are attached to it.
 */
export async function generateLevel(request) {
  const { text, levelId, counts, translationLanguage } = request;
  const startedAt = Date.now();
  const elapsedMs = () => Date.now() - startedAt;

  const response = await callModel(buildPrompt({ text, levelId, counts, translationLanguage })).catch(
    (apiError) => {
      const error = toLevelerError(apiError);
      logModelCall({ ...request, ms: elapsedMs(), error });
      throw error;
    },
  );

  const billing = { model: response.model, usage: response.usage, durationMs: elapsedMs() };
  try {
    assertCompleteResponse(response);
    const content = normalizeContent(parseJsonResponse(response), counts, levelId, Boolean(translationLanguage));
    logModelCall({ ...request, ms: billing.durationMs, response });
    return { content, ...billing };
  } catch (err) {
    const error = Object.assign(err instanceof LevelerError ? err : new LevelerError(err.message), billing);
    logModelCall({ ...request, ms: billing.durationMs, response, error });
    throw error;
  }
}

// --- The model call ---

/** Streams one structured-output request and returns the final message. Async so that setup errors reject too. */
async function callModel({ system, messages, outputFormat }) {
  const useFallback = FALLBACK_CAPABLE.has(config.model);
  return getClient()
    .beta.messages.stream({
      model: config.model,
      max_tokens: config.maxTokensPerLevel,
      ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
      output_config: { effort: "medium", format: outputFormat },
      system,
      messages,
    })
    .finalMessage();
}

/** Rejects refusals and cut-off answers. Neither is retried: the same input gives the same result. */
function assertCompleteResponse(response) {
  if (response.stop_reason === "refusal") {
    throw new LevelerError("The AI declined to adapt this article. Try a different article or edit the text.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new LevelerError("The AI response was cut off before it finished. Try a shorter article.");
  }
}

/** Parses the JSON text block; unreadable output is worth one retry. */
function parseJsonResponse(response) {
  const textBlock = response.content.find((block) => block.type === "text");
  try {
    return JSON.parse(textBlock?.text ?? "");
  } catch {
    throw new LevelerError("The AI returned an unreadable response. Please try again.", { retryable: true });
  }
}

// --- Cleaning the model's JSON so the docx/preview code can trust its shape ---

/** Trims every string, drops incomplete items, and caps each list at the requested count. */
function normalizeContent(raw, counts, levelId, includeTranslation) {
  const split = questionSplit(levelId, counts.questions);
  const content = {
    title: cleanString(raw.title),
    paragraphs: (raw.paragraphs || []).map(cleanString).filter(Boolean),
    glossary: normalizeGlossary(raw.glossary, includeTranslation).slice(0, counts.terms),
    multipleChoice: normalizeMultipleChoice(raw.multiple_choice).slice(0, split.multipleChoice),
    shortAnswer: normalizeShortAnswer(raw.short_answer).slice(0, split.shortAnswer),
  };
  if (content.paragraphs.length === 0) {
    throw new LevelerError("The AI returned an empty article. Please try again.", { retryable: true });
  }
  return content;
}

/** Glossary entries with a term and a definition, renamed to camelCase. */
function normalizeGlossary(entries = [], includeTranslation) {
  return entries
    .map((entry) => ({
      term: cleanString(entry.term),
      definition: cleanString(entry.definition),
      example: cleanString(entry.example),
      ...(includeTranslation
        ? {
            translatedTerm: cleanString(entry.translated_term),
            translatedDefinition: cleanString(entry.translated_definition),
          }
        : {}),
    }))
    .filter((entry) => entry.term && entry.definition);
}

/** Multiple-choice questions that have a question and exactly four non-empty options. */
function normalizeMultipleChoice(questions = []) {
  return questions
    .map((question) => ({
      question: cleanString(question.question),
      options: (question.options || []).map(cleanString),
      correctOption: question.correct_option,
    }))
    .filter((question) => question.question && question.options.length === 4 && question.options.every(Boolean));
}

/** Short-answer questions that have a question (the model answer may be empty). */
function normalizeShortAnswer(questions = []) {
  return questions
    .map((question) => ({ question: cleanString(question.question), modelAnswer: cleanString(question.model_answer) }))
    .filter((question) => question.question);
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

// --- Errors and logging ---

/** Wraps an SDK error in a LevelerError with a teacher-friendly message and the right retry flag. */
function toLevelerError(apiError) {
  return new LevelerError(friendlyApiError(apiError), { retryable: isRetryableApiError(apiError) });
}

function isRetryableApiError(err) {
  if (err instanceof Anthropic.APIConnectionError) return true; // includes timeouts
  if (err instanceof Anthropic.RateLimitError) return true;
  if (err instanceof Anthropic.APIError) return err.status === undefined || err.status >= 500; // incl. 529 overloaded
  return false;
}

function friendlyApiError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "Claude API key is missing or invalid. Check ANTHROPIC_API_KEY in .env.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key is not allowed to use the configured model.";
  if (err instanceof Anthropic.NotFoundError) return `Model "${config.model}" was not found. Check CLAUDE_MODEL in .env.`;
  if (err instanceof Anthropic.RateLimitError) return "The AI service is busy (rate limited). Please try again in a minute.";
  if (err instanceof Anthropic.BadRequestError) return `The AI request was rejected: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionTimeoutError) return "The AI took too long to respond. Please try again.";
  if (err instanceof Anthropic.APIError) return `The AI service returned an error (${err.status ?? "network"}). Please try again.`;
  return `Unexpected error talking to the AI service: ${err.message}`;
}

/** One log line per model call, so slow calls on long articles show up before they hit the timeout. */
function logModelCall({ articleId, levelId, attempt = 1, text, wordCount, ms, response, error }) {
  const fields = [
    `article=${articleId}`,
    `level=${levelId}`,
    `attempt=${attempt}`,
    `chars=${text.length}`,
    `words=${wordCount ?? "?"}`,
    `ms=${ms}`,
    ...(response
      ? [`stop=${response.stop_reason}`, `in=${response.usage?.input_tokens}`, `out=${response.usage?.output_tokens}`]
      : []),
    `ok=${!error}`,
    ...(error ? [`retryable=${error.retryable}`, `error=${JSON.stringify(error.message)}`] : []),
  ];
  console.log(`[model] ${fields.join(" ")}`);
}
