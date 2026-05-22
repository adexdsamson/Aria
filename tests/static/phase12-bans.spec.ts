/**
 * Phase 12 / Plan 12-01 — persistent bans ratchet.
 *
 * Enforces three invariants that Phase 12's locked decisions (D-05, D-06)
 * depend on. These never expire — future phases must keep this spec green.
 *
 *   1. `app.dock.hide` — D-05 (macOS dock always visible). The
 *      window-close path hides the BrowserWindow but never the dock,
 *      matching Slack / Notion / Linear chief-of-staff convention.
 *   2. `openAsHidden` — D-06 ADDENDUM (deprecated / no-op on macOS 13+).
 *      Passing it has no effect and signals confusion about the platform.
 *      The OS-mirror call uses `{ openAtLogin }` on darwin and
 *      `{ openAtLogin, args: ['--was-auto-launched'] }` on win32 — no
 *      openAsHidden anywhere.
 *   3. `nativeImage.composite` — there is no such API on `nativeImage` in
 *      Electron 41. Any tray-badge overlay work in 12-02 must use the
 *      documented `nativeImage.createFromBitmap` / `.crop` / `.resize` API
 *      surface; `composite` is a footgun shape that implies a misread of
 *      the docs.
 *
 * Walks src/main and src/preload. Comments are stripped before scanning so
 * doc-comments referencing the banned strings (like this file's header)
 * don't trip the ratchet — but actual source code does.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOTS = [
  path.resolve(__dirname, '..', '..', 'src', 'main'),
  path.resolve(__dirname, '..', '..', 'src', 'preload'),
];

const BANS = ['app.dock.hide', 'openAsHidden', 'nativeImage.composite'] as const;

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile() && /\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

const ALL_FILES = ROOTS.flatMap((r) => walk(r));

describe('Phase 12 persistent bans ratchet', () => {
  for (const banned of BANS) {
    it(`no file under src/main or src/preload contains \`${banned}\``, () => {
      const offenders: string[] = [];
      for (const f of ALL_FILES) {
        const src = stripComments(fs.readFileSync(f, 'utf8'));
        if (src.includes(banned)) {
          offenders.push(f.replace(/\\/g, '/'));
        }
      }
      expect(
        offenders,
        `banned token \`${banned}\` found in: ${offenders.join(', ')}`,
      ).toEqual([]);
    });
  }
});
