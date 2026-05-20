/**
 * Plan 08-02 Task 7 — RecapScreen reachability + render tests.
 *
 * Test 6 (L-04-04 reachability): RecapScreen is imported by routes.tsx.
 * Test 8 (H-4 renderer): gmail + outlook audit rows both render their
 * respective provider label in the trust-anchor list (the orchestrator already
 * produced the line strings; the renderer just lists them).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('RecapScreen reachability', () => {
  it('Test 6 (L-04-04): RecapScreen + /recap route are referenced by routes.tsx', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../app/routes.tsx'),
      'utf8',
    );
    expect(src).toMatch(/RecapScreen/);
    expect(src).toMatch(/\/recap/);
  });

  it('SideNav links to /recap with the Weekly Recap label', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../components/SideNav.tsx'),
      'utf8',
    );
    expect(src).toMatch(/sidenav-recap/);
    expect(src).toMatch(/Weekly Recap/);
  });
});

describe('Provider-label centralization (H-4)', () => {
  it('Test 8: RecapEditor renderer-local providerLabel maps gmail/outlook deterministically', () => {
    // The renderer's local providerLabel mirrors src/main/recap/audit-view.ts.
    const src = fs.readFileSync(
      path.resolve(__dirname, 'RecapEditor.tsx'),
      'utf8',
    );
    expect(src).toContain("gmail: 'Gmail'");
    expect(src).toContain("outlook: 'Outlook'");
    // No hardcoded 'Sent draft via Gmail' literal that would mis-label Outlook rows.
    expect(src).not.toMatch(/Sent draft via Gmail/);
  });

  it('Test 9 (H-4): exporters share the same provider-label conventions (audit-row strings already carry the correct label upstream)', () => {
    // The orchestrator (src/main/recap/generate.ts) calls renderAuditRowLine
    // from src/main/recap/audit-view.ts, which uses providerLabel() — so the
    // pre-rendered string for an outlook send already contains "Outlook".
    // exportRecapDocx + exportRecapPdf treat the items as opaque strings and
    // never re-derive the provider label. This test asserts the
    // centralization is grep-visible.
    const auditView = fs.readFileSync(
      path.resolve(__dirname, '../../../main/recap/audit-view.ts'),
      'utf8',
    );
    expect(auditView).toContain("outlook: 'Outlook'");
    expect(auditView).toContain("gmail: 'Gmail'");
    expect(auditView).toContain('renderAuditRowLine');
    const docx = fs.readFileSync(
      path.resolve(__dirname, '../../../main/recap/export/docx.ts'),
      'utf8',
    );
    expect(docx).not.toMatch(/['"]Gmail['"]/);
    expect(docx).not.toMatch(/['"]Outlook['"]/);
    const pdf = fs.readFileSync(
      path.resolve(__dirname, '../../../main/recap/export/pdf.tsx'),
      'utf8',
    );
    expect(pdf).not.toMatch(/['"]Gmail['"]/);
    expect(pdf).not.toMatch(/['"]Outlook['"]/);
  });
});
