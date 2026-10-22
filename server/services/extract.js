// Turns an uploaded file into clean plain text,
// and derives a title and word count from it.
import path from "node:path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

/**
 * A file that can't be read.
 * app.js maps it to a 400.
 */
export class ExtractError extends Error {}

const MAX_TITLE_LINE_CHARS = 120;
const MAX_TITLE_LINE_WORDS = 15;
const FALLBACK_TITLE_CHARS = 80;

// One reader per supported extension; each returns the raw text of the file.
const TEXT_READERS = {
    ".pdf": readPdfText,
    ".docx": readWordText,
    ".txt": readPlainText,
    ".md": readPlainText,
};

/**
 * Returns the normalized text of an uploaded file.
 * Throws ExtractError with a message for teachers if it can't be read.
 * DRIVE: add a source_type 'gdrive' handler here — download the file
 * (or export a Google Doc as .docx/.txt) to a buffer, then reuse
 * extractText().
 */
export async function extractText(buffer, filename) {
    const extension = path.extname(filename).toLowerCase();
    const readText = TEXT_READERS[extension];
    if (!readText)
        throw new ExtractError(`Unsupported file type "${extension}".`);

    const text = normalize(await readText(buffer));
    if (!text) throw new ExtractError(noTextMessage(extension));
    return text;
}

/**
 * Unifies line endings, drops PDF page markers and trailing spaces,
 * and collapses big gaps.
 */
export function normalize(text) {
    return text
        .replace(/\r\n?/g, "\n")
        .replace(/-- \d+ of \d+ --/g, "") // page markers added by pdf-parse
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/** Counts runs of non-whitespace as words. */
export function countWords(text) {
    return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Picks a title: the first markdown heading, else a short first line,
 * else the filename, else the start of the text.
 */
export function deriveTitle(text, filename) {
    const heading = text.match(/^#{1,6}\s+(.+)$/m);
    if (heading) return heading[1].trim();
    const firstLine =
        text
            .split("\n")
            .find((line) => line.trim())
            ?.trim() ?? "";
    if (firstLine && isShortEnoughForTitle(firstLine)) return firstLine;
    if (filename) return path.basename(filename, path.extname(filename));
    return firstLine.slice(0, FALLBACK_TITLE_CHARS) || "Untitled article";
}

// --- Readers ---

/**
 * Text of a PDF.
 * Throws ExtractError if it is damaged or password-protected.
 */
async function readPdfText(buffer) {
    const parser = new PDFParse({ data: buffer });
    try {
        return (await parser.getText()).text;
    } catch {
        throw new ExtractError(
            "Could not read this PDF. It may be damaged or password-protected.",
        );
    } finally {
        await parser.destroy();
    }
}

/**
 * Text of a .docx file.
 * Throws ExtractError if it can't be read.
 */
async function readWordText(buffer) {
    try {
        return (await mammoth.extractRawText({ buffer })).value;
    } catch {
        throw new ExtractError(
            "Could not read this Word file. Please save it as .docx and try again.",
        );
    }
}

/** Text of a .txt or .md file, read as UTF-8. */
function readPlainText(buffer) {
    return buffer.toString("utf8");
}

// --- Helpers ---

/**
 * The error shown when a file has no text.
 * For PDFs, it explains that scanned pages aren't supported.
 */
function noTextMessage(extension) {
    return extension === ".pdf"
        ? "No text found in this PDF. Scanned PDFs (images of pages) are not supported yet."
        : "No text found in this file.";
}

/** Whether a line is short enough, in chars and words, to be the title. */
function isShortEnoughForTitle(line) {
    return (
        line.length <= MAX_TITLE_LINE_CHARS &&
        countWords(line) <= MAX_TITLE_LINE_WORDS
    );
}
