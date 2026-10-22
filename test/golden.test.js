// Golden tests: pin the exact Word XML and prompt text,
// so refactors can't change output by accident.
// After an intended output change, regenerate with: UPDATE_GOLDEN=1 npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import JSZip from "jszip"; // installed with the docx package
import { buildDocx } from "../server/services/docx.js";
import { buildPrompt } from "../server/services/prompt.js";

const FIXTURES = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "fixtures",
);
const UPDATE = process.env.UPDATE_GOLDEN === "1";

/**
 * Asserts `actual` equals the saved fixture `name`.
 * Writes the fixture first when it's missing or UPDATE_GOLDEN=1.
 */
function matchesGolden(name, actual) {
    const file = path.join(FIXTURES, name);
    if (UPDATE || !fs.existsSync(file)) {
        fs.mkdirSync(FIXTURES, { recursive: true });
        fs.writeFileSync(file, actual);
    }
    assert.equal(actual, fs.readFileSync(file, "utf8"), `${name} changed`);
}

const glossary = [
    {
        term: "cloud",
        definition: "water in the sky",
        example: "I see a cloud.",
    },
    { term: "rain", definition: "water that falls", example: "Rain is wet." },
];
const translatedGlossary = glossary.map((g) => ({
    ...g,
    translatedTerm: `${g.term}-es`,
    translatedDefinition: `${g.definition}-es`,
}));
const multipleChoice = [
    {
        question: "What falls?",
        options: ["Rain", "Rocks", "Cats", "Cars"],
        correctOption: "A",
    },
    {
        question: "Where are clouds?",
        options: ["Sea", "Sky", "Shop", "Bed"],
        correctOption: "B",
    },
];
const shortAnswer = [
    { question: "Why does it rain?", modelAnswer: "Clouds get heavy." },
    { question: "What do you like?", modelAnswer: "" },
];
const base = { title: "Water", paragraphs: ["Water moves.", "Rain falls."] };

const docxCases = {
    "g5-full": {
        levelId: "g5",
        translationLanguage: null,
        content: { ...base, glossary, multipleChoice, shortAnswer },
    },
    "k-translated-mc-only": {
        levelId: "k",
        translationLanguage: "Spanish",
        content: {
            ...base,
            glossary: translatedGlossary,
            multipleChoice,
            shortAnswer: [],
        },
    },
    "g10-short-answer-only": {
        levelId: "g10",
        translationLanguage: null,
        content: {
            ...base,
            title: "",
            glossary: [],
            multipleChoice: [],
            shortAnswer,
        },
    },
    "g10-no-questions": {
        levelId: "g10",
        translationLanguage: null,
        content: { ...base, glossary, multipleChoice: [], shortAnswer: [] },
    },
};

for (const [name, { levelId, translationLanguage, content }] of Object.entries(
    docxCases,
)) {
    test(`docx golden: ${name}`, async () => {
        const buffer = await buildDocx({
            content,
            levelId,
            originalTitle: "Original title",
            translationLanguage,
        });
        const zip = await JSZip.loadAsync(buffer);
        matchesGolden(
            `docx-${name}.xml`,
            await zip.file("word/document.xml").async("string"),
        );
    });
}

const promptCases = {
    "k-default": {
        levelId: "k",
        counts: { terms: 5, questions: 5 },
        translationLanguage: null,
    },
    "g5-translated": {
        levelId: "g5",
        counts: { terms: 8, questions: 8 },
        translationLanguage: "Spanish",
    },
    "g10-default": {
        levelId: "g10",
        counts: { terms: 12, questions: 10 },
        translationLanguage: null,
    },
    "g10-nothing-extra": {
        levelId: "g10",
        counts: { terms: 0, questions: 0 },
        translationLanguage: null,
    },
    "g5-one-question": {
        levelId: "g5",
        counts: { terms: 1, questions: 1 },
        translationLanguage: null,
    },
};

for (const [name, options] of Object.entries(promptCases)) {
    test(`prompt golden: ${name}`, () => {
        const prompt = buildPrompt({
            text: "Water moves.\n\nRain falls.",
            ...options,
        });
        matchesGolden(`prompt-${name}.json`, JSON.stringify(prompt, null, 2));
    });
}
