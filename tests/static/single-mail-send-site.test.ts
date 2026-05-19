/**
 * Plan 05-02 Task 2a - provider mail send call-site ratchet.
 *
 * The generalized send chokepoint is the only place in src/main that may call
 * `provider.mail.sendMessage(...)`. SDK wire sends are limited to the unified
 * send chokepoint's Gmail test-injection path and provider wrappers.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..', 'src', 'main');
const ALLOWED_CHOKEPOINT = path
  .resolve(__dirname, '../..', 'src/main/integrations/send.ts')
  .replace(/\\/g, '/');
const ALLOWED_GOOGLE_PROVIDER = path
  .resolve(__dirname, '../..', 'src/main/integrations/google/provider-adapter.ts')
  .replace(/\\/g, '/');
const ALLOWED_MICROSOFT_WRAPPER = path
  .resolve(__dirname, '../..', 'src/main/integrations/microsoft/mail.ts')
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

function stripLineComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

const PROVIDER_SEND_RE = /provider\s*\.\s*mail\s*\.\s*sendMessage\s*\(/;
const GMAIL_SEND_RE = /[A-Za-z_$][\w$]*\s*\.\s*users\s*\.\s*messages\s*\.\s*send\s*\(/;
const GRAPH_SEND_RE = /client(?:\.graph)?\.api\(\s*(?:['"]\/me\/sendMail['"]|`[^`]*\/me\/sendMail`)\s*\)\s*\.\s*post\s*\(/;

describe('provider mail send-site enforcer', () => {
  it('every provider.mail.sendMessage call site is inside the unified send chokepoint', () => {
    const files = walk(ROOT);
    const matches: string[] = [];
    for (const f of files) {
      const src = stripLineComments(fs.readFileSync(f, 'utf8'));
      if (PROVIDER_SEND_RE.test(src)) {
        matches.push(f.replace(/\\/g, '/'));
      }
    }
    const offenders = matches.filter((m) => m !== ALLOWED_CHOKEPOINT);
    expect(offenders, `offending provider.mail.sendMessage call sites: ${offenders.join(', ')}`).toEqual([]);
    expect(matches).toContain(ALLOWED_CHOKEPOINT);
  });

  it('every Gmail SDK send call site is inside the unified chokepoint or Google provider wrapper', () => {
    const files = walk(ROOT);
    const matches: string[] = [];
    for (const f of files) {
      const src = stripLineComments(fs.readFileSync(f, 'utf8'));
      if (GMAIL_SEND_RE.test(src)) {
        matches.push(f.replace(/\\/g, '/'));
      }
    }
    const allowed = new Set([ALLOWED_CHOKEPOINT, ALLOWED_GOOGLE_PROVIDER]);
    const offenders = matches.filter((m) => !allowed.has(m));
    expect(offenders, `offending Gmail SDK send call sites: ${offenders.join(', ')}`).toEqual([]);
    expect(matches).toContain(ALLOWED_CHOKEPOINT);
    expect(matches).toContain(ALLOWED_GOOGLE_PROVIDER);
  });

  it('every Microsoft Graph sendMail call site is inside the Microsoft mail wrapper', () => {
    const files = walk(ROOT);
    const matches: string[] = [];
    for (const f of files) {
      const src = stripLineComments(fs.readFileSync(f, 'utf8'));
      if (GRAPH_SEND_RE.test(src)) {
        matches.push(f.replace(/\\/g, '/'));
      }
    }
    const offenders = matches.filter((m) => m !== ALLOWED_MICROSOFT_WRAPPER);
    expect(offenders, `offending Graph sendMail call sites: ${offenders.join(', ')}`).toEqual([]);
    expect(matches).toContain(ALLOWED_MICROSOFT_WRAPPER);
  });
});
