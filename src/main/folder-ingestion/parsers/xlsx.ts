/**
 * Plan 10-01 Task 2 — XLSX parser (.xlsx) via exceljs.
 *
 * Returns sheet-by-sheet flattened text with sheet-name section locators.
 * Enforces 50 MB hard skip and 5 MB extracted-text truncate.
 */
import * as fsp from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { SIZE_LIMIT_BYTES, TEXT_TRUNCATE_BYTES, type ParsedDocument, type SectionLocator } from './text';

export async function parse(absolutePath: string): Promise<ParsedDocument> {
  const stat = await fsp.stat(absolutePath);
  if (stat.size > SIZE_LIMIT_BYTES) {
    throw Object.assign(new Error(`File exceeds 50 MB hard limit: ${absolutePath}`), {
      code: 'size_exceeds_limit',
    });
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(absolutePath);

  const sections: Array<{ label: string; content: string }> = [];
  workbook.eachSheet((sheet) => {
    const rows: string[] = [];
    sheet.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        cells.push(String(cell.value ?? ''));
      });
      if (cells.length > 0) rows.push(cells.join('\t'));
    });
    sections.push({ label: sheet.name, content: rows.join('\n') });
  });

  const sectionLocators: SectionLocator[] = [];
  let text = '';
  for (const section of sections) {
    const charStart = text.length;
    const sectionText = `${section.label}:\n${section.content}`;
    sectionLocators.push({ label: section.label, charStart, charEnd: charStart + sectionText.length });
    text += sectionText + '\n\n';
  }

  let truncated = false;
  if (Buffer.byteLength(text, 'utf8') > TEXT_TRUNCATE_BYTES) {
    text = text.slice(0, TEXT_TRUNCATE_BYTES);
    truncated = true;
  }

  return { text, sectionLocators, truncated };
}
