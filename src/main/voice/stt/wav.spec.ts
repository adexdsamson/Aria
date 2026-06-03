/**
 * Phase 15 / Plan 15-02 Task 1 — TDD specs for the WAV temp-file writer.
 *
 * Verifies:
 *   - writePcmToWav writes a valid RIFF/WAVE header (44 bytes) + PCM body
 *   - header declares 1 channel, 16 kHz, 16-bit with correct data chunk length
 *   - first 4 bytes = 'RIFF', bytes 8-12 = 'WAVE'
 *   - returned path = destPath
 *   - tempWavPath() resolves under os.tmpdir() (NOT app userData)
 *   - spec needs no real audio — pure/deterministic inputs
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Import AFTER file is created (TDD: will fail until wav.ts exists)
import { writePcmToWav, tempWavPath } from './wav';

const TEST_FILES: string[] = [];

afterEach(() => {
  // Clean up any files written by tests
  for (const f of TEST_FILES.splice(0)) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

describe('writePcmToWav', () => {
  it('returns the dest path', () => {
    const destPath = path.join(os.tmpdir(), `aria-wav-test-${Date.now()}-return.wav`);
    TEST_FILES.push(destPath);
    const pcm = new Int16Array(16000); // 1 second of silence at 16 kHz
    const result = writePcmToWav(pcm, 16000, destPath);
    expect(result).toBe(destPath);
  });

  it('writes a file to disk', () => {
    const destPath = path.join(os.tmpdir(), `aria-wav-test-${Date.now()}-exists.wav`);
    TEST_FILES.push(destPath);
    const pcm = new Int16Array(100);
    writePcmToWav(pcm, 16000, destPath);
    expect(fs.existsSync(destPath)).toBe(true);
  });

  it('writes a 44-byte RIFF/WAVE header + PCM body (correct total size)', () => {
    const destPath = path.join(os.tmpdir(), `aria-wav-test-${Date.now()}-size.wav`);
    TEST_FILES.push(destPath);
    const sampleCount = 160; // 10ms at 16 kHz
    const pcm = new Int16Array(sampleCount);
    writePcmToWav(pcm, 16000, destPath);

    const buf = fs.readFileSync(destPath);
    // Total = 44 header bytes + 2 bytes per sample
    expect(buf.length).toBe(44 + sampleCount * 2);
  });

  it('starts with RIFF magic', () => {
    const destPath = path.join(os.tmpdir(), `aria-wav-test-${Date.now()}-magic.wav`);
    TEST_FILES.push(destPath);
    const pcm = new Int16Array(100);
    writePcmToWav(pcm, 16000, destPath);

    const buf = fs.readFileSync(destPath);
    expect(buf.subarray(0, 4).toString('ascii')).toBe('RIFF');
  });

  it('has WAVE at bytes 8-12', () => {
    const destPath = path.join(os.tmpdir(), `aria-wav-test-${Date.now()}-wave.wav`);
    TEST_FILES.push(destPath);
    const pcm = new Int16Array(100);
    writePcmToWav(pcm, 16000, destPath);

    const buf = fs.readFileSync(destPath);
    expect(buf.subarray(8, 12).toString('ascii')).toBe('WAVE');
  });

  it('declares 1 channel (mono) in the fmt chunk', () => {
    const destPath = path.join(os.tmpdir(), `aria-wav-test-${Date.now()}-mono.wav`);
    TEST_FILES.push(destPath);
    const pcm = new Int16Array(100);
    writePcmToWav(pcm, 16000, destPath);

    const buf = fs.readFileSync(destPath);
    // numChannels at offset 22, uint16 LE
    const numChannels = buf.readUInt16LE(22);
    expect(numChannels).toBe(1);
  });

  it('declares 16000 Hz sample rate in the fmt chunk', () => {
    const destPath = path.join(os.tmpdir(), `aria-wav-test-${Date.now()}-samplerate.wav`);
    TEST_FILES.push(destPath);
    const pcm = new Int16Array(100);
    writePcmToWav(pcm, 16000, destPath);

    const buf = fs.readFileSync(destPath);
    // sampleRate at offset 24, uint32 LE
    const sampleRate = buf.readUInt32LE(24);
    expect(sampleRate).toBe(16000);
  });

  it('declares 16-bit depth (bitsPerSample = 16)', () => {
    const destPath = path.join(os.tmpdir(), `aria-wav-test-${Date.now()}-bitdepth.wav`);
    TEST_FILES.push(destPath);
    const pcm = new Int16Array(100);
    writePcmToWav(pcm, 16000, destPath);

    const buf = fs.readFileSync(destPath);
    // bitsPerSample at offset 34, uint16 LE
    const bitsPerSample = buf.readUInt16LE(34);
    expect(bitsPerSample).toBe(16);
  });

  it('data chunk length = sampleCount * 2 (byte-accurate)', () => {
    const destPath = path.join(os.tmpdir(), `aria-wav-test-${Date.now()}-datalen.wav`);
    TEST_FILES.push(destPath);
    const sampleCount = 3200; // 200ms at 16 kHz
    const pcm = new Int16Array(sampleCount);
    writePcmToWav(pcm, 16000, destPath);

    const buf = fs.readFileSync(destPath);
    // data chunk size at offset 40, uint32 LE
    const dataChunkSize = buf.readUInt32LE(40);
    expect(dataChunkSize).toBe(sampleCount * 2);
  });

  it('writes the PCM samples verbatim after the header (little-endian)', () => {
    const destPath = path.join(os.tmpdir(), `aria-wav-test-${Date.now()}-samples.wav`);
    TEST_FILES.push(destPath);
    // Known values: 1000, -500, 32767 (max), -32768 (min)
    const pcm = new Int16Array([1000, -500, 32767, -32768]);
    writePcmToWav(pcm, 16000, destPath);

    const buf = fs.readFileSync(destPath);
    expect(buf.readInt16LE(44)).toBe(1000);
    expect(buf.readInt16LE(46)).toBe(-500);
    expect(buf.readInt16LE(48)).toBe(32767);
    expect(buf.readInt16LE(50)).toBe(-32768);
  });

  it('works with a custom sample rate', () => {
    const destPath = path.join(os.tmpdir(), `aria-wav-test-${Date.now()}-customrate.wav`);
    TEST_FILES.push(destPath);
    const pcm = new Int16Array(8000);
    writePcmToWav(pcm, 8000, destPath);

    const buf = fs.readFileSync(destPath);
    const sampleRate = buf.readUInt32LE(24);
    expect(sampleRate).toBe(8000);
  });
});

describe('tempWavPath', () => {
  it('returns a path under os.tmpdir()', () => {
    const p = tempWavPath();
    const tmpDir = os.tmpdir();
    // Normalize separators for cross-platform comparison
    const normalP = p.replace(/\\/g, '/');
    const normalTmp = tmpDir.replace(/\\/g, '/');
    expect(normalP.startsWith(normalTmp)).toBe(true);
  });

  it('returns a path ending in .wav', () => {
    const p = tempWavPath();
    expect(p.endsWith('.wav')).toBe(true);
  });

  it('includes aria-voice in the filename', () => {
    const p = tempWavPath();
    expect(path.basename(p)).toMatch(/aria-voice/);
  });

  it('returns a different path on each call (uses random)', () => {
    const p1 = tempWavPath();
    const p2 = tempWavPath();
    expect(p1).not.toBe(p2);
  });
});
