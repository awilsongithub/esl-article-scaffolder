import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// DATA_DIR lets tests use a throwaway folder for the database and files.
const dataDir = process.env.DATA_DIR || path.join(rootDir, 'data');

// Reading levels are data, not code: add a level here (and a row in the UI follows).
export const LEVELS = [
  {
    id: 'k',
    label: 'Kindergarten',
    defaults: { terms: 5, questions: 5 },
    shortAnswer: false,
    guidance: [
      'Write for a kindergarten-age reader who is learning English.',
      'Use very short sentences (about 4-8 words). One idea per sentence.',
      'Use only common, high-frequency words. Explain any needed hard word in simple words.',
      'Present tense where possible. No idioms, no figurative language.',
      'Keep it short: roughly 80-200 words, in short paragraphs of 1-3 sentences.',
    ],
  },
  {
    id: 'g5',
    label: 'Grade 5',
    defaults: { terms: 8, questions: 8 },
    shortAnswer: true,
    guidance: [
      'Write for a 5th-grade reader who is learning English.',
      'Use clear sentences of moderate length (about 10-15 words). Avoid long chains of clauses.',
      'Keep all key ideas and important facts. Remove minor details.',
      'Replace idioms and figurative language with plain meaning.',
      'Aim for roughly 40-60% of the original length, and never more than 1,000 words. For a long article, keep the main ideas and cut the rest.',
    ],
  },
  {
    id: 'g10',
    label: 'Grade 10',
    defaults: { terms: 12, questions: 10 },
    shortAnswer: true,
    guidance: [
      'Write for a 10th-grade reader who is learning English.',
      'Keep close to the original complexity and content, and to its length up to a maximum of 1,500 words. For a longer article, condense it: keep the main ideas and key facts and cut minor details.',
      'Keep academic vocabulary, but clarify idioms, cultural references and slang in plain words.',
      'Break up very long or confusing sentences.',
    ],
  },
];

export const LEVEL_IDS = LEVELS.map((l) => l.id);
export const getLevel = (id) => LEVELS.find((l) => l.id === id);

export const TRANSLATION_LANGUAGES = [
  'Spanish', 'Arabic', 'Chinese (Simplified)', 'Vietnamese', 'Portuguese', 'French',
  'Ukrainian', 'Somali', 'Korean', 'Haitian Creole', 'Kinyarwanda', 'Swahili', 'Dari', 'Pashto',
];

export const LIMITS = {
  maxWords: 20000,
  maxFileBytes: 10 * 1024 * 1024,
  maxTitleChars: 150,
  maxUploaderChars: 60,
  maxPastedChars: 160000,
  maxCount: 20, // glossary terms / questions per level
  allowedExtensions: ['.pdf', '.docx', '.txt', '.md'],
};

// USD per 1M tokens (Anthropic first-party pricing, checked 2026-10).
// Fallback models are listed because a declined request may be re-run on one of them.
export const MODEL_PRICES = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
};

export const config = {
  port: Number(process.env.PORT) || 3000,
  model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
  hasApiCredentials: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE),
  // Caps output cost per level. 9k keeps a 20,000-word article to about $0.50 for all three levels on Sonnet 5.5.
  maxTokensPerLevel: 9000,
  // Per model call. The duration log line shows how close real calls get to this.
  modelTimeoutMs: Number(process.env.MODEL_TIMEOUT_MS) || 180_000,
  dailyBudgetUsd: process.env.DAILY_BUDGET_USD !== undefined ? Number(process.env.DAILY_BUDGET_USD) : 5,
  budgetTimeZone: 'America/New_York',
  rootDir,
  dataDir,
  uploadsDir: path.join(dataDir, 'uploads'),
  outputsDir: path.join(dataDir, 'outputs'),
  dbPath: path.join(dataDir, 'app.db'),
};
