/**
 * Plan 10-01 Task 2 — Plain-text parser (.txt).
 *
 * Reads UTF-8 content, returns a ParsedDocument with no section locators.
 * Enforces 50 MB hard skip and 5 MB extracted-text truncate.
 */
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';

export const SIZE_LIMIT_BYTES = 50 * 1024 * 1024;     // 50 MB hard skip
export const TEXT_TRUNCATE_BYTES = 5 * 1024 * 1024;   // 5 MB extracted-text cap

export interface SectionLocator {
  label: string;
  charStart: number;
  charEnd: number;
}

export interface ParsedDocument {
  text: string;
  sectionLocators: SectionLocator[];
  truncated: boolean;
}

export async function parse(absolutePath: string): Promise<ParsedDocument> {
  const stat = await fsp.stat(absolutePath);
  if (stat.size > SIZE_LIMIT_BYTES) {
    throw Object.assign(new Error(`File exceeds 50 MB hard limit: ${absolutePath}`), {
      code: 'size_exceeds_limit',
    });
  }

  const buf = await fsp.readFile(absolutePath);
  let text = buf.toString('utf8');
  let truncated = false;
  if (Buffer.byteLength(text, 'utf8') > TEXT_TRUNCATE_BYTES) {
    text = text.slice(0, TEXT_TRUNCATE_BYTES);
    truncated = true;
  }
  return { text, sectionLocators: [], truncated };
}
