/**
 * Plan 03-01 — APPR-01 static grep enforcer.
 *
 * The Gmail Node SDK send is `gmail.users.messages.send(...)`. Aria MUST have
 * exactly ZERO or ONE call site for this method, and when present that file
 * MUST be `src/main/integrations/google/send.ts` (created in Plan 03-04). At
 * Plan 03-01 commit time, the file does not yet exist — zero matches is the
 * expected pass condition. The static-grep watcher is the safety belt that
 * stops future plans from sneaking in a bypass.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..', 'src', 'main');
const ALLOWED = path
  .resolve(__dirname, '../..', 'src/main/integrations/google/send.ts')
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

// Matches `<x>.users.messages.send(` with arbitrary whitespace. Stripping
// line comments BEFORE matching keeps documentation in this very file (which
// names the symbol) from tripping the grep.
const SEND_RE = /[A-Za-z_$][\w$]*\s*\.\s*users\s*\.\s*messages\s*\.\s*send\s*\(/;

function stripLineComments(src: string): string {
  return src.replace(/\/\/[^\n]*/g, '');
}

describe('APPR-01 single send call-site enforcer', () => {
  it('every Gmail send call site is inside the allowed gate file', () => {
    const files = walk(ROOT);
    const matches: string[] = [];
    for (const f of files) {
      const src = stripLineComments(fs.readFileSync(f, 'utf8'));
      if (SEND_RE.test(src)) {
        matches.push(f.replace(/\\/g, '/'));
      }
    }
    const allowed = new Set([ALLOWED]);
    const offenders = matches.filter((m) => !allowed.has(m));
    expect(offenders, `offending call sites: ${offenders.join(', ')}`).toEqual([]);
    expect(
      matches.length,
      `unexpected match count: ${matches.length}; matches=${matches.join(', ')}`,
    ).toBeLessThanOrEqual(1);
  });
});
