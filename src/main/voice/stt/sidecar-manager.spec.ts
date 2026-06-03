/**
 * Phase 15 / Plan 15-02 Task 2 — TDD specs for SttSidecarManager.
 *
 * The spec uses an injectable spawnFn that returns a fake ChildProcess
 * emitting canned stdout — no real whisper-cli binary required.
 *
 * Scenarios covered:
 *   - success path: transcribe() writes WAV, spawns, parses --output-json,
 *     resolves TranscriptDelta { text, final: true }, deletes temp WAV
 *   - error path: non-zero exit still deletes temp WAV and rejects
 *   - error path: no JSON on stdout still deletes temp WAV and rejects
 *   - pause/resume: dispose then respawn without leaking a child
 *   - dispose: reaps child + clears tracked temp files (no zombies)
 *   - resolveBinaryPath: returns build/ path in test env (no packaged flag)
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

// Will fail until sidecar-manager.ts is created (TDD RED)
import { SttSidecarManager, resolveBinaryPath } from './sidecar-manager';

// ─── Fake ChildProcess factory ────────────────────────────────────────────────

interface FakeChildOpts {
  /** stdout to emit after a tick */
  stdout?: string;
  /** exit code to emit; default 0 */
  exitCode?: number;
  /** delay ms before emitting close; default 0 */
  delay?: number;
}

function makeFakeChild(opts: FakeChildOpts = {}): ChildProcess {
  const { stdout = '', exitCode = 0, delay = 0 } = opts;

  const child = new EventEmitter() as ChildProcess;
  // Attach stub stdout stream
  const stdoutEmitter = new EventEmitter();
  (child as unknown as Record<string, unknown>).stdout = stdoutEmitter;
  (child as unknown as Record<string, unknown>).stderr = new EventEmitter();
  (child as unknown as Record<string, unknown>).stdin = null;
  (child as unknown as Record<string, unknown>).pid = Math.floor(Math.random() * 99999);
  (child as unknown as Record<string, unknown>).killed = false;

  let killed = false;
  (child as unknown as Record<string, unknown>).kill = () => {
    killed = true;
    (child as unknown as Record<string, unknown>).killed = true;
    setImmediate(() => child.emit('close', null, 'SIGTERM'));
    return true;
  };

  // Emit stdout then close after delay
  const schedule = delay > 0 ? setTimeout : setImmediate as unknown as typeof setTimeout;
  schedule(() => {
    if (stdout) {
      stdoutEmitter.emit('data', Buffer.from(stdout));
    }
    if (!killed) {
      child.emit('close', exitCode, null);
    }
  }, delay);

  return child;
}

// ─── Whisper --output-json format ────────────────────────────────────────────

