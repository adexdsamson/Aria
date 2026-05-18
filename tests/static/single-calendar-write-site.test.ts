/**
 * Plan 04-01 — APPR-02 static-grep ratchet.
 *
 * The Calendar Node SDK write surfaces are `calendar.events.patch(...)` and
 * `calendar.events.insert(...)`. Aria MUST keep these calls confined to a
 * pair of files:
 *   - src/main/integrations/google/calendar.ts        — the thin wrapper
 *   - src/main/integrations/google/write-event.ts     — the approval chokepoint
 *
 * The chokepoint enforces assertApproved at the function boundary; the
 * wrapper is allow-listed because it is the only file the chokepoint calls
 * into. CI fails if a third file adds a literal events.patch / events.insert
 * call site (T-04-01-01 / Pitfall 9).
 *
 * Secondary regex: defense-in-depth check that `sendUpdates: 'all'` (or
 * `sendUpdates="all"`) NEVER appears in write-event.ts. Plan 04 v1 is
 * self-only — silent notifications to attendees would violate T-04-01-08.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..', 'src', 'main');
const ALLOWED_WRAPPER = path
  .resolve(__dirname, '../..', 'src/main/integrations/google/calendar.ts')
  .replace(/\\/g, '/');
const ALLOWED_CHOKEPOINT = path
  .resolve(__dirname, '../..', 'src/main/integrations/google/write-event.ts')
  .replace(/\\/g, '/');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && /\.(ts|js|tsx|mts|cts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

// Strip line AND block comments BEFORE matching so documentation that names
// the symbol (e.g. this very file when copied around, or the chokepoint's
// own header docblock that references the forbidden literal) doesn't trip
// the grep.
function stripLineComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

const PATCH_RE = /[A-Za-z_$][\w$]*\s*\.\s*events\s*\.\s*patch\s*\(/;
const INSERT_RE = /[A-Za-z_$][\w$]*\s*\.\s*events\s*\.\s*insert\s*\(/;
const SEND_UPDATES_ALL_RE = /sendUpdates\s*[:=]\s*['"]all['"]/;

describe('APPR-02 single calendar-write call-site enforcer', () => {
  it('every events.patch call site is inside the allowed files', () => {
    const files = walk(ROOT);
    const matches: string[] = [];
    for (const f of files) {
      const src = stripLineComments(fs.readFileSync(f, 'utf8'));
      if (PATCH_RE.test(src)) {
        matches.push(f.replace(/\\/g, '/'));
      }
    }
    const allowed = new Set([ALLOWED_WRAPPER, ALLOWED_CHOKEPOINT]);
    const offenders = matches.filter((m) => !allowed.has(m));
    expect(offenders, `offending events.patch call sites: ${offenders.join(', ')}`).toEqual([]);
    // Wrapper file must contain the literal; chokepoint goes through wrapper
    // and therefore does NOT need a direct events.patch literal.
    expect(matches).toContain(ALLOWED_WRAPPER);
  });

  it('every events.insert call site is inside the allowed files', () => {
    const files = walk(ROOT);
    const matches: string[] = [];
    for (const f of files) {
      const src = stripLineComments(fs.readFileSync(f, 'utf8'));
      if (INSERT_RE.test(src)) {
        matches.push(f.replace(/\\/g, '/'));
      }
    }
    const allowed = new Set([ALLOWED_WRAPPER, ALLOWED_CHOKEPOINT]);
    const offenders = matches.filter((m) => !allowed.has(m));
    expect(offenders, `offending events.insert call sites: ${offenders.join(', ')}`).toEqual([]);
    expect(matches).toContain(ALLOWED_WRAPPER);
  });

  it("write-event.ts NEVER contains a 'sendUpdates: all' literal (T-04-01-08)", () => {
    const src = stripLineComments(fs.readFileSync(ALLOWED_CHOKEPOINT, 'utf8'));
    expect(
      SEND_UPDATES_ALL_RE.test(src),
      "write-event.ts must not propagate 'sendUpdates: all' — Phase 4 v1 is self-only",
    ).toBe(false);
  });

  it('write-event.ts calls assertApproved (chokepoint is gated)', () => {
    const src = fs.readFileSync(ALLOWED_CHOKEPOINT, 'utf8');
    expect(/assertApproved\s*\(\s*db\s*,\s*approvalId\s*\)/.test(src)).toBe(true);
  });
});
