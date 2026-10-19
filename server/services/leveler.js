// Turns source text into structured leveled content (JSON) for one reading level, using Claude.
// The JSON is stored in the DB and rendered to .docx separately, so a future React UI can
// render the same JSON for previews and the output format can change without new AI calls.
// The prompt itself is built in prompt.js.
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { buildPrompt, questionSplit } from './prompt.js';

// Created on first use so the server can start (and show errors in the UI) without a key.
// maxRetries 0: jobs.js owns the single retry, so every attempt is logged and budgeted.
let client;
const getClient = () => (client ??= new Anthropic({ maxRetries: 0, timeout: config.modelTimeoutMs }));

// Tests swap in a fake with the same beta.messages.stream().finalMessage() shape.
export function setClientForTests(fake) {
  client = fake;
}

// Models that accept server-side refusal fallbacks (the Haiku models do not).
const FALLBACK_CAPABLE = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1']);

// `retryable` is true only for failures a second identical call could fix
// (timeouts, network errors, overload, unreadable or empty output).
export class LevelerError extends Error {
  constructor(message, { retryable = false } = {}) {
    super(message);
    this.retryable = retryable;
  }
}

// Clean up the model output so the docx/preview code can trust its shape.
function normalizeContent(raw, counts, levelId, translate) {
  const split = questionSplit(levelId, counts.questions);
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const content = {
    title: str(raw.title),
    paragraphs: (raw.paragraphs || []).map(str).filter(Boolean),
    glossary: (raw.glossary || [])
      .map((g) => ({
        term: str(g.term),
        definition: str(g.definition),
        example: str(g.example),
        ...(translate ? { translatedTerm: str(g.translated_term), translatedDefinition: str(g.translated_definition) } : {}),
      }))
      .filter((g) => g.term && g.definition)
      .slice(0, counts.terms),
    multipleChoice: (raw.multiple_choice || [])
      .map((q) => ({ question: str(q.question), options: (q.options || []).map(str), correctOption: q.correct_option }))
      .filter((q) => q.question && q.options.length === 4 && q.options.every(Boolean))
      .slice(0, split.multipleChoice),
    shortAnswer: (raw.short_answer || [])
      .map((q) => ({ question: str(q.question), modelAnswer: str(q.model_answer) }))
      .filter((q) => q.question)
      .slice(0, split.shortAnswer),
  };
  if (content.paragraphs.length === 0) {
    throw new LevelerError('The AI returned an empty article. Please try again.', { retryable: true });
  }
  return content;
}

// One log line per model call, so slow calls on long articles show up before they hit the timeout.
function logCall({ articleId, levelId, attempt, text, wordCount, ms, response, error }) {
  const parts = [
    `article=${articleId}`,
    `level=${levelId}`,
    `attempt=${attempt}`,
    `chars=${text.length}`,
    `words=${wordCount ?? '?'}`,
    `ms=${ms}`,
  ];
  if (response) parts.push(`stop=${response.stop_reason}`, `in=${response.usage?.input_tokens}`, `out=${response.usage?.output_tokens}`);
  parts.push(`ok=${!error}`);
  if (error) parts.push(`retryable=${error.retryable}`, `error=${JSON.stringify(error.message)}`);
  console.log(`[model] ${parts.join(' ')}`);
}

// Returns { content, model, usage, durationMs }. Throws LevelerError with a user-friendly message on failure;
// `usage` and `durationMs` are attached to the error when the call was billed.
export async function generateLevel({ text, levelId, counts, translationLanguage, articleId, attempt = 1, wordCount }) {
  const { system, messages, outputFormat } = buildPrompt({ text, levelId, counts, translationLanguage });
  const useFallback = FALLBACK_CAPABLE.has(config.model);
  const started = Date.now();
  const log = (fields) => logCall({ articleId, levelId, attempt, text, wordCount, ms: Date.now() - started, ...fields });

  let response;
  try {
    response = await getClient().beta.messages
      .stream({
        model: config.model,
        max_tokens: config.maxTokensPerLevel,
        ...(useFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
        output_config: { effort: 'medium', format: outputFormat },
        system,
        messages,
      })
      .finalMessage();
  } catch (err) {
    const error = new LevelerError(friendlyApiError(err), { retryable: isRetryableApiError(err) });
    log({ error });
    throw error;
  }

  const durationMs = Date.now() - started;
  const billed = { model: response.model, usage: response.usage, durationMs };
  const fail = (message, retryable) => {
    const error = Object.assign(new LevelerError(message, { retryable }), billed);
    log({ response, error });
    return error;
  };

  if (response.stop_reason === 'refusal') {
    throw fail('The AI declined to adapt this article. Try a different article or edit the text.', false);
  }
  if (response.stop_reason === 'max_tokens') {
    // The same input would be cut off again, so this is not retried.
    throw fail('The AI response was cut off before it finished. Try a shorter article.', false);
  }
  const textBlock = response.content.find((b) => b.type === 'text');
  let raw;
  try {
    raw = JSON.parse(textBlock?.text ?? '');
  } catch {
    throw fail('The AI returned an unreadable response. Please try again.', true);
  }
  let content;
  try {
    content = normalizeContent(raw, counts, levelId, Boolean(translationLanguage));
  } catch (err) {
    throw fail(err.message, err.retryable ?? false);
  }
  log({ response });
  return { content, ...billed };
}

function isRetryableApiError(err) {
  if (err instanceof Anthropic.APIConnectionError) return true; // includes timeouts
  if (err instanceof Anthropic.RateLimitError) return true;
  if (err instanceof Anthropic.APIError) return err.status === undefined || err.status >= 500; // incl. 529 overloaded
  return false;
}

function friendlyApiError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'Claude API key is missing or invalid. Check ANTHROPIC_API_KEY in .env.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'This API key is not allowed to use the configured model.';
  if (err instanceof Anthropic.NotFoundError) return `Model "${config.model}" was not found. Check CLAUDE_MODEL in .env.`;
  if (err instanceof Anthropic.RateLimitError) return 'The AI service is busy (rate limited). Please try again in a minute.';
  if (err instanceof Anthropic.BadRequestError) return `The AI request was rejected: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'The AI took too long to respond. Please try again.';
  if (err instanceof Anthropic.APIError) return `The AI service returned an error (${err.status ?? 'network'}). Please try again.`;
  return `Unexpected error talking to the AI service: ${err.message}`;
}