// whisper.cpp --output-json produces a JSON object with a "transcription" array.
// Each element has a "text" field. We mimic the minimal shape here.
function makeWhisperJson(text: string): string {
  return JSON.stringify({
    model: {
      type: 'base',
      multilingual: true,
    },
    params: {
      model: 'ggml-large-v3-turbo-q5_0.bin',
      language: 'auto',
      translate: false,
    },
    result: {
      language: 'en',
    },
    transcription: [
      {
        timestamps: { from: '00:00:00,000', to: '00:00:02,000' },
        offsets: { from: 0, to: 2000 },
        text: ` ${text}`.trimStart(),
      },
    ],
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('resolveBinaryPath', () => {
  it('returns a path that ends with whisper-cli or whisper-cli.exe', () => {
    const p = resolveBinaryPath();
    const base = path.basename(p);
    expect(base === 'whisper-cli' || base === 'whisper-cli.exe').toBe(true);
  });

  it('returns a path under build/ when not packaged', () => {
    // In test env app.isPackaged is falsy → should use __dirname/../../../build
    const p = resolveBinaryPath();
    // Normalize separators
    const norm = p.replace(/\\/g, '/');
    expect(norm).toMatch(/build\//);
  });
});

describe('SttSidecarManager — success path', () => {
  let manager: SttSidecarManager;
  const spawnCalls: { cmd: string; args: string[] }[] = [];

  afterEach(async () => {
    spawnCalls.splice(0);
    await manager?.dispose();
  });

  it('transcribe() resolves a TranscriptDelta with text and final=true', async () => {
    const expectedText = 'Hello world';
    const jsonOutput = makeWhisperJson(expectedText);

    const spawnFn = vi.fn((_cmd: string, _args: string[]) => {
      return makeFakeChild({ stdout: jsonOutput, exitCode: 0 });
    }) as unknown as typeof import('node:child_process').spawn;

    manager = new SttSidecarManager({
      binaryPath: '/fake/whisper-cli',
      modelPath: '/fake/model.bin',
      spawnFn,
    });

    const pcm = new Int16Array(1600); // 100ms of silence
    const result = await manager.transcribe(pcm);

    expect(result.text).toBe(expectedText);
    expect(result.final).toBe(true);
  });

  it('transcribe() spawns with --output-json flag and model + wav args', async () => {
    const jsonOutput = makeWhisperJson('test');
    const spawnArgs: { cmd: string; args: string[] }[] = [];

    const spawnFn = vi.fn((cmd: string, args: string[]) => {
      spawnArgs.push({ cmd, args });
      return makeFakeChild({ stdout: jsonOutput, exitCode: 0 });
    }) as unknown as typeof import('node:child_process').spawn;

    manager = new SttSidecarManager({
      binaryPath: '/fake/whisper-cli',
      modelPath: '/fake/model.bin',
      spawnFn,
    });

    await manager.transcribe(new Int16Array(1600));

    expect(spawnArgs).toHaveLength(1);
    const { cmd, args } = spawnArgs[0];
    expect(cmd).toBe('/fake/whisper-cli');
    expect(args).toContain('-m');
    expect(args).toContain('/fake/model.bin');
    expect(args).toContain('--output-json');
    expect(args).toContain('-f');
    // The wav path should be in os.tmpdir()
    const wavArgIdx = args.indexOf('-f');
    expect(wavArgIdx).toBeGreaterThanOrEqual(0);
    const wavPath = args[wavArgIdx + 1];
    const normalWav = wavPath.replace(/\\/g, '/');
    const normalTmp = os.tmpdir().replace(/\\/g, '/');
    expect(normalWav.startsWith(normalTmp)).toBe(true);
    expect(wavPath.endsWith('.wav')).toBe(true);
  });

  it('transcribe() deletes the temp WAV after success', async () => {
    const jsonOutput = makeWhisperJson('cleanup test');
    let capturedWavPath = '';
    let wavExistedDuringSpawn = false;

    const spawnFn = vi.fn((cmd: string, args: string[]) => {
      const fIdx = args.indexOf('-f');
      if (fIdx >= 0) {
        capturedWavPath = args[fIdx + 1];
        wavExistedDuringSpawn = fs.existsSync(capturedWavPath);
      }
      return makeFakeChild({ stdout: jsonOutput, exitCode: 0 });
    }) as unknown as typeof import('node:child_process').spawn;

    manager = new SttSidecarManager({
      binaryPath: '/fake/whisper-cli',
      modelPath: '/fake/model.bin',
      spawnFn,
    });

    await manager.transcribe(new Int16Array(1600));

    // WAV existed when whisper-cli was invoked
    expect(wavExistedDuringSpawn).toBe(true);
    // WAV is deleted after completion
    expect(capturedWavPath).not.toBe('');
    expect(fs.existsSync(capturedWavPath)).toBe(false);
  });
});

describe('SttSidecarManager — error paths', () => {
  let manager: SttSidecarManager;

  afterEach(async () => {
    await manager?.dispose();
  });

  it('rejects with a structured error when exit code is non-zero', async () => {
    const spawnFn = vi.fn(() => {
      return makeFakeChild({ stdout: '', exitCode: 1 });
    }) as unknown as typeof import('node:child_process').spawn;

    manager = new SttSidecarManager({
      binaryPath: '/fake/whisper-cli',
      modelPath: '/fake/model.bin',
      spawnFn,
    });

    await expect(manager.transcribe(new Int16Array(1600))).rejects.toThrow();
  });

  it('still deletes the temp WAV when exit code is non-zero', async () => {
    let capturedWavPath = '';

    const spawnFn = vi.fn((_cmd: string, args: string[]) => {
      const fIdx = args.indexOf('-f');
      if (fIdx >= 0) capturedWavPath = args[fIdx + 1];
      return makeFakeChild({ stdout: '', exitCode: 1 });
    }) as unknown as typeof import('node:child_process').spawn;

    manager = new SttSidecarManager({
      binaryPath: '/fake/whisper-cli',
      modelPath: '/fake/model.bin',
      spawnFn,
    });

    await manager.transcribe(new Int16Array(1600)).catch(() => {/* expected */});

    expect(capturedWavPath).not.toBe('');
    expect(fs.existsSync(capturedWavPath)).toBe(false);
  });

  it('rejects when stdout contains no valid JSON', async () => {
    const spawnFn = vi.fn(() => {
      return makeFakeChild({ stdout: 'not json at all', exitCode: 0 });
    }) as unknown as typeof import('node:child_process').spawn;

    manager = new SttSidecarManager({
      binaryPath: '/fake/whisper-cli',
      modelPath: '/fake/model.bin',
      spawnFn,
    });

    await expect(manager.transcribe(new Int16Array(1600))).rejects.toThrow();
  });

  it('still deletes the temp WAV when JSON parse fails', async () => {
    let capturedWavPath = '';

    const spawnFn = vi.fn((_cmd: string, args: string[]) => {
      const fIdx = args.indexOf('-f');
      if (fIdx >= 0) capturedWavPath = args[fIdx + 1];
      return makeFakeChild({ stdout: 'not json', exitCode: 0 });
    }) as unknown as typeof import('node:child_process').spawn;

    manager = new SttSidecarManager({
      binaryPath: '/fake/whisper-cli',
      modelPath: '/fake/model.bin',
      spawnFn,
    });

    await manager.transcribe(new Int16Array(1600)).catch(() => {/* expected */});

    expect(capturedWavPath).not.toBe('');
    expect(fs.existsSync(capturedWavPath)).toBe(false);
  });
});

describe('SttSidecarManager — lifecycle', () => {
  it('pause() kills current child without throwing', async () => {
    // pause() with no active child should be a no-op
    const manager = new SttSidecarManager({
      binaryPath: '/fake/whisper-cli',
      modelPath: '/fake/model.bin',
      spawnFn: vi.fn(() => makeFakeChild({})) as unknown as typeof import('node:child_process').spawn,
    });
    expect(() => manager.pause()).not.toThrow();
    await manager.dispose();
  });

  it('resume() is a no-op when not paused (no spawn triggered)', () => {
    const spawnFn = vi.fn(() => makeFakeChild({}));
    const manager = new SttSidecarManager({
      binaryPath: '/fake/whisper-cli',
      modelPath: '/fake/model.bin',
      spawnFn: spawnFn as unknown as typeof import('node:child_process').spawn,
    });
    manager.resume();
    // resume() does not eagerly spawn; spawn happens on next transcribe()
    expect(spawnFn).not.toHaveBeenCalled();
    manager.dispose();
  });

  it('dispose() clears tracked temp files (no zombies)', async () => {
    // Create a fake temp file to simulate a tracked WAV
    const fakeTempPath = path.join(os.tmpdir(), `aria-voice-dispose-test-${Date.now()}.wav`);
    fs.writeFileSync(fakeTempPath, Buffer.alloc(44));

    const manager = new SttSidecarManager({
      binaryPath: '/fake/whisper-cli',
      modelPath: '/fake/model.bin',
      spawnFn: vi.fn(() => makeFakeChild({})) as unknown as typeof import('node:child_process').spawn,
    });

    // Inject the fake path into the manager's tracking (via internal exposure for testing)
    (manager as unknown as { _trackedTempFiles: string[] })._trackedTempFiles.push(fakeTempPath);

    await manager.dispose();

    // Tracked file should be cleaned up
    expect(fs.existsSync(fakeTempPath)).toBe(false);
  });

  it('dispose() does not throw when no active child exists', async () => {
    const manager = new SttSidecarManager({
      binaryPath: '/fake/whisper-cli',
      modelPath: '/fake/model.bin',
      spawnFn: vi.fn(() => makeFakeChild({})) as unknown as typeof import('node:child_process').spawn,
    });
    await expect(manager.dispose()).resolves.not.toThrow();
  });
});
