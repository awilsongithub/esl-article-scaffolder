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

export class ValidationError extends Error {}

// Returns a trimmed string or null for empty optional fields.
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

// Form fields: terms_<level>, questions_<level>, translate ('on'), language.
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
