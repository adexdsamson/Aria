/**
 * WA-11 / Gates 1 & 2 — Passive-posture static-grep ratchet.
 *
 * Walks src/main/whatsapp and asserts ZERO occurrences of any outbound-send
 * call: sendMessage, sendReceipt, readMessages, and any sendPresenceUpdate
 * call where the argument is NOT 'unavailable' (the only permitted presence
 * state per the locked passive-posture decision).
 *
 * Also asserts the makeWASocket config literal (once session-manager.ts exists)
 * contains the three passive-posture flags:
 *   markOnlineOnConnect: false
 *   emitOwnEvents: false
 *   syncFullHistory: false  (D-13)
 *
 * MISSING-DIR GUARD (W-1): src/main/whatsapp/ may not exist until Plan 20-04.
 * Each walk() call returns [] when the directory is absent, so this spec
 * stays GREEN before the directory is created — and turns load-bearing the
 * moment any source file appears there.
 *
 * Template: tests/static/voice-streaming-no-write.spec.ts (walk + stripComments
 * + identifier-boundary RE pattern — copied and adapted for this directory).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const WHATSAPP_ROOT = path.resolve(__dirname, '../../../..', 'src', 'main', 'whatsapp');

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out; // W-1: missing-dir guard
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && /\.(ts|tsx|mts|cts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Block comments first, then line comments — order matters. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

/**
 * Banned send-path identifiers (Gates 1 & 2, WA-11).
 *
 * sendPresenceUpdate has a carve-out: the ONE allowed call is
 *   sock.sendPresenceUpdate('unavailable')
 * Any presence call with a different argument is banned.
 */
const BANNED_SIMPLE = ['sendMessage', 'sendReceipt', 'readMessages'] as const;

/**
 * Regex for sendPresenceUpdate calls that do NOT pass 'unavailable'.
 * Matches: .sendPresenceUpdate( followed by anything that is NOT 'unavailable'
 * before the closing paren.
 */
const BANNED_PRESENCE_RE =
  /\.sendPresenceUpdate\(\s*(?!'unavailable'|"unavailable"|`unavailable`)/;

describe('WA-11 passive-posture ratchet — src/main/whatsapp must never call send/receipt/readMessages/non-unavailable-presence', () => {
  const files = walk(WHATSAPP_ROOT);

  it('directory scan returns a list (empty when dir absent — W-1 guard)', () => {
    // Always passes: [] is valid when the directory does not yet exist.
    expect(Array.isArray(files)).toBe(true);
  });

  it('no file calls .sendMessage()', () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (/\.(spec|test)\.(ts|tsx|mts|cts)$/.test(f)) continue;
      const src = stripComments(fs.readFileSync(f, 'utf8'));
      const RE = /(?:^|[^A-Za-z0-9_$])sendMessage(?:[^A-Za-z0-9_$]|$)/;
      if (RE.test(src)) offenders.push(f.replace(/\\/g, '/'));
    }
    expect(offenders, offenders.join('\n')).toHaveLength(0);
  });

  it('no file calls .sendReceipt()', () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (/\.(spec|test)\.(ts|tsx|mts|cts)$/.test(f)) continue;
      const src = stripComments(fs.readFileSync(f, 'utf8'));
      const RE = /(?:^|[^A-Za-z0-9_$])sendReceipt(?:[^A-Za-z0-9_$]|$)/;
      if (RE.test(src)) offenders.push(f.replace(/\\/g, '/'));
    }
    expect(offenders, offenders.join('\n')).toHaveLength(0);
  });

  it('no file calls .readMessages()', () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (/\.(spec|test)\.(ts|tsx|mts|cts)$/.test(f)) continue;
      const src = stripComments(fs.readFileSync(f, 'utf8'));
      const RE = /(?:^|[^A-Za-z0-9_$])readMessages(?:[^A-Za-z0-9_$]|$)/;
      if (RE.test(src)) offenders.push(f.replace(/\\/g, '/'));
    }
    expect(offenders, offenders.join('\n')).toHaveLength(0);
  });

  it("no file calls sendPresenceUpdate with an argument other than 'unavailable'", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (/\.(spec|test)\.(ts|tsx|mts|cts)$/.test(f)) continue;
      const src = stripComments(fs.readFileSync(f, 'utf8'));
      if (BANNED_PRESENCE_RE.test(src)) offenders.push(f.replace(/\\/g, '/'));
    }
    expect(offenders, offenders.join('\n')).toHaveLength(0);
  });
});

describe('WA-11 makeWASocket passive-posture config flags (inert until session-manager.ts exists)', () => {
  const sessionManagerPath = path.join(WHATSAPP_ROOT, 'session-manager.ts');

  it('session-manager.ts contains markOnlineOnConnect: false (once Plan 20-04 lands)', () => {
    if (!fs.existsSync(sessionManagerPath)) return; // guard: inert until file exists
    const src = stripComments(fs.readFileSync(sessionManagerPath, 'utf8'));
    expect(src).toMatch(/markOnlineOnConnect\s*:\s*false/);
  });

  it('session-manager.ts contains emitOwnEvents: false (once Plan 20-04 lands)', () => {
    if (!fs.existsSync(sessionManagerPath)) return; // guard: inert until file exists
    const src = stripComments(fs.readFileSync(sessionManagerPath, 'utf8'));
    expect(src).toMatch(/emitOwnEvents\s*:\s*false/);
  });

  it('session-manager.ts contains syncFullHistory: false — D-13 (once Plan 20-04 lands)', () => {
    if (!fs.existsSync(sessionManagerPath)) return; // guard: inert until file exists
    const src = stripComments(fs.readFileSync(sessionManagerPath, 'utf8'));
    expect(src).toMatch(/syncFullHistory\s*:\s*false/);
  });
});
