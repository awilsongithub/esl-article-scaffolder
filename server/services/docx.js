// Renders a level's content JSON into an editable Word worksheet:
// header, reading, glossary, questions, and an answer key on its own page.
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { getLevel } from "../config.js";

const OPTION_LETTERS = ["A", "B", "C", "D"];
const INDENT_TWIPS = 360; // 1/4 inch
const MUTED_GREY = "555555";
const ANSWER_LINE_GREY = "999999";
const ANSWER_LINE = "_".repeat(70);
const ANSWER_LINES_PER_QUESTION = 3;
// Font sizes are in half-points: 16pt for kindergarten, 12pt otherwise.
const LARGE_PRINT_SIZE = 32;
const NORMAL_PRINT_SIZE = 24;
const LARGE_PRINT_LEVELS = new Set(["k"]);

// --- Building blocks used throughout this file ---

/** A section heading (Heading 2) with standard spacing; `options` can override any paragraph setting. */
function heading(text, options = {}) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 360, after: 160 },
    ...options,
  });
}

/** A body paragraph made of text runs, with standard spacing; `options` can override it. */
function paragraph(textRuns, options = {}) {
  return new Paragraph({ children: textRuns, spacing: { after: 160 }, ...options });
}

/** A piece of text inside a paragraph; `options` sets bold, italics, colour, etc. */
function textRun(text, options = {}) {
  return new TextRun({ text, ...options });
}

// --- Main ---

/** Builds the worksheet for one level and returns it as a .docx buffer. */
export async function buildDocx({ content, levelId, originalTitle, translationLanguage }) {
  const level = getLevel(levelId);
  const title = content.title || originalTitle;
  const questions = numberQuestions(content);

  const body = [
    ...createWorksheetHeader(title, level.label),
    ...createReadingSection(content.paragraphs),
    ...createGlossarySection(content.glossary, translationLanguage),
    ...createQuestionsSection(questions),
    ...createAnswerKey(questions),
  ];
  return Packer.toBuffer(createDocument(title, level, body));
}

// --- Sections, in the order they appear in the document ---

/** Title, reading level, and a line for the student's name and date. */
function createWorksheetHeader(title, levelLabel) {
  return [
    new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
    paragraph([textRun(`Reading level: ${levelLabel}`, { italics: true, color: MUTED_GREY })]),
    paragraph([textRun("Name: ______________________    Date: ____________")], {
      spacing: { after: 240 },
    }),
  ];
}

/** The rewritten article, with extra line spacing for easier reading. */
function createReadingSection(paragraphs) {
  return [
    heading("Read"),
    ...paragraphs.map((text) =>
      paragraph([textRun(text)], { spacing: { after: 200, line: 360 } }),
    ),
  ];
}

/** Glossary heading plus each term; empty when there is no glossary. */
function createGlossarySection(glossary, translationLanguage) {
  if (!glossary.length) return [];
  const title = translationLanguage
    ? `Glossary (English / ${translationLanguage})`
    : "Glossary";
  return [
    heading(title),
    ...glossary.flatMap((entry) => createGlossaryEntry(entry, translationLanguage)),
  ];
}

/** One term: "term — definition", the optional translation, and an example sentence. */
function createGlossaryEntry(entry, translationLanguage) {
  const definition = paragraph(
    [textRun(entry.term, { bold: true }), textRun(` — ${entry.definition}`)],
    { spacing: { after: 40 } },
  );
  const translation = entry.translatedTerm
    ? paragraph(
        [
          textRun(`${translationLanguage}: `, { color: MUTED_GREY }),
          textRun(entry.translatedTerm, { bold: true }),
          textRun(` — ${entry.translatedDefinition}`),
        ],
        { spacing: { after: 40 }, indent: { left: INDENT_TWIPS } },
      )
    : null;
  const example = paragraph([textRun(`Example: ${entry.example}`, { italics: true })], {
    indent: { left: INDENT_TWIPS },
    spacing: { after: 200 },
  });
  return [definition, translation, example].filter(Boolean);
}

