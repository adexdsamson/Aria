/**
 * Plan 08.1-02 Task 11 — static-grep ratchet for the assertEntitled chokepoint.
 *
 * Mirrors the SHAPE of `tests/static/single-calendar-write-site.test.ts`.
 * Three guarantees:
 *
 *  1. Each of the 5 gated source files calls assertEntitled with the
 *     documented action literal (one per surface).
 *  2. No other file under src/main calls assertEntitled — this prevents future
 *     contributors from sprinkling the call as cosmetic decoration in places
 *     the gate is not actually enforcing anything.
 *  3. No file under src/main outside src/main/entitlement constructs a fake
 *     'pro' tier client-side. The license server is the only legitimate source
 *     of `tier: 'pro'` (it lives in JWT claims, never in app code).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..', 'src', 'main');

function abs(rel: string): string {
  return path.resolve(__dirname, '../..', rel).replace(/\\/g, '/');
}

const GATED_SITES = [
  { file: 'src/main/integrations/send.ts', action: 'email_send' },
  { file: 'src/main/integrations/write-event.ts', action: 'calendar_change' },
  {
    file: 'src/main/integrations/todoist/push-actions.ts',
    action: 'task_push',
  },
  { file: 'src/main/briefing/generate.ts', action: 'briefing_generate' },
  { file: 'src/main/ipc/ask.ts', action: 'rag_ask' },
] as const;

const ALLOWED_CALLERS = new Set(GATED_SITES.map((s) => abs(s.file)));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && /\.(ts|tsx|mts|cts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

const CALLSITE_RE =
  /(?:^|[^A-Za-z0-9_])assertEntitled\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*['"]([a-z_]+)['"]\s*\)/m;

describe('XCUT-08 single entitlement-gate-site enforcer', () => {
  for (const site of GATED_SITES) {
    it(`${site.file} calls assertEntitled(db, '${site.action}')`, () => {
      const fullPath = path.resolve(__dirname, '../..', site.file);
      const src = stripComments(fs.readFileSync(fullPath, 'utf8'));
      const re = new RegExp(
        String.raw`assertEntitled\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*['"]` +
          site.action +
          String.raw`['"]\s*\)`,
      );
      expect(
        re.test(src),
        `expected ${site.file} to call assertEntitled(db, '${site.action}')`,
      ).toBe(true);
    });
  }

  it('no file under src/main outside the 5 gated sites calls assertEntitled', () => {
    const files = walk(ROOT);
    const offenders: string[] = [];
    for (const f of files) {
      // Skip the entitlement module itself (defines + tests the gate).
      const norm = f.replace(/\\/g, '/');
      if (norm.includes('/src/main/entitlement/')) continue;
      if (norm.endsWith('.test.ts')) continue;
      const src = stripComments(fs.readFileSync(f, 'utf8'));
      if (CALLSITE_RE.test(src) && !ALLOWED_CALLERS.has(norm)) {
        offenders.push(norm);
      }
    }
    expect(
      offenders,
      `assertEntitled called outside the 5 allowed sites: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it("no file under src/main outside src/main/entitlement constructs tier: 'pro'", () => {
    const TIER_PRO_RE = /tier\s*:\s*['"]pro['"]/;
    const files = walk(ROOT);
    const offenders: string[] = [];
    for (const f of files) {
      const norm = f.replace(/\\/g, '/');
      if (norm.includes('/src/main/entitlement/')) continue;
      if (norm.includes('/src/main/db/migrations/')) continue;
      if (norm.endsWith('.test.ts')) continue;
      const src = stripComments(fs.readFileSync(f, 'utf8'));
      if (TIER_PRO_RE.test(src)) offenders.push(norm);
    }
    expect(
      offenders,
      `client-side construction of tier:'pro' found: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
