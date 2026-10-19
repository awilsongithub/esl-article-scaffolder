// Renders a level's content JSON into an editable Word document.
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { getLevel } from "../config.js";

const LETTERS = ["A", "B", "C", "D"];

const heading = (text, opts = {}) =>
  new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 360, after: 160 },
    ...opts,
  });
const para = (children, opts = {}) =>
  new Paragraph({ children, spacing: { after: 160 }, ...opts });
const run = (text, opts = {}) => new TextRun({ text, ...opts });

export async function buildDocx({
  content,
  levelId,
  originalTitle,
  translationLanguage,
}) {
  const level = getLevel(levelId);
  const children = [];

  children.push(
    new Paragraph({
      text: content.title || originalTitle,
      heading: HeadingLevel.HEADING_1,
    }),
  );
  children.push(
    para([
      run(`Reading level: ${level.label}`, { italics: true, color: "555555" }),
    ]),
  );
  children.push(
    para([run("Name: ______________________    Date: ____________")], {
      spacing: { after: 240 },
    }),
  );

  children.push(heading("Read"));
  for (const p of content.paragraphs)
    children.push(para([run(p)], { spacing: { after: 200, line: 360 } }));

  if (content.glossary.length) {
    children.push(
      heading(
        translationLanguage
          ? `Glossary (English / ${translationLanguage})`
          : "Glossary",
      ),
    );
    for (const g of content.glossary) {
      children.push(
        para([run(g.term, { bold: true }), run(` — ${g.definition}`)], {
          spacing: { after: 40 },
        }),
      );
      if (g.translatedTerm) {
        children.push(
          para(
            [
              run(`${translationLanguage}: `, { color: "555555" }),
              run(g.translatedTerm, { bold: true }),
              run(` — ${g.translatedDefinition}`),
            ],
            { spacing: { after: 40 }, indent: { left: 360 } },
          ),
        );
      }
      children.push(
        para([run(`Example: ${g.example}`, { italics: true })], {
          indent: { left: 360 },
          spacing: { after: 200 },
        }),
      );
    }
  }

  const questions = content.multipleChoice.length + content.shortAnswer.length;
  if (questions) {
    children.push(heading("Questions"));
    let n = 1;
    if (content.multipleChoice.length) {
      children.push(para([run("Circle the best answer.", { italics: true })]));
      for (const q of content.multipleChoice) {
        children.push(
          para([run(`${n++}. ${q.question}`, { bold: true })], {
            spacing: { before: 160, after: 80 },
            keepNext: true,
          }),
        );
        q.options.forEach((opt, i) =>
          children.push(
            para([run(`${LETTERS[i]}.  ${opt}`)], {
              indent: { left: 360 },
              spacing: { after: 40 },
              keepNext: i < 3,
            }),
          ),
        );
      }
    }
    if (content.shortAnswer.length) {
      children.push(
        para([run("Answer in full sentences.", { italics: true })], {
          spacing: { before: 240, after: 160 },
        }),
      );
      for (const q of content.shortAnswer) {
        children.push(
          para([run(`${n++}. ${q.question}`, { bold: true })], {
            spacing: { before: 160, after: 80 },
            keepNext: true,
          }),
        );
        for (let i = 0; i < 3; i++)
          children.push(
            para([run("_".repeat(70), { color: "999999" })], {
              spacing: { after: 120 },
            }),
          );
      }
    }

    // Answer key on its own page so teachers can remove it before copying.
    children.push(
      new Paragraph({
        text: "Answer Key",
        heading: HeadingLevel.HEADING_2,
        pageBreakBefore: true,
        spacing: { after: 160 },
      }),
    );
    n = 1;
    for (const q of content.multipleChoice) {
      const idx = LETTERS.indexOf(q.correctOption);
      children.push(
        para(
          [
            run(`${n++}. `, { bold: true }),
            run(`${q.correctOption} — ${q.options[idx] ?? ""}`),
          ],
          { spacing: { after: 80 } },
        ),
      );
    }
    for (const q of content.shortAnswer) {
      children.push(
        para(
          [
            run(`${n++}. `, { bold: true }),
            run(q.modelAnswer || "(open answer)"),
          ],
          { spacing: { after: 120 } },
        ),
      );
    }
  }

  // Larger print for younger readers. Sizes are in half-points.
  const size = levelId === "k" ? 32 : 24;
  const doc = new Document({
    creator: "ESL Article Leveler",
    title: `${content.title || originalTitle} (${level.label})`,
    styles: { default: { document: { run: { font: "Arial", size } } } },
    sections: [{ properties: {}, children }],
  });
  return Packer.toBuffer(doc);
}
