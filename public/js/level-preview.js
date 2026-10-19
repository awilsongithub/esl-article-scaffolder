// In-browser preview of one generated level: article, glossary and questions with answers.
// REACT: becomes <LevelPreview content={…} />.
import { requestApi } from "./api.js";
import { createElement, createErrorMessage } from "./dom.js";

const OPTION_LETTERS = ["A", "B", "C", "D"];

/** Loads a level's content JSON and renders the preview into `container`. */
export async function renderLevelPreview(articleId, levelId, translationLanguage, container) {
  let level;
  try {
    level = await requestApi(`/articles/${articleId}/levels/${levelId}`);
  } catch (err) {
    container.replaceChildren(createErrorMessage(err.message));
    return;
  }
  const content = level.content;
  if (!content) {
    container.replaceChildren();
    return;
  }

  const heading = createElement("h3", {}, `${content.title} — ${level.label}`);
  const paragraphs = content.paragraphs.map((text) => createElement("p", {}, text));
  const glossarySection = buildGlossarySection(content.glossary, translationLanguage);
  const questionsSection = buildQuestionsSection(content.multipleChoice, content.shortAnswer);

  const preview = createElement(
    "div",
    { class: "preview" },
    heading,
    paragraphs,
    glossarySection,
    questionsSection,
  );
  container.replaceChildren(preview);
}

/** Builds the "Glossary" heading and term list, or nothing when the glossary is empty. */
function buildGlossarySection(glossary, translationLanguage) {
  if (!glossary.length) return [];
  const entries = glossary.flatMap((entry) => buildGlossaryEntry(entry, translationLanguage));
  const heading = createElement("h4", {}, "Glossary");
  const list = createElement("dl", { class: "glossary" }, entries);
  return [heading, list];
}

/** Builds the <dt>/<dd> elements for one glossary term: definition, optional translation, example. */
function buildGlossaryEntry(entry, translationLanguage) {
  const term = createElement("dt", {}, entry.term);
  const definition = createElement("dd", {}, entry.definition);
  const translation = entry.translatedTerm
    ? createElement(
        "dd",
        { class: "translation" },
        `${translationLanguage}: ${entry.translatedTerm} — ${entry.translatedDefinition}`,
      )
    : null;
  const example = createElement("dd", { class: "example" }, `Example: ${entry.example}`);
  return [term, definition, translation, example];
}

/** Builds the numbered question list (multiple choice first, then short answer), or nothing if there are none. */
function buildQuestionsSection(multipleChoice, shortAnswer) {
  if (!multipleChoice.length && !shortAnswer.length) return [];
  const heading = createElement("h4", {}, "Questions (with answers)");
  const items = [
    ...multipleChoice.map(buildMultipleChoiceItem),
    ...shortAnswer.map(buildShortAnswerItem),
  ];
  const list = createElement("ol", { class: "questions" }, items);
  return [heading, list];
}

/** Builds one multiple-choice question: the question, its four options and the correct answer. */
function buildMultipleChoiceItem(question) {
  const options = question.options.map((option) => createElement("li", {}, option));
  const optionList = createElement("ol", { class: "options" }, options);
  const correctText = question.options[OPTION_LETTERS.indexOf(question.correctOption)] ?? "";
  const answer = createElement(
    "div",
    { class: "answer" },
    `Answer: ${question.correctOption} — ${correctText}`,
  );
  return createElement("li", {}, question.question, optionList, answer);
}

/** Builds one short-answer question with its model answer. */
function buildShortAnswerItem(question) {
  const answer = createElement("div", { class: "answer" }, `Model answer: ${question.modelAnswer}`);
  return createElement("li", {}, question.question, answer);
}
