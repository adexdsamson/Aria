/**
 * Phase 15 / Plan 15-02 Task 1 — 16-bit PCM → WAV temp-file writer.
 *
 * Synthesizes a canonical 44-byte RIFF/WAVE PCM header (mono, 16-bit,
 * configurable sample rate) followed by little-endian Int16 PCM samples.
 * Written with node:fs — no ffmpeg dependency required.
 *
 * Threat model T-15-04: temp WAV files are written to os.tmpdir() ONLY
 * (NOT app userData / userData). The caller is responsible for cleanup
 * (sidecar-manager.ts wraps calls in try/finally).
 *
 * No native addon — this file is pure Node.js / stdlib. Live under
 * src/main/voice/** so the voice-routes-through-staging ratchet applies.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

/**
 * Build an os.tmpdir()-based path for a temporary WAV file.
 * Uses crypto.randomBytes for uniqueness — two calls always produce
 * different paths so concurrent transcriptions don't collide.
 *
 * Format: aria-voice-<8 hex chars>.wav
 */
export function tempWavPath(): string {
  const rand = crypto.randomBytes(4).toString('hex');
  return path.join(os.tmpdir(), `aria-voice-${rand}.wav`);
}

/**
 * Write `pcm` (Int16Array of mono 16-bit samples at `sampleRate` Hz) to
 * `destPath` as a valid RIFF/WAVE PCM file.
 *
 * The header is exactly 44 bytes:
 *   [0-3]   'RIFF'
 *   [4-7]   file size - 8  (uint32 LE)
 *   [8-11]  'WAVE'
 *   [12-15] 'fmt '
 *   [16-19] 16  (fmt chunk size, uint32 LE)
 *   [20-21] 1   (PCM format, uint16 LE)
 *   [22-23] 1   (numChannels = mono, uint16 LE)
 *   [24-27] sampleRate (uint32 LE)
 *   [28-31] byteRate = sampleRate * 1 * 2 (uint32 LE)
 *   [32-33] blockAlign = 1 * 2 = 2 (uint16 LE)
 *   [34-35] 16 (bitsPerSample, uint16 LE)
 *   [36-39] 'data'
 *   [40-43] dataChunkSize = pcm.length * 2 (uint32 LE)
 *   [44...) PCM samples as little-endian Int16
 *
 * Returns `destPath` so callers can chain: `const p = writePcmToWav(...)`.
 */
export function writePcmToWav(
  pcm: Int16Array,
  sampleRate: number,
  destPath: string,
): string {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8; // 2
  const dataSize = pcm.length * bytesPerSample;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buf = Buffer.alloc(totalSize);

  // RIFF chunk descriptor
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(totalSize - 8, 4);     // fileSize - 8
  buf.write('WAVE', 8, 'ascii');

  // fmt sub-chunk
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);               // fmt chunk size = 16
  buf.writeUInt16LE(1, 20);               // audio format = PCM (1)
  buf.writeUInt16LE(numChannels, 22);      // numChannels = 1 (mono)
  buf.writeUInt32LE(sampleRate, 24);       // sampleRate
  buf.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28); // byteRate
  buf.writeUInt16LE(numChannels * bytesPerSample, 32); // blockAlign = 2
  buf.writeUInt16LE(bitsPerSample, 34);    // bitsPerSample = 16

  // data sub-chunk
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);         // data chunk size

  // PCM samples — copy as little-endian Int16
  for (let i = 0; i < pcm.length; i++) {
    buf.writeInt16LE(pcm[i], headerSize + i * bytesPerSample);
  }

  fs.writeFileSync(destPath, buf);
  return destPath;
}
