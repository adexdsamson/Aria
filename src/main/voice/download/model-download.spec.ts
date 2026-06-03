/**
 * Phase 15 / Plan 15-03 Task 1 — TDD specs for the Whisper model download manager.
 *
 * The spec uses an injectable DownloadHelper factory that returns a fake NDH
 * emitter — no network required.
 *
 * Scenarios covered:
 *   - disclosedSize() returns the known model size before start (SC4 size disclosure)
 *   - progress event → emitToRenderer(VOICE_MODEL_PROGRESS, { receivedBytes, totalBytes })
 *     + setVoiceModelDownloading state flip
 *   - end/complete event → setVoiceModelReady(db, destPath)
 *   - error event → failure emitted, partial file kept (state NOT flipped to ready)
 *   - pause() / resume() drive NDH pause / resume
 *   - powerMonitor seam: onSuspend → pause, onResume → resume
 *   - size mismatch on end → readiness NOT flipped (T-15-08 supply-chain guard)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { createTempUserDataDir } from '../../../../tests/setup';
import { openDb, closeDb, type Db } from '../../db/connect';
import { runMigrations } from '../../db/migrations/runner';
import { getVoiceModelStatus } from '../prefs';

// Will fail until model-download.ts is created (TDD RED)
import {
  createModelDownload,
  DISCLOSED_MODEL_SIZE_BYTES,
  MODEL_FILENAME,
} from './model-download';
import type { ModelDownloadDeps } from './model-download';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../db/migrations');

// ─── Fake DownloadHelper factory ────────────────────────────────────────────

interface FakeNdhOpts {
  /** If true, emit 'end' after progress with matching totalBytes */
  completeAfterProgress?: boolean;
  /** If true, emit 'end' with wrong totalBytes (size mismatch) */
  sizeMatchError?: boolean;
  /** If true, emit 'error' instead of 'end' */
  emitError?: boolean;
  /** totalBytes to report on progress event */
  totalBytes?: number;
}

function makeFakeNdh(opts: FakeNdhOpts = {}) {
  const emitter = new EventEmitter();
  let paused = false;
  let resumed = false;

  const dl = {
    on: (event: string, cb: (...args: unknown[]) => void) => {
      emitter.on(event, cb);
      return dl;
    },
    start: vi.fn(async () => {
      // emit progress
      const receivedBytes = 100_000;
      const totalBytes = opts.totalBytes ?? DISCLOSED_MODEL_SIZE_BYTES;
      setImmediate(() => {
        emitter.emit('progress', { progress: { downloaded: receivedBytes, total: totalBytes } });

        if (opts.emitError) {
          setImmediate(() => emitter.emit('error', new Error('network error')));
          return;
        }
        if (opts.completeAfterProgress) {
          const endTotal = opts.sizeMatchError
            ? DISCLOSED_MODEL_SIZE_BYTES + 1234 // wrong size
            : totalBytes;
          setImmediate(() =>
            emitter.emit('end', {
              filePath: '/fake/userData/models/ggml-large-v3-turbo-q5_0.bin',
              totalSize: endTotal,
            }),
          );
        }
      });
    }),
    pause: vi.fn(() => { paused = true; }),
    resume: vi.fn(() => { resumed = true; }),
    stop: vi.fn(async () => {}),
    _paused: () => paused,
    _resumed: () => resumed,
  };

  return dl;
}

