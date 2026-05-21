/**
 * Plan 10-01 Task 2 — DOCX parser (.docx) via mammoth.
 *
 * Returns extracted plain text with paragraph-derived section locators.
 * Enforces 50 MB hard skip and 5 MB extracted-text truncate.
 */
import * as fsp from 'node:fs/promises';
import mammoth from 'mammoth';
import { SIZE_LIMIT_BYTES, TEXT_TRUNCATE_BYTES, type ParsedDocument, type SectionLocator } from './text';

export async function parse(absolutePath: string): Promise<ParsedDocument> {
  const stat = await fsp.stat(absolutePath);
  if (stat.size > SIZE_LIMIT_BYTES) {
    throw Object.assign(new Error(`File exceeds 50 MB hard limit: ${absolutePath}`), {
      code: 'size_exceeds_limit',
    });
  }

  const buf = await fsp.readFile(absolutePath);
  const result = await mammoth.extractRawText({ buffer: buf });
  let text = result.value ?? '';
  let truncated = false;
  if (Buffer.byteLength(text, 'utf8') > TEXT_TRUNCATE_BYTES) {
    text = text.slice(0, TEXT_TRUNCATE_BYTES);
    truncated = true;
  }

  // Build paragraph-level locators from double-newline boundaries.
  const sectionLocators: SectionLocator[] = [];
  const paragraphs = text.split(/\n\n+/);
  let charPos = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i]!;
    const label = para.slice(0, 60).replace(/\s+/g, ' ').trim() || `paragraph ${i + 1}`;
    sectionLocators.push({ label, charStart: charPos, charEnd: charPos + para.length });
    charPos += para.length + 2; // account for the '\n\n' separator
  }

  return { text, sectionLocators, truncated };
}
