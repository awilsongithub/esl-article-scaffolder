import {
    RegExpMatcher,
    englishDataset,
    englishRecommendedTransformers,
} from "obscenity";
import { LEVELS, LIMITS, TRANSLATION_LANGUAGES } from "../config.js";

const matcher = new RegExpMatcher({
    ...englishDataset.build(),
    ...englishRecommendedTransformers,
});

/**
 * Bad form input.
 * app.js maps it to a 400.
 */
export class ValidationError extends Error {}

/**
 * Trims and collapses whitespace, then checks length and profanity.
 * Returns the cleaned string, or null for an empty optional field.
 */
export function cleanText(
    value,
    { field, maxChars, required = false, checkProfanity = true },
) {
    const text =
        typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
    if (!text) {
        if (required) throw new ValidationError(`${field} is required.`);
        return null;
    }
    if (text.length > maxChars)
        throw new ValidationError(
            `${field} must be ${maxChars} characters or fewer.`,
        );
    if (checkProfanity && matcher.hasMatch(text)) {
        throw new ValidationError(
            `${field} contains language that isn't allowed. Please change it and try again.`,
        );
    }
    return text;
}

/**
 * A glossary-term or question count from the form.
 * Uses `fallback` when blank.
 * Throws unless it is a whole number from 0 to maxCount.
 */
function parseCount(value, fallback, label) {
    if (value === undefined || value === "") return fallback;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > LIMITS.maxCount) {
        throw new ValidationError(
            `${label} must be a whole number from 0 to ${LIMITS.maxCount}.`,
        );
    }
    return n;
}

/**
 * Reads the per-level counts and the translation choice from the form.
 * Form fields: terms_<level>, questions_<level>, translate ('on'), language.
 */
export function parseOptions(body) {
    const counts = {};
    for (const level of LEVELS) {
        counts[level.id] = {
            terms: parseCount(
                body[`terms_${level.id}`],
                level.defaults.terms,
                `${level.label} glossary terms`,
            ),
            questions: parseCount(
                body[`questions_${level.id}`],
                level.defaults.questions,
                `${level.label} questions`,
            ),
        };
    }
    let translationLanguage = null;
    if (body.translate === "on" || body.translate === "true") {
        if (!TRANSLATION_LANGUAGES.includes(body.language))
            throw new ValidationError("Please choose a translation language.");
        translationLanguage = body.language;
    }
    return { counts, translationLanguage };
}
