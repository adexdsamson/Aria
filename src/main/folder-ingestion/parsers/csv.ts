/**
 * Plan 10-01 Task 2 — CSV parser (.csv) via papaparse.
 *
 * Returns header-row-prefixed flat text; each data row carries a section
 * locator { label: 'row N', charStart, charEnd }.
 * Enforces 50 MB hard skip and 5 MB extracted-text truncate.
 */
import * as fsp from 'node:fs/promises';
import Papa from 'papaparse';
import { SIZE_LIMIT_BYTES, TEXT_TRUNCATE_BYTES, type ParsedDocument, type SectionLocator } from './text';

export async function parse(absolutePath: string): Promise<ParsedDocument> {
  const stat = await fsp.stat(absolutePath);
  if (stat.size > SIZE_LIMIT_BYTES) {
    throw Object.assign(new Error(`File exceeds 50 MB hard limit: ${absolutePath}`), {
      code: 'size_exceeds_limit',
    });
  }

  const raw = (await fsp.readFile(absolutePath)).toString('utf8');
  const result = Papa.parse<string[]>(raw, { header: false, skipEmptyLines: true });
  const rows = result.data as string[][];

  const lines: string[] = [];
  const sectionLocators: SectionLocator[] = [];

  let charPos = 0;
  const headerRow = rows[0] ?? [];
  const headerLine = headerRow.join('\t');
  lines.push(headerLine);
  charPos += headerLine.length + 1;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    const line = row.join('\t');
    const charStart = charPos;
    const charEnd = charStart + line.length;
    sectionLocators.push({ label: `row ${i}`, charStart, charEnd });
    lines.push(line);
    charPos += line.length + 1;
  }

  let text = lines.join('\n');
  let truncated = false;
  if (Buffer.byteLength(text, 'utf8') > TEXT_TRUNCATE_BYTES) {
    text = text.slice(0, TEXT_TRUNCATE_BYTES);
    truncated = true;
  }

  return { text, sectionLocators, truncated };
}
