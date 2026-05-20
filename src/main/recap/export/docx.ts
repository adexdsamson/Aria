/**
 * Plan 08-02 Task 5 — RecapCanonical → DOCX Buffer.
 *
 * Imperative tree per dolanmiu/docx: Document → Section → Paragraph(s).
 * Reads from `RecapCanonical` ONLY — never `editor.getHTML()` (research
 * Pitfall 7). The render order mirrors the on-screen recap so the audit list
 * always appears under the narrative inside "What Aria did this week".
 */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
} from 'docx';
import type { RecapCanonical, Section, Block } from '../schema';

const SECTION_ORDER: Array<{ key: keyof RecapCanonical & string; isWAD?: boolean }> = [
  { key: 'meetings' },
  { key: 'actions' },
  { key: 'wins' },
  { key: 'upcoming' },
  { key: 'whatAriaDid', isWAD: true },
];

function blocksToParagraphs(blocks: Block[]): Paragraph[] {
  if (blocks.length === 0) {
    return [new Paragraph({ children: [new TextRun({ text: '(none)', italics: true })] })];
  }
  const out: Paragraph[] = [];
  for (const b of blocks) {
    if (b.kind === 'paragraph') {
      out.push(new Paragraph({ children: [new TextRun(b.text)] }));
    } else if (b.kind === 'bullet_list') {
      for (const item of b.items) {
        out.push(new Paragraph({ children: [new TextRun(item)], bullet: { level: 0 } }));
      }
    } else if (b.kind === 'numbered_list') {
      // No numbering reference for v1 — render with manual "n." prefix to avoid
      // shipping a numbering.xml definition.
      b.items.forEach((item, i) => {
        out.push(new Paragraph({ children: [new TextRun(`${i + 1}. ${item}`)] }));
      });
    }
  }
  return out;
}

function sectionToParagraphs(heading: string, section: Section | { heading: string; blocks: Block[] }): Paragraph[] {
  const headingPara = new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun(heading)],
  });
  return [headingPara, ...blocksToParagraphs(section.blocks)];
}

export async function exportRecapDocx(canonical: RecapCanonical): Promise<Buffer> {
  const children: Paragraph[] = [];
  for (const s of SECTION_ORDER) {
    if (s.isWAD) {
      const wad = canonical.whatAriaDid;
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(wad.heading)] }));
      // Narrative paragraph FIRST (above the trust-anchor list).
      if (wad.narrative.trim().length > 0) {
        children.push(new Paragraph({ children: [new TextRun(wad.narrative)] }));
      }
      children.push(...blocksToParagraphs(wad.blocks));
    } else {
      const sec = canonical[s.key] as Section;
      children.push(...sectionToParagraphs(sec.heading, sec));
    }
  }
  const doc = new Document({
    sections: [{ properties: {}, children }],
  });
  return await Packer.toBuffer(doc);
}
