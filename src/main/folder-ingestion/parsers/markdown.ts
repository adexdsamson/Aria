/**
 * Plan 10-01 Task 2 — Markdown parser (.md).
 *
 * Reads text, extracts H1/H2/H3 headings as section locators with char offsets.
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

  let text = (await fsp.readFile(absolutePath)).toString('utf8');
  let truncated = false;
  if (Buffer.byteLength(text, 'utf8') > TEXT_TRUNCATE_BYTES) {
    text = text.slice(0, TEXT_TRUNCATE_BYTES);
    truncated = true;
  }

  const sectionLocators: SectionLocator[] = [];
  const headingRe = /^#{1,3}\s+(.+)$/m;
  const lines = text.split('\n');

  let charPos = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = headingRe.exec(line);
    if (match) {
      const charStart = charPos;
      const nextI = i + 1;
      // charEnd: start of next heading or end of text
      let charEnd = text.length;
      let scanPos = charPos + line.length + 1; // +1 for the newline
      for (let j = nextI; j < lines.length; j++) {
        if (headingRe.test(lines[j]!)) {
          charEnd = scanPos;
          break;
        }
        scanPos += lines[j]!.length + 1;
      }
      sectionLocators.push({ label: match[1]!.trim(), charStart, charEnd });
    }
    charPos += line.length + 1; // +1 for newline
  }

  return { text, sectionLocators, truncated };
}
