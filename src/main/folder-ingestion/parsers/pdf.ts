/**
 * Plan 10-01 Task 2 — PDF parser (.pdf) via pdfjs-dist legacy build.
 *
 * Returns page-concatenated text with 'page N' section locators.
 * On scanned PDFs (no extractable text) returns empty text and throws with
 * last_error='likely_scanned_no_ocr'.
 * Enforces 50 MB hard skip and 5 MB extracted-text truncate.
 */
import * as fsp from 'node:fs/promises';
import { SIZE_LIMIT_BYTES, TEXT_TRUNCATE_BYTES, type ParsedDocument, type SectionLocator } from './text';

export async function parse(absolutePath: string): Promise<ParsedDocument> {
  const stat = await fsp.stat(absolutePath);
  if (stat.size > SIZE_LIMIT_BYTES) {
    throw Object.assign(new Error(`File exceeds 50 MB hard limit: ${absolutePath}`), {
      code: 'size_exceeds_limit',
    });
  }

  // Dynamic import to avoid issues with canvas/worker resolution in test environments.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js') as typeof import('pdfjs-dist');
  // Disable worker for Node.js compatibility.
  pdfjs.GlobalWorkerOptions.workerSrc = '';

  const buf = await fsp.readFile(absolutePath);
  const typedArray = new Uint8Array(buf);

  const loadingTask = pdfjs.getDocument({
    data: typedArray,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
  });
  const doc = await loadingTask.promise;

  const sectionLocators: SectionLocator[] = [];
  const parts: string[] = [];
  let charPos = 0;

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ('str' in item ? (item as { str: string }).str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (pageText.length > 0) {
      const charStart = charPos;
      sectionLocators.push({ label: `page ${pageNum}`, charStart, charEnd: charStart + pageText.length });
      parts.push(pageText);
      charPos += pageText.length + 1; // +1 for the join '\n'
    }
  }

  let text = parts.join('\n');

  if (text.trim().length === 0) {
    throw Object.assign(
      new Error(`PDF appears to be scanned with no extractable text: ${absolutePath}`),
      { code: 'likely_scanned_no_ocr' },
    );
  }

  let truncated = false;
  if (Buffer.byteLength(text, 'utf8') > TEXT_TRUNCATE_BYTES) {
    text = text.slice(0, TEXT_TRUNCATE_BYTES);
    truncated = true;
  }

  return { text, sectionLocators, truncated };
}
