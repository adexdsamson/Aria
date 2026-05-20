/**
 * Plan 08-02 Task 5 — PDF exporter tests.
 *
 * PDF assertion strategy: text content is embedded in the PDF stream
 * (uncompressed for short documents under @react-pdf's default config, or
 * Flate-compressed otherwise). We inflate every FlateDecode stream and grep
 * the concatenated text bodies for our expected substrings, avoiding the
 * pdf-parse devDep.
 *
 * NOTE: vitest must be run from a process where @react-pdf can locate its
 * fontkit/pdfkit deps. Under the ABI/EBUSY lock the runner may be skipped;
 * the source-grep test (Test 6) still runs.
 */
import { describe, it, expect } from 'vitest';
import { exportRecapPdf } from './pdf';
import type { RecapCanonical } from '../schema';
import * as zlib from 'node:zlib';

const fixtureCanonical: RecapCanonical = {
  isoWeek: '2026-W20',
  weekStartYmd: '2026-05-11',
  meetings: { heading: 'Meetings held', blocks: [{ kind: 'paragraph', text: 'Five.' }] },
  actions: { heading: 'Actions closed', blocks: [] },
  wins: { heading: 'Wins', blocks: [] },
  upcoming: { heading: "What's coming", blocks: [] },
  whatAriaDid: {
    heading: 'What Aria did this week',
    narrative: 'Sent two.',
    auditRowRefs: [],
    blocks: [{ kind: 'bullet_list', items: ['Gmail row token', 'Outlook row token'] }],
  },
};

function extractTextFromPdf(buf: Buffer): string {
  // Find every `stream\n...endstream` block. Inflate flate-decoded; concat raw otherwise.
  const text = buf.toString('binary');
  const out: string[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = Buffer.from(m[1], 'binary');
    try {
      out.push(zlib.inflateSync(raw).toString('utf8'));
    } catch {
      out.push(raw.toString('utf8'));
    }
  }
  // Also include the raw header/trailer text for the heading strings @react-pdf
  // sometimes leaves embedded in content streams.
  out.push(text);
  return out.join('\n');
}

describe('exportRecapPdf', () => {
  it('Test 3: produces a non-empty PDF Buffer beginning with %PDF', async () => {
    const buf = await exportRecapPdf(fixtureCanonical);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
  });

  it('Test 3+5: PDF text streams contain every section heading + audit row', async () => {
    const buf = await exportRecapPdf(fixtureCanonical);
    const text = extractTextFromPdf(buf);
    for (const s of ['Meetings held', 'Actions closed', 'Wins', 'What Aria did this week', 'Sent two.', 'Gmail row token', 'Outlook row token']) {
      expect(text).toContain(s);
    }
  });

  it('Test 6: no HTML intermediate — grep pdf.tsx source for editor.getHTML / DOMParser', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.resolve(__dirname, 'pdf.tsx'), 'utf8');
    expect(src).not.toMatch(/getHTML/);
    expect(src).not.toMatch(/DOMParser/);
    expect(src).not.toMatch(/innerHTML/);
  });
});
