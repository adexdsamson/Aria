/**
 * Quick 260609-htx — Cloud STT routing tests for VOICE_FEED_AUDIO.
 *
 * Three branches:
 *   A. shouldUseCloud → true  + cloudTranscribe succeeds → cloud delta emitted
 *   B. shouldUseCloud → false → local sidecar called, cloud NOT called
 *   C. shouldUseCloud → true  + cloudTranscribe returns { error } → sidecar fallback
 *
 * Injection strategy: registerVoiceHandlers accepts cloudStt / writePcm / llmQueue
 * optional deps, so we inject mocks without touching the real cloud-stt / wav modules.
 * ipcMain.handle is captured via a mock so we can invoke the handler directly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — declared before any imports that pull the modules under test.
// ---------------------------------------------------------------------------

// Mock node:fs so unlinkSync / readFileSync don't touch the real filesystem.
vi.mock('node:fs', () => ({
  default: {
    readFileSync: vi.fn(() => Buffer.from([])),
    unlinkSync: vi.fn(),
  },
  readFileSync: vi.fn(() => Buffer.from([])),
  unlinkSync: vi.fn(),
}));

// Mock getVoicePrefs so we can control useCloud per test.
vi.mock('../../../../src/main/voice/prefs', () => ({
  getVoicePrefs: vi.fn(() => ({ useCloud: true, speed: 1.0, voiceId: '' })),
  getVoiceModelStatus: vi.fn(() => ({ ready: false, path: null, state: 0 })),
  writeVoicePref: vi.fn(),
  readVoicePref: vi.fn(),
  VOICE_PREF_DEFAULTS: { useCloud: false, speed: 1.0, voiceId: '' },
}));

// Mock heavy deps that registerVoiceHandlers pulls in transitively.
vi.mock('../../../../src/main/voice/voice-session-manager', () => ({
  createVoiceSessionManager: vi.fn(() => ({
    startAnswer: vi.fn(),
    onBargeIn: vi.fn(),
    markLatency: vi.fn(),
  })),
}));

vi.mock('../../../../src/main/voice/voice-latency-log', () => ({
  readRecentVoiceLatencyLog: vi.fn(() => []),
}));

vi.mock('../../../../src/main/voice/confirm', () => ({
  voiceConfirm: vi.fn(),
}));

vi.mock('../../../../src/main/approvals/persist', () => ({
  getApproval: vi.fn(),
  transitionTo: vi.fn(),
}));

vi.mock('../../../../src/main/integrations/write-event', () => ({
  applyCalendarChange: vi.fn(),
}));

vi.mock('../../../../src/main/llm/providers', () => ({
  getLocalModel: vi.fn(() => ({})),
}));

vi.mock('ai', () => ({
  generateObject: vi.fn(),
  experimental_transcribe: vi.fn(),
}));

vi.mock('@ai-sdk/openai', () => ({
  openai: { transcription: vi.fn((_m: string) => ({ modelId: _m })) },
}));

vi.mock('zod', async (importOriginal) => {
  const actual = await importOriginal<typeof import('zod')>();
  return actual;
});

// ---------------------------------------------------------------------------
// Test harness helpers
// ---------------------------------------------------------------------------

import { CHANNELS } from '../../../../src/shared/ipc-contract';
import type { VoiceHandlersDeps } from '../../../../src/main/ipc/voice';

/** Minimal fake ipcMain that captures the last registered VOICE_FEED_AUDIO handler. */
function makeIpcMainMock() {
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();
  return {
    handle: vi.fn((channel: string, handler: (e: unknown, p: unknown) => Promise<unknown>) => {
      handlers.set(channel, handler);
    }),
    removeHandler: vi.fn(),
    _handlers: handlers,
    _invoke: async (channel: string, payload: unknown) => {
      const h = handlers.get(channel);
      if (!h) throw new Error(`No handler for ${channel}`);
      return h({}, payload);
    },
  };
}

/** Minimal PQueueLike stub that runs fns synchronously. */
const makeQueue = () => ({ add: async <T>(fn: () => Promise<T>): Promise<T> => fn() });

/** Build a minimal deps object for registerVoiceHandlers, with all injectables as mocks. */
function makeDeps(overrides: Partial<VoiceHandlersDeps> = {}): VoiceHandlersDeps {
  const mockSttSidecar = {
    transcribe: vi.fn().mockResolvedValue({ text: 'local result', final: true }),
    pause: vi.fn(),
    resume: vi.fn(),
  };
  const mockLogger = {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(() => mockLogger),
  };
  const mockDownloadController = {
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  };
  return {
    logger: mockLogger as never,
    dbHolder: { db: null },
    sttSidecar: mockSttSidecar as never,
    downloadController: mockDownloadController as never,
    emitToRenderer: vi.fn(),
    llmQueue: makeQueue(),
    ...overrides,
  };
}

