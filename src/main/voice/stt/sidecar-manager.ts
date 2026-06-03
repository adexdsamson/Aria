/**
 * Phase 15 / Plan 15-02 Task 2 — STT sidecar manager.
 *
 * Owns the whisper.cpp CLI binary lifecycle for per-utterance transcription
 * (D-01/D-03). The per-utterance protocol (not persistent-stdin, per §Pitfall 1
 * / issue #3521) avoids the PCM-stdin framing complexity and is correct for the
 * PTT use-case where segments arrive at turn-end.
 *
 * Security (T-15-04): temp WAV files are written to os.tmpdir() and deleted in
 * a try/finally on BOTH success AND crash/exit — no biometric-audio persistence.
 *
 * Security (T-15-05): dispose()/crash-handler reaps the child process to avoid
 * zombies. powerMonitor lifecycle hooks (pause/resume) are exposed for the
 * wiring layer (Plan 15-05 Task 2 calls registerLifecycleCallbacks).
 *
 * D-04: this file never imports smart-whisper / nodejs-whisper / whisper-node.
 * The stt-no-native-addon ratchet (tests/static/stt-no-native-addon.spec.ts)
 * enforces this by construction (SC2 / VOICE-04).
 *
 * Lives under src/main/voice/** — the voice-routes-through-staging ratchet
 * bans sendApprovedEmail / applyCalendarChange / pushApprovedMeetingActions
 * imports and approval_path:'explicit' literals.
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as childProcess from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { TranscriptDelta } from '../../../shared/voice-types';
import { writePcmToWav, tempWavPath } from './wav';

// ─── Type aliases ─────────────────────────────────────────────────────────────

// Use a loose function type that is assignable from child_process.spawn's
// overloaded signature, and compatible with vitest mock functions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpawnFn = (command: string, args: ReadonlyArray<string>, options?: any) => ChildProcess;

// ─── Binary path resolution ───────────────────────────────────────────────────

/**
 * Resolve the whisper-cli binary path.
 *
 * Mirrors the `resolveAssetDir` pattern from `src/main/tray/icons.ts`:
 *   - packaged app → process.resourcesPath / whisper-cli[.exe]
 *   - dev / test   → <repo-root>/build/whisper-cli[.exe]
 *
 * The binary name is platform-specific: `.exe` on Windows.
 */
export function resolveBinaryPath(): string {
  const binaryName = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron');
    if (app?.isPackaged && process.resourcesPath) {
      return path.join(process.resourcesPath, binaryName);
    }
  } catch {
    /* electron mock without isPackaged — fall through to dev path */
  }

  // Dev/test fallback: walk up from out/main → <repo-root>/build
  // __dirname = src/main/voice/stt (during dev) or out/main/voice/stt (compiled)
  return path.join(__dirname, '..', '..', '..', '..', 'build', binaryName);
}

// ─── Whisper --output-json shape (minimal) ────────────────────────────────────

interface WhisperTranscriptEntry {
  text: string;
  offsets?: { from: number; to: number };
  timestamps?: { from: string; to: string };
}

interface WhisperJsonOutput {
  transcription: WhisperTranscriptEntry[];
}

// ─── SttSidecarManager options ────────────────────────────────────────────────

export interface SttSidecarManagerOptions {
  /** Absolute path to whisper-cli binary. Defaults to resolveBinaryPath(). */
  binaryPath?: string;
  /** Absolute path to the GGML model file (downloaded by Plan 15-03). */
  modelPath: string;
  /** Number of CPU threads to use. Default: 4. */
  threads?: number;
  /** Injectable spawn function for unit testing. Default: child_process.spawn. */
  spawnFn?: SpawnFn;
}

// ─── SttSidecarManager ────────────────────────────────────────────────────────

/**
 * Manages the whisper-cli child-process lifecycle for per-utterance
 * speech-to-text transcription.
 *
 * Usage (by Plan 15-05 IPC wiring):
 *   const mgr = new SttSidecarManager({ modelPath });
 *   // register lifecycle via registerLifecycleCallbacks({
 *   //   onSuspend: () => mgr.pause(),
 *   //   onResume:  () => mgr.resume(),
 *   // })
 *   const delta = await mgr.transcribe(pcmInt16Array);
 *   await mgr.dispose();
 */
export class SttSidecarManager {
  private readonly _binaryPath: string;
  private readonly _modelPath: string;
  private readonly _threads: number;
  private readonly _spawnFn: SpawnFn;

  /** Currently-running whisper-cli process (per-utterance, null between turns). */
  private _child: ChildProcess | null = null;

  /** Paused state (powerMonitor suspend). */
  private _paused = false;

  /**
   * Tracked temp WAV files. Populated during transcribe(); cleared on cleanup
   * and dispose(). Exposed as _trackedTempFiles for test assertions only.
   */
  public _trackedTempFiles: string[] = [];