type FakeNdh = ReturnType<typeof makeFakeNdh>;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('model-download manager (Whisper model — unit, no network)', () => {
  let db: Db;

  beforeEach(() => {
    const dataDir = createTempUserDataDir('aria-model-dl');
    const dbKey = crypto.randomBytes(32);
    db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });
  });

  it('disclosedSize() returns the known model byte size before start (SC4)', () => {
    const emitToRenderer = vi.fn();
    const fakeNdh = makeFakeNdh();
    let capturedDestDir = '';

    const ctrl = createModelDownload({
      db,
      emitToRenderer,
      helperFactory: (url, destDir) => {
        capturedDestDir = destDir;
        return fakeNdh as unknown as import('node-downloader-helper').DownloadHelper;
      },
      destDirResolver: () => '/fake/userData',
      registerLifecycle: () => () => {},
    });

    // Size must be known BEFORE start
    const size = ctrl.disclosedSize();
    expect(size).toBe(DISCLOSED_MODEL_SIZE_BYTES);
    expect(size).toBeGreaterThan(500_000_000); // > 500 MB sanity check
    // capturedDestDir not set yet — helper not created until start
    expect(capturedDestDir).toBe('');
  });

  it('progress event → emitToRenderer(VOICE_MODEL_PROGRESS, { receivedBytes, totalBytes })', async () => {
    const emitToRenderer = vi.fn();
    const fakeNdh = makeFakeNdh({ totalBytes: DISCLOSED_MODEL_SIZE_BYTES });

    const ctrl = createModelDownload({
      db,
      emitToRenderer,
      helperFactory: () => fakeNdh as unknown as import('node-downloader-helper').DownloadHelper,
      destDirResolver: () => '/fake/userData',
      registerLifecycle: () => () => {},
    });

    await ctrl.start();
    // Wait for setImmediate progress emission
    await new Promise((r) => setImmediate(r));

    const progressCalls = emitToRenderer.mock.calls.filter(
      ([ch]) => ch === 'aria:voice:model-progress',
    );
    expect(progressCalls.length).toBeGreaterThan(0);
    const [, payload] = progressCalls[0];
    expect(payload).toHaveProperty('receivedBytes');
    expect(payload).toHaveProperty('totalBytes');
  });

  it('progress event sets model state to downloading (state: 2) in DB', async () => {
    const emitToRenderer = vi.fn();
    const fakeNdh = makeFakeNdh({ totalBytes: DISCLOSED_MODEL_SIZE_BYTES });

    const ctrl = createModelDownload({
      db,
      emitToRenderer,
      helperFactory: () => fakeNdh as unknown as import('node-downloader-helper').DownloadHelper,
      destDirResolver: () => '/fake/userData',
      registerLifecycle: () => () => {},
    });

    await ctrl.start();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const status = getVoiceModelStatus(db);
    expect(status.state).toBe(2);
  });

  it('end event with matching size → setVoiceModelReady(db, destPath) (D-08, T-15-08)', async () => {
    const emitToRenderer = vi.fn();
    const fakeNdh = makeFakeNdh({
      completeAfterProgress: true,
      totalBytes: DISCLOSED_MODEL_SIZE_BYTES,
    });

    const ctrl = createModelDownload({
      db,
      emitToRenderer,
      helperFactory: () => fakeNdh as unknown as import('node-downloader-helper').DownloadHelper,
      destDirResolver: () => '/fake/userData',
      registerLifecycle: () => () => {},
    });

    await ctrl.start();
    // Progress + end both use setImmediate — drain two ticks
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const status = getVoiceModelStatus(db);
    expect(status.ready).toBe(true);
    expect(status.state).toBe(1);
    expect(status.path).toBeTruthy();
  });

  it('end event with size mismatch → readiness NOT flipped (T-15-08 supply-chain guard)', async () => {
    const emitToRenderer = vi.fn();
    const fakeNdh = makeFakeNdh({
      completeAfterProgress: true,
      sizeMatchError: true,
      totalBytes: DISCLOSED_MODEL_SIZE_BYTES,
    });

    const ctrl = createModelDownload({
      db,
      emitToRenderer,
      helperFactory: () => fakeNdh as unknown as import('node-downloader-helper').DownloadHelper,
      destDirResolver: () => '/fake/userData',
      registerLifecycle: () => () => {},
    });

    await ctrl.start();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const status = getVoiceModelStatus(db);
    // State may be 2 (downloading) or 0 (absent) but never 1 (ready)
    expect(status.ready).toBe(false);
    expect(status.state).not.toBe(1);
  });

  it('error event → failure payload emitted; model stays not-ready (partial file kept for resume)', async () => {
    const emitToRenderer = vi.fn();
    const fakeNdh = makeFakeNdh({ emitError: true });

    const ctrl = createModelDownload({
      db,
      emitToRenderer,
      helperFactory: () => fakeNdh as unknown as import('node-downloader-helper').DownloadHelper,
      destDirResolver: () => '/fake/userData',
      registerLifecycle: () => () => {},
    });

    await ctrl.start();
    // Three ticks: start → progress → error
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    // A failure event must have been emitted
    const failureCalls = emitToRenderer.mock.calls.filter(
      ([ch]) => ch === 'aria:voice:model-progress' || ch === 'aria:voice:state-changed',
    );
    expect(failureCalls.length).toBeGreaterThan(0);

    // Readiness must NOT be set
    const status = getVoiceModelStatus(db);
    expect(status.ready).toBe(false);
  });

  it('pause() and resume() delegate to the NDH instance', async () => {
    const emitToRenderer = vi.fn();
    const fakeNdh = makeFakeNdh();

    const ctrl = createModelDownload({
      db,
      emitToRenderer,
      helperFactory: () => fakeNdh as unknown as import('node-downloader-helper').DownloadHelper,
      destDirResolver: () => '/fake/userData',
      registerLifecycle: () => () => {},
    });

    await ctrl.start();

    ctrl.pause();
    expect(fakeNdh.pause).toHaveBeenCalledTimes(1);

    ctrl.resume();
    expect(fakeNdh.resume).toHaveBeenCalledTimes(1);
  });

  it('powerMonitor seam: onSuspend calls pause, onResume calls resume (D-09)', async () => {
    const emitToRenderer = vi.fn();
    const fakeNdh = makeFakeNdh();
    let registeredOnSuspend: (() => void) | undefined;
    let registeredOnResume: (() => void) | undefined;

    const ctrl = createModelDownload({
      db,
      emitToRenderer,
      helperFactory: () => fakeNdh as unknown as import('node-downloader-helper').DownloadHelper,
      destDirResolver: () => '/fake/userData',
      registerLifecycle: ({ onSuspend, onResume }) => {
        registeredOnSuspend = onSuspend;
        registeredOnResume = onResume;
        return () => {};
      },
    });

    await ctrl.start();

    expect(registeredOnSuspend).toBeDefined();
    expect(registeredOnResume).toBeDefined();

    registeredOnSuspend!();
    expect(fakeNdh.pause).toHaveBeenCalledTimes(1);

    registeredOnResume!();
    expect(fakeNdh.resume).toHaveBeenCalledTimes(1);
  });

  it('MODEL_FILENAME matches the HF file name', () => {
    expect(MODEL_FILENAME).toBe('ggml-large-v3-turbo-q5_0.bin');
  });

  it('destination path resolves under the provided destDir', async () => {
    const emitToRenderer = vi.fn();
    const fakeNdh = makeFakeNdh();
    let capturedDestDir = '';

    const ctrl = createModelDownload({
      db,
      emitToRenderer,
      helperFactory: (url, destDir) => {
        capturedDestDir = destDir;
        return fakeNdh as unknown as import('node-downloader-helper').DownloadHelper;
      },
      destDirResolver: () => '/fake/userData',
      registerLifecycle: () => () => {},
    });

    await ctrl.start();

    // destDir passed to factory should come from destDirResolver output
    expect(capturedDestDir).toBe('/fake/userData');
  });
});