/** Build a fake PCM ArrayBuffer (empty but valid). */
function fakePcmPayload(): ArrayBuffer {
  return new Int16Array(16).buffer;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VOICE_FEED_AUDIO cloud STT routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('A: shouldUseCloud → true — routes to cloudTranscribe; sidecar NOT called', async () => {
    const mockCloudStt = {
      shouldUseCloud: vi.fn().mockResolvedValue(true),
      cloudTranscribe: vi.fn().mockResolvedValue({ text: 'cloud result' }),
    };
    const mockWavUtils = {
      writePcmToWav: vi.fn().mockReturnValue('/tmp/test.wav'),
      tempWavPath: vi.fn().mockReturnValue('/tmp/test.wav'),
    };

    const ipcMain = makeIpcMainMock();
    const deps = makeDeps({ cloudStt: mockCloudStt, writePcm: mockWavUtils });
    const emitToRenderer = vi.fn();
    deps.emitToRenderer = emitToRenderer;

    const { registerVoiceHandlers } = await import('../../../../src/main/ipc/voice');
    registerVoiceHandlers(ipcMain as never, deps);

    await ipcMain._invoke(CHANNELS.VOICE_FEED_AUDIO, fakePcmPayload());

    // Cloud path taken
    expect(mockCloudStt.shouldUseCloud).toHaveBeenCalledOnce();
    expect(mockCloudStt.cloudTranscribe).toHaveBeenCalledOnce();

    // Local sidecar NOT called
    expect(deps.sttSidecar.transcribe).not.toHaveBeenCalled();

    // VOICE_TRANSCRIPT_DELTA emitted with cloud delta
    expect(emitToRenderer).toHaveBeenCalledWith(
      CHANNELS.VOICE_TRANSCRIPT_DELTA,
      { text: 'cloud result', final: true },
    );
  });

  it('B: shouldUseCloud → false — sidecar called; cloudTranscribe NOT called', async () => {
    const mockCloudStt = {
      shouldUseCloud: vi.fn().mockResolvedValue(false),
      cloudTranscribe: vi.fn(),
    };
    const mockWavUtils = {
      writePcmToWav: vi.fn().mockReturnValue('/tmp/test.wav'),
      tempWavPath: vi.fn().mockReturnValue('/tmp/test.wav'),
    };

    const ipcMain = makeIpcMainMock();
    const deps = makeDeps({ cloudStt: mockCloudStt, writePcm: mockWavUtils });
    const emitToRenderer = vi.fn();
    deps.emitToRenderer = emitToRenderer;

    const { registerVoiceHandlers } = await import('../../../../src/main/ipc/voice');
    registerVoiceHandlers(ipcMain as never, deps);

    await ipcMain._invoke(CHANNELS.VOICE_FEED_AUDIO, fakePcmPayload());

    // Cloud path NOT taken
    expect(mockCloudStt.cloudTranscribe).not.toHaveBeenCalled();

    // Local sidecar called
    expect(deps.sttSidecar.transcribe).toHaveBeenCalledOnce();

    // VOICE_TRANSCRIPT_DELTA emitted with sidecar delta
    expect(emitToRenderer).toHaveBeenCalledWith(
      CHANNELS.VOICE_TRANSCRIPT_DELTA,
      { text: 'local result', final: true },
    );
  });

  it('C: cloudTranscribe returns { error } — falls back to sidecar; turn NOT dropped', async () => {
    const mockCloudStt = {
      shouldUseCloud: vi.fn().mockResolvedValue(true),
      cloudTranscribe: vi.fn().mockResolvedValue({ error: 'API down' }),
    };
    const mockWavUtils = {
      writePcmToWav: vi.fn().mockReturnValue('/tmp/test.wav'),
      tempWavPath: vi.fn().mockReturnValue('/tmp/test.wav'),
    };

    const ipcMain = makeIpcMainMock();
    const deps = makeDeps({ cloudStt: mockCloudStt, writePcm: mockWavUtils });
    const emitToRenderer = vi.fn();
    deps.emitToRenderer = emitToRenderer;

    const { registerVoiceHandlers } = await import('../../../../src/main/ipc/voice');
    registerVoiceHandlers(ipcMain as never, deps);

    await ipcMain._invoke(CHANNELS.VOICE_FEED_AUDIO, fakePcmPayload());

    // Cloud was attempted
    expect(mockCloudStt.cloudTranscribe).toHaveBeenCalledOnce();

    // Fallback to local sidecar
    expect(deps.sttSidecar.transcribe).toHaveBeenCalledOnce();

    // Turn NOT dropped — VOICE_TRANSCRIPT_DELTA emitted with sidecar delta
    expect(emitToRenderer).toHaveBeenCalledWith(
      CHANNELS.VOICE_TRANSCRIPT_DELTA,
      { text: 'local result', final: true },
    );
  });
});