  constructor(opts: SttSidecarManagerOptions) {
    this._binaryPath = opts.binaryPath ?? resolveBinaryPath();
    this._modelPath = opts.modelPath;
    this._threads = opts.threads ?? 4;
    this._spawnFn = opts.spawnFn ?? (childProcess.spawn as SpawnFn);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Transcribe a PCM segment.
   *
   * Protocol (D-01 / RESEARCH §Pattern 1):
   *   1. Write pcm → temp WAV in os.tmpdir()
   *   2. Spawn whisper-cli with [-m modelPath -f wavPath --output-json -t N --language auto --no-timestamps]
   *   3. Collect stdout, parse --output-json
   *   4. Resolve TranscriptDelta { text, final: true }
   *   5. ALWAYS delete temp WAV (try/finally — T-15-04)
   *
   * Rejects with a structured error if:
   *   - whisper-cli exits non-zero
   *   - stdout contains no valid JSON / missing transcription array
   */
  async transcribe(pcm: Int16Array): Promise<TranscriptDelta> {
    if (this._paused) {
      throw new Error('SttSidecarManager: transcribe called while paused');
    }

    const wavPath = tempWavPath();
    this._trackedTempFiles.push(wavPath);

    try {
      // Step 1: write WAV
      writePcmToWav(pcm, 16000, wavPath);

      // Step 2-4: spawn and parse
      const delta = await this._runWhisper(wavPath);
      return delta;
    } finally {
      // Step 5: ALWAYS delete (T-15-04)
      this._unlinkTracked(wavPath);
    }
  }

  /**
   * Pause the sidecar (powerMonitor suspend).
   * Kills the current child if one is running. Plan 15-05 calls this via
   * registerLifecycleCallbacks({ onSuspend: () => sidecar.pause() }).
   */
  pause(): void {
    this._paused = true;
    this._reapChild();
  }

  /**
   * Resume after suspend (powerMonitor resume).
   * Clears the paused flag; the next transcribe() call will respawn.
   * Plan 15-05 calls this via registerLifecycleCallbacks({ onResume: () => sidecar.resume() }).
   */
  resume(): void {
    this._paused = false;
  }

  /**
   * Dispose the manager: kill any running child and clean up all tracked
   * temp WAV files. Call this on app quit / IPC teardown.
   * Returns a Promise that resolves once the child has closed.
   */
  async dispose(): Promise<void> {
    this._reapChild();
    // Clean up all remaining tracked temp files (T-15-04)
    for (const f of this._trackedTempFiles.splice(0)) {
      try { fs.unlinkSync(f); } catch { /* already deleted or never created */ }
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Spawn whisper-cli with the per-utterance args, collect stdout, parse JSON.
   */
  private _runWhisper(wavPath: string): Promise<TranscriptDelta> {
    return new Promise<TranscriptDelta>((resolve, reject) => {
      const args = [
        '-m', this._modelPath,
        '-f', wavPath,
        '--output-json',
        '-t', String(this._threads),
        '--language', 'auto',
        '--no-timestamps',
      ];

      const child = this._spawnFn(this._binaryPath, args);
      this._child = child;

      let stdoutBuf = '';
      let exitCode: number | null = null;
      let closeSignal: string | null = null;

      if (child.stdout) {
        child.stdout.on('data', (chunk: Buffer | string) => {
          stdoutBuf += chunk.toString();
        });
      }

      child.on('close', (code, signal) => {
        this._child = null;
        exitCode = code;
        closeSignal = signal as string | null;

        if (exitCode !== 0 && exitCode !== null) {
          reject(new Error(
            `whisper-cli exited with code ${exitCode}${closeSignal ? ` (${closeSignal})` : ''}`
          ));
          return;
        }

        // Parse --output-json output
        try {
          const parsed = JSON.parse(stdoutBuf.trim()) as WhisperJsonOutput;
          const segments = parsed?.transcription;
          if (!Array.isArray(segments) || segments.length === 0) {
            reject(new Error('whisper-cli: transcription array missing or empty in --output-json output'));
            return;
          }

          // Concatenate all segment texts (whisper may split into multiple)
          const text = segments.map(s => s.text).join(' ').trim();

          // Build TranscriptDelta with optional timing from first/last segment
          const first = segments[0];
          const last = segments[segments.length - 1];
          const startMs = first?.offsets?.from;
          const endMs = last?.offsets?.to;

          const delta: TranscriptDelta = {
            text,
            final: true,
            ...(startMs !== undefined ? { startMs } : {}),
            ...(endMs !== undefined ? { endMs } : {}),
          };
          resolve(delta);
        } catch (err) {
          reject(new Error(
            `whisper-cli: failed to parse --output-json output: ${(err as Error).message}\nRaw output: ${stdoutBuf.slice(0, 200)}`
          ));
        }
      });

      child.on('error', (err) => {
        this._child = null;
        reject(new Error(`whisper-cli spawn error: ${err.message}`));
      });
    });
  }

  /** Kill the current child process if one is running. */
  private _reapChild(): void {
    if (this._child && !this._child.killed) {
      try {
        this._child.kill('SIGTERM');
      } catch {
        /* already dead */
      }
      this._child = null;
    }
  }

  /** Remove a path from _trackedTempFiles and delete from disk. */
  private _unlinkTracked(filePath: string): void {
    const idx = this._trackedTempFiles.indexOf(filePath);
    if (idx >= 0) this._trackedTempFiles.splice(idx, 1);
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* already deleted (crash path) or never written */
    }
  }
}
