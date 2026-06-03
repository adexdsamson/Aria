/**
 * Phase 15 / Plan 15-01 Task 3 — No-cloud-audio static ratchet (VOICE-04).
 *
 * VOICE-04: "On-device by default — no audio leaves the machine."
 *
 * This spec walks src/main/voice/** and src/renderer/features/voice/** and
 * asserts that no production file references a known cloud STT/TTS endpoint
 * literal. If any file tries to call a cloud audio API, this test fails —
 * ensuring VOICE-04 is enforced by construction.
 *
 * W-1 MISSING-DIR GUARD: Both voice directories may not exist yet (voice
 * feature is built incrementally across waves). Absent directories are treated
 * as an empty file list — the spec stays green whether the dirs exist or not,
 * and fails the moment a future voice file violates VOICE-04.
 *
 * Cloud endpoint literals checked (case-insensitive after comment stripping):
 *   - api.openai.com/v1/audio  (OpenAI STT/TTS)
 *   - /audio/transcriptions    (OpenAI Whisper API path)
 *   - /audio/speech            (OpenAI TTS API path)
 *   - deepgram                 (Deepgram STT)
 *   - elevenlabs               (ElevenLabs TTS)
 *   - assemblyai               (AssemblyAI STT)
 *   - rev.ai                   (Rev.ai STT)
 *   - speechmatics             (Speechmatics STT)
 *
 * (Exact same walk/stripComments/missing-dir-guard skeleton as
 *  tests/static/voice-routes-through-staging.spec.ts.)
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const MAIN_VOICE_ROOT = path.resolve(__dirname, '../../src/main/voice');
const RENDERER_VOICE_ROOT = path.resolve(
  __dirname,
  '../../src/renderer/features/voice',
);

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out; // W-1: missing-dir guard
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && /\.(ts|tsx|mts|cts)$/.test(entry.name))
      out.push(full);
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
 * Cloud audio endpoint literal patterns.
 * These are checked case-insensitively against comment-stripped source.
 */
const CLOUD_AUDIO_PATTERNS = [
  /api\.openai\.com\/v1\/audio/i,
  /\/audio\/transcriptions/i,
  /\/audio\/speech/i,
  /\bdeepgram\b/i,
  /\belevenlabs\b/i,
  /\bassemblyai\b/i,
  /\brev\.ai\b/i,
  /\bspeechmatics\b/i,
] as const;

describe('VOICE-04 — no voice file references a cloud STT/TTS endpoint (on-device by default)', () => {
  it('no file under src/main/voice/** references a cloud audio endpoint literal', () => {
    const voiceFiles = walk(MAIN_VOICE_ROOT);
    const offenders: string[] = [];

    for (const f of voiceFiles) {
      // Skip test/spec files — they may document cloud endpoints in assertions.
      if (/\.(test|spec)\.(ts|tsx|mts|cts)$/.test(f)) continue;

      const stripped = stripComments(fs.readFileSync(f, 'utf8'));
      const norm = f.replace(/\\/g, '/');

      for (const pattern of CLOUD_AUDIO_PATTERNS) {
        if (pattern.test(stripped)) {
          offenders.push(`${norm} → ${pattern.source}`);
        }
      }
    }

    expect(
      offenders,
      `Voice files (src/main/voice) reference cloud STT/TTS endpoints — VOICE-04 requires on-device by default:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('no file under src/renderer/features/voice/** references a cloud audio endpoint literal', () => {
    const voiceFiles = walk(RENDERER_VOICE_ROOT);
    const offenders: string[] = [];

    for (const f of voiceFiles) {
      // Skip test/spec files.
      if (/\.(test|spec)\.(ts|tsx|mts|cts)$/.test(f)) continue;

      const stripped = stripComments(fs.readFileSync(f, 'utf8'));
      const norm = f.replace(/\\/g, '/');

      for (const pattern of CLOUD_AUDIO_PATTERNS) {
        if (pattern.test(stripped)) {
          offenders.push(`${norm} → ${pattern.source}`);
        }
      }
    }

    expect(
      offenders,
      `Voice files (src/renderer/features/voice) reference cloud STT/TTS endpoints — VOICE-04 requires on-device by default:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });
});