/** Questions heading, multiple choice (if any), then short answer (if any); empty when there are none. */
function createQuestionsSection({ multipleChoice, shortAnswer }) {
  if (!multipleChoice.length && !shortAnswer.length) return [];
  return [
    heading("Questions"),
    ...createMultipleChoiceQuestions(multipleChoice),
    ...createShortAnswerQuestions(shortAnswer),
  ];
}

/** "Circle the best answer." followed by each question and its lettered options. */
function createMultipleChoiceQuestions(questions) {
  if (!questions.length) return [];
  return [
    paragraph([textRun("Circle the best answer.", { italics: true })]),
    ...questions.flatMap((question) => [
      createQuestionPrompt(question),
      ...question.options.map((option, index) => createAnswerOption(option, index)),
    ]),
  ];
}

/** One lettered option. All but the last stay on the same page as the next line. */
function createAnswerOption(option, index) {
  return paragraph([textRun(`${OPTION_LETTERS[index]}.  ${option}`)], {
    indent: { left: INDENT_TWIPS },
    spacing: { after: 40 },
    keepNext: index < OPTION_LETTERS.length - 1,
  });
}

/** "Answer in full sentences." followed by each question and blank lines to write on. */
function createShortAnswerQuestions(questions) {
  if (!questions.length) return [];
  const instructions = paragraph([textRun("Answer in full sentences.", { italics: true })], {
    spacing: { before: 240, after: 160 },
  });
  return [
    instructions,
    ...questions.flatMap((question) => [createQuestionPrompt(question), ...createAnswerLines()]),
  ];
}

/** Grey lines for the student to write a short answer on. */
function createAnswerLines() {
  return Array.from({ length: ANSWER_LINES_PER_QUESTION }, () =>
    paragraph([textRun(ANSWER_LINE, { color: ANSWER_LINE_GREY })], { spacing: { after: 120 } }),
  );
}

/** A bold numbered question, kept on the same page as its options or answer lines. */
function createQuestionPrompt(question) {
  return paragraph([textRun(`${question.number}. ${question.question}`, { bold: true })], {
    spacing: { before: 160, after: 80 },
    keepNext: true,
  });
}

/** Answer key on its own page, so teachers can remove it before copying. Empty when there are no questions. */
function createAnswerKey({ multipleChoice, shortAnswer }) {
  if (!multipleChoice.length && !shortAnswer.length) return [];
  const multipleChoiceAnswers = multipleChoice.map((question) => {
    const correctText = question.options[OPTION_LETTERS.indexOf(question.correctOption)] ?? "";
    return createAnswerKeyLine(question.number, `${question.correctOption} — ${correctText}`, 80);
  });
  const shortAnswerAnswers = shortAnswer.map((question) =>
    createAnswerKeyLine(question.number, question.modelAnswer || "(open answer)", 120),
  );
  return [
    heading("Answer Key", { pageBreakBefore: true, spacing: { after: 160 } }),
    ...multipleChoiceAnswers,
    ...shortAnswerAnswers,
  ];
}

/** One answer-key line: bold question number, then the answer. */
function createAnswerKeyLine(number, answerText, spacingAfter) {
  return paragraph([textRun(`${number}. `, { bold: true }), textRun(answerText)], {
    spacing: { after: spacingAfter },
  });
}

// --- Helpers ---

/** Numbers all questions in order (multiple choice first, then short answer), so every section agrees. */
function numberQuestions({ multipleChoice, shortAnswer }) {
  return {
    multipleChoice: multipleChoice.map((question, index) => ({ ...question, number: index + 1 })),
    shortAnswer: shortAnswer.map((question, index) => ({
      ...question,
      number: multipleChoice.length + index + 1,
    })),
  };
}

/** Wraps the body in a Word document, with larger print for younger readers. */
function createDocument(title, level, body) {
  const fontSize = LARGE_PRINT_LEVELS.has(level.id) ? LARGE_PRINT_SIZE : NORMAL_PRINT_SIZE;
  return new Document({
    creator: "ESL Article Scaffolder",
    title: `${title} (${level.label})`,
    styles: { default: { document: { run: { font: "Arial", size: fontSize } } } },
    sections: [{ properties: {}, children: body }],
  });
}
