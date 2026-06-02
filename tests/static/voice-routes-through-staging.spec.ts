/**
 * Plan 14-03 Task 2 — D-08A/D-09a named voice ratchet (Ratchet A).
 *
 * SC3-phrased ratchet: "the voice handler is not a direct caller of the write
 * modules — voice routes through the same staging the UI uses."
 *
 * Two guarantees:
 *
 *  1. No file under src/main/voice/** imports or calls the three chokepoint
 *     entry points (sendApprovedEmail / applyCalendarChange /
 *     pushApprovedMeetingActions) directly — voice must route through the IPC
 *     staging layer, not bypass it.
 *     This overlaps Ratchet B (chokepoint-caller-allow-list.spec.ts)
 *     intentionally: Ratchet A documents intent at the voice namespace; Ratchet B
 *     closes the hole for ALL of src/main.
 *
 *  2. D-09a banned-literal: no file under src/main/voice/** contains the literal
 *     `approval_path:'explicit'` (with optional whitespace). Voice must write
 *     'voice-explicit' — a value the assertApproved forced-explicit branch
 *     REJECTS for financial/legal/HR actions. A voice 'yes' is NOT a first-class
 *     explicit approval for high-stakes actions.
 *
 * W-1 MISSING-DIR GUARD: src/main/voice/ does not exist until Plan 14-02 ships
 * confirm.ts. Plans 14-02 and 14-03 are both Wave 2 (parallel-eligible). This
 * spec guards with fs.existsSync(VOICE_ROOT) and treats a missing directory as
 * an empty file list (zero offenders). The spec stays green whether voice/ is
 * absent or contains confirm.ts, and fails the moment a future voice file
 * violates either rule.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..', 'src', 'main');
const VOICE_ROOT = path.resolve(ROOT, 'voice');

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
 * The three exported write-module chokepoint entry points.
 * Voice files must never reference these directly.
 */
const CHOKEPOINT_NAMES = [
  'sendApprovedEmail',
  'applyCalendarChange',
  'pushApprovedMeetingActions',
] as const;

describe('SC3 / D-08A — the voice handler is not a direct caller of the write modules — voice routes through the same staging the UI uses', () => {
  it('no file under src/main/voice/** directly calls or imports a chokepoint write entry point', () => {
    const voiceFiles = walk(VOICE_ROOT);
    const offenders: string[] = [];

    for (const f of voiceFiles) {
      const norm = f.replace(/\\/g, '/');
      // Skip test/spec files (they test the production code, not enforce caller discipline).
      if (/\.(test|spec)\.(ts|tsx|mts|cts)$/.test(f)) continue;

      const src = stripComments(fs.readFileSync(f, 'utf8'));

      for (const name of CHOKEPOINT_NAMES) {
        const RE = new RegExp(`(?:^|[^A-Za-z0-9_$])${name}(?:[^A-Za-z0-9_$]|$)`);
        if (RE.test(src)) {
          offenders.push(`${norm} → ${name}`);
        }
      }
    }

    expect(
      offenders,
      `Voice files reference chokepoint write entry points directly — voice must stage through IPC:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it("D-09a: no file under src/main/voice/** contains approval_path:'explicit' (must be 'voice-explicit')", () => {
    const voiceFiles = walk(VOICE_ROOT);
    const offenders: string[] = [];

    // Banned literal: approval_path with optional whitespace around ':', then 'explicit'.
    // Whitespace-tolerant: matches approval_path : 'explicit' and approval_path:'explicit'.
    // Per D-09a, voice confirm MUST write 'voice-explicit' (rejectable by forced-explicit gate).
    const BANNED_RE = /approval_path\s*:\s*['"]explicit['"]/;

    for (const f of voiceFiles) {
      const norm = f.replace(/\\/g, '/');
      if (/\.(test|spec)\.(ts|tsx|mts|cts)$/.test(f)) continue;

      const src = stripComments(fs.readFileSync(f, 'utf8'));
      if (BANNED_RE.test(src)) {
        offenders.push(norm);
      }
    }

    expect(
      offenders,
      `Voice files stamp approval_path:'explicit' — must use 'voice-explicit' so assertApproved can reject for high-severity actions:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });
});
