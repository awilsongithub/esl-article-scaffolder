import path from 'node:path';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

export class ExtractError extends Error {}

// DRIVE: add a source_type 'gdrive' handler here — download the file (or export a Google Doc
// as .docx/.txt) to a buffer, then reuse extractText().
export async function extractText(buffer, filename) {
  const ext = path.extname(filename).toLowerCase();
  let text;
  if (ext === '.pdf') {
    const parser = new PDFParse({ data: buffer });
    try {
      text = (await parser.getText()).text;
    } catch {
      throw new ExtractError('Could not read this PDF. It may be damaged or password-protected.');
    } finally {
      await parser.destroy();
    }
  } else if (ext === '.docx') {
    try {
      text = (await mammoth.extractRawText({ buffer })).value;
    } catch {
      throw new ExtractError('Could not read this Word file. Please save it as .docx and try again.');
    }
  } else if (ext === '.txt' || ext === '.md') {
    text = buffer.toString('utf8');
  } else {
    throw new ExtractError(`Unsupported file type "${ext}".`);
  }
  text = normalize(text);
  if (!text) {
    throw new ExtractError(
      ext === '.pdf'
        ? 'No text found in this PDF. Scanned PDFs (images of pages) are not supported yet.'
        : 'No text found in this file.',
    );
  }
  return text;
}

export function normalize(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/-- \d+ of \d+ --/g, '') // page markers added by pdf-parse
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

// First markdown heading, else a short first line, else the filename.
export function deriveTitle(text, filename) {
  const heading = text.match(/^#{1,6}\s+(.+)$/m);
  if (heading) return heading[1].trim();
  const firstLine = text.split('\n').find((l) => l.trim())?.trim() ?? '';
  if (firstLine && firstLine.length <= 120 && countWords(firstLine) <= 15) return firstLine;
  if (filename) return path.basename(filename, path.extname(filename));
  return firstLine.slice(0, 80) || 'Untitled article';
}
