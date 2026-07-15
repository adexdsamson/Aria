/**
 * Plan 10-01 Task 2 — PDF parser (.pdf) via pdfjs-dist legacy build.
 *
 * Returns page-concatenated text with 'page N' section locators.
 * On scanned PDFs (no extractable text) returns empty text and throws with
 * last_error='likely_scanned_no_ocr'.
 * Enforces 50 MB hard skip and 5 MB extracted-text truncate.
 */
import * as fsp from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { SIZE_LIMIT_BYTES, TEXT_TRUNCATE_BYTES, type ParsedDocument, type SectionLocator } from './text';

export async function parse(absolutePath: string): Promise<ParsedDocument> {
  const stat = await fsp.stat(absolutePath);
  if (stat.size > SIZE_LIMIT_BYTES) {
    throw Object.assign(new Error(`File exceeds 50 MB hard limit: ${absolutePath}`), {
      code: 'size_exceeds_limit',
    });
  }

  // pdfjs-dist v5 legacy build is ESM-only (`pdf.mjs`; there is no `pdf.js`),
  // and it's externalized, so load it via a real runtime dynamic import.
  // The specifier is held in a variable so the bundler can't rewrite the
  // import() into a CJS require() (which would throw ERR_REQUIRE_ESM on .mjs).
  const pdfjsSpecifier = 'pdfjs-dist/legacy/build/pdf.mjs';
  const pdfjs = (await import(pdfjsSpecifier)) as unknown as typeof import('pdfjs-dist');
  // pdfjs v5 still spins up its worker in Electron's main process: pdf.js detects
  // Electron as browser-like (not Node), so it takes the browser fake-worker path,
  // which REQUIRES a loadable `workerSrc`. An empty string throws
  // "Setting up fake worker failed: No GlobalWorkerOptions.workerSrc specified"
  // and every PDF fails to parse (the earlier `workerSrc = ''` "disable" trick
  // only worked under the old Node-detection path). Point it at the legacy worker
  // .mjs as a file:// URL — a bare/OS path is not a valid ESM import specifier —
  // so the in-process fake worker can import() it.
  const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

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
