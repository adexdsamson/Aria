/**
 * D-13 read-only guard — extends the Phase-14 voice-routes-through-staging
 * ratchet to cover Phase 16 streaming modules (src/main/voice/ + src/renderer/features/voice/).
 *
 * Proves the Phase 16 conversational streaming loop (the new surface area)
 * cannot accidentally reach write paths. The voice streaming modules must
 * never import or call write chokepoints:
 *   - assertApproved
 *   - voiceConfirm
 *   - sendApprovedEmail
 *   - applyCalendarChange
 *   - pushApprovedMeetingActions
 *
 * W-1 MISSING-DIR GUARD: src/main/voice/ and src/renderer/features/voice/
 * may not exist in all CI contexts. Each walk() call guards with
 * fs.existsSync(dir) and returns [] if the directory is absent, so the
 * spec stays green even if either dir is absent — and fails the moment
 * a future voice file violates the read-only rule.
 *
 * Structural template: tests/static/voice-routes-through-staging.spec.ts
 * (walk + stripComments + identifier-boundary RE pattern — copied verbatim
 * then adapted for Phase 16 directories and chokepoints).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const MAIN_VOICE_ROOT = path.resolve(__dirname, '../..', 'src', 'main', 'voice');
const RENDERER_VOICE_ROOT = path.resolve(
  __dirname,
  '../..',
  'src',
  'renderer',
  'features',
  'voice',
);

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
 * D-13: Phase 16 extends the Phase-14 chokepoint set with assertApproved
 * and voiceConfirm. Voice streaming modules must call none of these.
 */
const WRITE_CHOKEPOINTS = [
  'sendApprovedEmail',
  'applyCalendarChange',
  'pushApprovedMeetingActions',
  'assertApproved',
  'voiceConfirm',
] as const;

describe('Phase 16 voice streaming modules are read-only (D-13)', () => {
  it('no file under src/main/voice/** or src/renderer/features/voice/** directly calls or imports a write chokepoint', () => {
    const mainFiles = walk(MAIN_VOICE_ROOT);
    const rendererFiles = walk(RENDERER_VOICE_ROOT);
    const allFiles = [...mainFiles, ...rendererFiles];

    const offenders: { file: string; chokepoint: string }[] = [];

    for (const f of allFiles) {
      // Exclude test/spec files — they are allowed to reference chokepoint
      // names in describe/it strings without violating the read-only rule.
      if (/\.(spec|test)\.(ts|tsx|mts|cts)$/.test(f)) continue;

      // Exclude the Phase-14 write-seam implementation itself (confirm.ts
      // exports voiceConfirm — it IS the chokepoint, not a caller of it).
      // The ratchet guards Phase-16 streaming modules that must not CALL these.
      if (/[/\\]voice[/\\]confirm\.ts$/.test(f)) continue;

      const src = stripComments(fs.readFileSync(f, 'utf8'));

      for (const name of WRITE_CHOKEPOINTS) {
        const RE = new RegExp(`(?:^|[^A-Za-z0-9_$])${name}(?:[^A-Za-z0-9_$]|$)`);
        if (RE.test(src)) {
          offenders.push({ file: f.replace(/\\/g, '/'), chokepoint: name });
        }
      }
    }

    expect(
      offenders,
      offenders.map((o) => `${o.file} → ${o.chokepoint}`).join('\n'),
    ).toHaveLength(0);
  });
});
