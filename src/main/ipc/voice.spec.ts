/**
 * Phase 15 / Plan 15-05 Task 1 — TDD RED spec for registerVoiceHandlers.
 *
 * Tests the four VOICE_* invoke handlers (VOICE_FEED_AUDIO,
 * VOICE_GET_MODEL_STATUS, VOICE_DOWNLOAD_MODEL, VOICE_CANCEL_TTS) via
 * injected fake services and a recording emitToRenderer. No real binary,
 * no real DB.
 *
 * Mirrors the entitlement handler test structure exactly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IpcMain } from 'electron';
import type { SttSidecarManager } from '../voice/stt/sidecar-manager';
import type { ModelDownloadController } from '../voice/download/model-download';

// ─── Fakes ───────────────────────────────────────────────────────────────────

function makeFakeIpcMain() {
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();
  const ipcMain = {
    handle: vi.fn((channel: string, fn: (event: unknown, payload: unknown) => Promise<unknown>) => {
      handlers.set(channel, fn);
    }),
  } as unknown as IpcMain;
  return { ipcMain, handlers };
}

function makeFakeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  };
}

function makeFakeDbHolder(db: unknown = null) {
  return {
    db,
    get isOpen() { return db !== null; },
    set: () => {},
    close: () => {},
  } as import('./onboarding').DbHolder;
}

function makeFakeSttSidecar(): SttSidecarManager {
  return {
    transcribe: vi.fn().mockResolvedValue({ text: 'hello world', final: true }),
    pause: vi.fn(),
    resume: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
    _trackedTempFiles: [],
    _binaryPath: '/fake/binary',
    _modelPath: '/fake/model',
    _threads: 4,
    _spawnFn: vi.fn(),
    _child: null,
    _paused: false,
  } as unknown as SttSidecarManager;
}

function makeFakeDownloadController(): ModelDownloadController {
  return {
    disclosedSize: vi.fn().mockReturnValue(574_041_195),
    start: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn().mockResolvedValue(undefined),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('registerVoiceHandlers (Plan 15-05)', () => {
  const CHANNELS_VOICE = {
    VOICE_FEED_AUDIO: 'aria:voice:feed-audio',
    VOICE_GET_MODEL_STATUS: 'aria:voice:model-status',
    VOICE_DOWNLOAD_MODEL: 'aria:voice:download-model',
    VOICE_CANCEL_TTS: 'aria:voice:cancel-tts',
    VOICE_TRANSCRIPT_DELTA: 'aria:voice:transcript-delta',
    VOICE_STATE_CHANGED: 'aria:voice:state-changed',
  };

  let registerVoiceHandlers: typeof import('./voice').registerVoiceHandlers;
  let emitCalls: Array<{ channel: string; payload: unknown }>;
  let emitToRenderer: (channel: string, payload?: unknown) => void;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('./voice');
    registerVoiceHandlers = mod.registerVoiceHandlers;

    emitCalls = [];
    emitToRenderer = (channel, payload) => {
      emitCalls.push({ channel, payload });
    };
  });

  it('registers exactly the 4 voice invoke channels', () => {
    const { ipcMain, handlers } = makeFakeIpcMain();
    registerVoiceHandlers(ipcMain, {
      logger: makeFakeLogger() as any,
      dbHolder: makeFakeDbHolder(),
      sttSidecar: makeFakeSttSidecar(),
      downloadController: makeFakeDownloadController(),
      emitToRenderer,
    });
    expect(handlers.has(CHANNELS_VOICE.VOICE_FEED_AUDIO)).toBe(true);
    expect(handlers.has(CHANNELS_VOICE.VOICE_GET_MODEL_STATUS)).toBe(true);
    expect(handlers.has(CHANNELS_VOICE.VOICE_DOWNLOAD_MODEL)).toBe(true);
    expect(handlers.has(CHANNELS_VOICE.VOICE_CANCEL_TTS)).toBe(true);
    expect(handlers.size).toBe(4);
  });

  it('VOICE_FEED_AUDIO: calls sttSidecar.transcribe and pushes VOICE_TRANSCRIPT_DELTA + VOICE_STATE_CHANGED', async () => {
    const { ipcMain, handlers } = makeFakeIpcMain();
    const sttSidecar = makeFakeSttSidecar();
    registerVoiceHandlers(ipcMain, {
      logger: makeFakeLogger() as any,
      dbHolder: makeFakeDbHolder(),
      sttSidecar,
      downloadController: makeFakeDownloadController(),
      emitToRenderer,
    });

    // Simulate a PCM Int16Array from the renderer (as ArrayBuffer)
    const pcm = new Int16Array(1600);
    const result = await handlers.get(CHANNELS_VOICE.VOICE_FEED_AUDIO)!({}, pcm.buffer);

    expect(result).toMatchObject({ ok: true });
    expect(sttSidecar.transcribe).toHaveBeenCalledOnce();

    // Should push VOICE_TRANSCRIPT_DELTA
    const transcriptPush = emitCalls.find(c => c.channel === CHANNELS_VOICE.VOICE_TRANSCRIPT_DELTA);
    expect(transcriptPush).toBeDefined();
    expect((transcriptPush?.payload as any)?.text).toBe('hello world');

    // Should push VOICE_STATE_CHANGED at least once
    const statePushes = emitCalls.filter(c => c.channel === CHANNELS_VOICE.VOICE_STATE_CHANGED);
    expect(statePushes.length).toBeGreaterThanOrEqual(1);
  });

  it('VOICE_FEED_AUDIO: returns ok: false on sidecar transcribe error', async () => {
    const { ipcMain, handlers } = makeFakeIpcMain();
    const sttSidecar = makeFakeSttSidecar();
    (sttSidecar.transcribe as any).mockRejectedValue(new Error('binary not found'));

    registerVoiceHandlers(ipcMain, {
      logger: makeFakeLogger() as any,
      dbHolder: makeFakeDbHolder(),
      sttSidecar,
      downloadController: makeFakeDownloadController(),
      emitToRenderer,
    });

    const pcm = new Int16Array(1600);
    const result = await handlers.get(CHANNELS_VOICE.VOICE_FEED_AUDIO)!({}, pcm.buffer);

    expect(result).toMatchObject({ ok: false, error: 'binary not found' });
  });

  it('VOICE_GET_MODEL_STATUS: returns ok: true with default status when db is null', async () => {
    const { ipcMain, handlers } = makeFakeIpcMain();
    registerVoiceHandlers(ipcMain, {
      logger: makeFakeLogger() as any,
      dbHolder: makeFakeDbHolder(null), // null db = pre-unlock
      sttSidecar: makeFakeSttSidecar(),
      downloadController: makeFakeDownloadController(),
      emitToRenderer,
    });

    const result = await handlers.get(CHANNELS_VOICE.VOICE_GET_MODEL_STATUS)!({}, undefined);
    expect(result).toMatchObject({
      ok: true,
      status: { ready: false, path: null, state: 0 },
    });
  });

  it('VOICE_DOWNLOAD_MODEL: starts download controller and returns ok: true', async () => {
    const { ipcMain, handlers } = makeFakeIpcMain();
    const downloadController = makeFakeDownloadController();
    registerVoiceHandlers(ipcMain, {
      logger: makeFakeLogger() as any,
      dbHolder: makeFakeDbHolder(),
      sttSidecar: makeFakeSttSidecar(),
      downloadController,
      emitToRenderer,
    });

    const result = await handlers.get(CHANNELS_VOICE.VOICE_DOWNLOAD_MODEL)!({}, undefined);
    expect(result).toMatchObject({ ok: true });
    expect(downloadController.start).toHaveBeenCalledOnce();
  });

  it('VOICE_CANCEL_TTS: returns ok: true (ack only — TTS lives in renderer)', async () => {
    const { ipcMain, handlers } = makeFakeIpcMain();
    registerVoiceHandlers(ipcMain, {
      logger: makeFakeLogger() as any,
      dbHolder: makeFakeDbHolder(),
      sttSidecar: makeFakeSttSidecar(),
      downloadController: makeFakeDownloadController(),
      emitToRenderer,
    });

    const result = await handlers.get(CHANNELS_VOICE.VOICE_CANCEL_TTS)!({}, undefined);
    expect(result).toMatchObject({ ok: true });
  });

  it('VOICE_FEED_AUDIO: pushes processing state before transcribe and idle state after', async () => {
    const { ipcMain, handlers } = makeFakeIpcMain();
    registerVoiceHandlers(ipcMain, {
      logger: makeFakeLogger() as any,
      dbHolder: makeFakeDbHolder(),
      sttSidecar: makeFakeSttSidecar(),
      downloadController: makeFakeDownloadController(),
      emitToRenderer,
    });

    const pcm = new Int16Array(1600);
    await handlers.get(CHANNELS_VOICE.VOICE_FEED_AUDIO)!({}, pcm.buffer);

    const stateChanges = emitCalls
      .filter(c => c.channel === CHANNELS_VOICE.VOICE_STATE_CHANGED)
      .map(c => (c.payload as any)?.state);

    // Must include at least 'processing' and 'idle' in that order
    expect(stateChanges).toContain('processing');
    expect(stateChanges).toContain('idle');
    const processingIdx = stateChanges.indexOf('processing');
    const idleIdx = stateChanges.lastIndexOf('idle');
    expect(processingIdx).toBeLessThan(idleIdx);
  });
});
