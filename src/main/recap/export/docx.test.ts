/**
 * Plan 08-02 Task 5 — DOCX exporter tests.
 *
 * DOCX is a ZIP container; we assert (a) the buffer has the PK zip magic,
 * (b) the underlying document.xml entry contains every section heading and
 * every audit-row string verbatim. We unzip via Node's built-in zlib by
 * locating the local file header for `word/document.xml` and inflating
 * its DEFLATE payload — avoids adding a mammoth/pdf-parse devDep just for
 * one test surface (per Option 2 lean-deps policy).
 */
import { describe, it, expect } from 'vitest';
import { exportRecapDocx } from './docx';
import type { RecapCanonical } from '../schema';
import * as zlib from 'node:zlib';

const fixtureCanonical: RecapCanonical = {
  isoWeek: '2026-W20',
  weekStartYmd: '2026-05-11',
  meetings: {
    heading: 'Meetings held',
    blocks: [{ kind: 'paragraph', text: 'Five meetings this week.' }],
  },
  actions: { heading: 'Actions closed', blocks: [{ kind: 'bullet_list', items: ['Closed Q3', 'Hired Sam'] }] },
  wins: { heading: 'Wins', blocks: [] },
  upcoming: { heading: "What's coming", blocks: [] },
  whatAriaDid: {
    heading: 'What Aria did this week',
    narrative: 'Sent two drafts.',
    auditRowRefs: ['email_send:1'],
    blocks: [{ kind: 'bullet_list', items: ['Sent draft via Gmail to alice@example.com', 'Sent draft via Outlook to bob@contoso.com'] }],
  },
};

function extractDocumentXml(buf: Buffer): string {
  // Find local file header for word/document.xml.
  const name = Buffer.from('word/document.xml');
  let idx = -1;
  for (let i = 0; i < buf.length - name.length; i++) {
    if (buf.compare(name, 0, name.length, i, i + name.length) === 0
        && buf.readUInt32LE(Math.max(0, i - 30)) === 0x04034b50) {
      idx = Math.max(0, i - 30);
      break;
    }
  }
  if (idx < 0) return '';
  const compressedSize = buf.readUInt32LE(idx + 18);
  const fileNameLength = buf.readUInt16LE(idx + 26);
  const extraLength = buf.readUInt16LE(idx + 28);
  const dataStart = idx + 30 + fileNameLength + extraLength;
  const compressed = buf.subarray(dataStart, dataStart + compressedSize);
  try {
    return zlib.inflateRawSync(compressed).toString('utf8');
  } catch {
    return compressed.toString('utf8');
  }
}

describe('exportRecapDocx', () => {
  it('Test 1: produces a non-empty docx Buffer with PK zip magic', async () => {
    const buf = await exportRecapDocx(fixtureCanonical);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf[0]).toBe(0x50); // P
    expect(buf[1]).toBe(0x4b); // K
  });

  it('Test 2 + Test 5: document.xml contains every section heading + every audit row', async () => {
    const buf = await exportRecapDocx(fixtureCanonical);
    const xml = extractDocumentXml(buf);
    expect(xml).toContain('Meetings held');
    expect(xml).toContain('Actions closed');
    expect(xml).toContain('Wins');
    expect(xml).toContain('What Aria did this week');
    expect(xml).toContain('Sent two drafts.');
    expect(xml).toContain('Sent draft via Gmail to alice@example.com');
    expect(xml).toContain('Sent draft via Outlook to bob@contoso.com');
  });

  it('Test 4: empty section renders "(none)" placeholder', async () => {
    const buf = await exportRecapDocx({
      ...fixtureCanonical,
      wins: { heading: 'Wins', blocks: [] },
    });
    const xml = extractDocumentXml(buf);
    expect(xml).toContain('(none)');
  });

  it('Test 6: no HTML intermediate — grep docx.ts source for editor.getHTML / DOMParser', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(__filename.replace('.test.ts', '.ts'), 'utf8');
    expect(src).not.toMatch(/getHTML/);
    expect(src).not.toMatch(/DOMParser/);
    expect(src).not.toMatch(/innerHTML/);
  });
});
