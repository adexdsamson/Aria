/**
 * D-13/D-17 write-path guard — extends the Phase-14 voice-routes-through-staging
 * ratchet to cover Phase 16 streaming modules and Phase 17 write-capable modules
 * (src/main/voice/ + src/renderer/features/voice/).
 *
 * Phase 16 proved the streaming loop cannot accidentally reach write paths.
 * Phase 17 makes voice write-capable: voice intent is routed through voiceConfirm
 * (the allowed seam, called from ipc/voice.ts which is OUTSIDE the scan scope).
 * Voice modules themselves must still never import raw write chokepoints.
 *
 * D-17 boundary: voiceConfirm is intentionally NOT banned here (Phase 17 D-17):
 * it is the approved voice seam, called from ipc/voice.ts which is OUTSIDE the
 * scan scope (src/main/voice/**). The raw write chokepoints below remain banned
 * from all voice modules.
 *
 * W-1 MISSING-DIR GUARD: src/main/voice/ and src/renderer/features/voice/
 * may not exist in all CI contexts. Each walk() call guards with
 * fs.existsSync(dir) and returns [] if the directory is absent, so the
 * spec stays green even if either dir is absent — and fails the moment
 * a future voice file violates the no-raw-write-chokepoint rule.
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
 * D-13/D-17: Voice modules stage approvals via voiceConfirm (allowed, called from
 * ipc/voice.ts outside scan scope) but must never directly call raw write
 * chokepoints. voiceConfirm is intentionally NOT in this list (D-17).
 */
const WRITE_CHOKEPOINTS = [
  'sendApprovedEmail',
  'applyCalendarChange',
  'pushApprovedMeetingActions',
  'assertApproved',
  // 'voiceConfirm' intentionally omitted — Phase 17 D-17: voiceConfirm is the
  // approved voice seam. It is called from ipc/voice.ts (outside scan scope),
  // so voice modules may route THROUGH it but must not import raw chokepoints.
] as const;

describe('Phase 17 voice modules stage approvals via voiceConfirm (allowed) but must never directly call raw write chokepoints', () => {
  it('no file under src/main/voice/** or src/renderer/features/voice/** directly calls or imports a raw write chokepoint', () => {
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
