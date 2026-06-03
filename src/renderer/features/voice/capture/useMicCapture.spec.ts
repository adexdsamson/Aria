/**
 * Phase 15 / Plan 15-04 Task 2 — useMicCapture hook (TDD RED).
 *
 * Tests MUST fail before useMicCapture.ts is implemented.
 *
 * Behavior contract (plan spec):
 *  - start() calls navigator.mediaDevices.getUserMedia (NOT desktopCapturer, NOT native recorder)
 *  - PCM frames from the worklet's port.onmessage are forwarded to onPcmFrame(buffer: ArrayBuffer)
 *  - getUserMedia rejection (NotAllowedError) resolves to a structured onError callback — no unhandled throw
 *  - a 'devicechange' event while active re-acquires the stream (stop old tracks, getUserMedia again)
 *  - if re-acquisition fails it emits a device-lost error via onError
 *  - stop() tears down: stop tracks, disconnect worklet node, close AudioContext, remove devicechange listener
 *  - UI-SPEC copy strings: "Microphone permission denied — check your system settings",
 *    "Audio device disconnected"
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── module under test ─────────────────────────────────────────────────────
import { createMicCapture } from './useMicCapture';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Create a fake MediaStreamTrack with a stop() spy. */
function fakeTrack(): MediaStreamTrack {
  return { stop: vi.fn(), kind: 'audio' } as unknown as MediaStreamTrack;
}

/** Create a fake MediaStream with injectable tracks. */
function fakeStream(tracks: MediaStreamTrack[]): MediaStream {
  return {
    getAudioTracks: vi.fn().mockReturnValue(tracks),
    getTracks: vi.fn().mockReturnValue(tracks),
  } as unknown as MediaStream;
}

/** Create a fake AudioWorkletNode with a port (MessagePort-like). */
function fakeWorkletNode() {
  const node = {
    port: { onmessage: null as ((e: MessageEvent) => void) | null },
    disconnect: vi.fn(),
    connect: vi.fn(),
  };
  return node;
}

/** Create a fake AudioContext with close + createMediaStreamSource stubs. */
function fakeAudioContext(sampleRate = 16000) {
  const source = { connect: vi.fn() };
  const ctx = {
    sampleRate,
    state: 'running' as AudioContextState,
    close: vi.fn().mockResolvedValue(undefined),
    createMediaStreamSource: vi.fn().mockReturnValue(source),
    audioWorklet: {
      addModule: vi.fn().mockResolvedValue(undefined),
    },
    destination: {},
  };
  return ctx;
}

// ─── global mocks setup ────────────────────────────────────────────────────

// vi.mock for the worklet module — we control the returned node
vi.mock('./mic-worklet', () => ({
  setupWorklet: vi.fn(),
  WORKLET_SOURCE: 'mock-worklet-source',
}));

import { setupWorklet } from './mic-worklet';

// Map of event listeners added to mediaDevices
const deviceChangeListeners = new Map<string, EventListenerOrEventListenerObject>();

let mockGetUserMedia: ReturnType<typeof vi.fn>;
let mockAddEventListener: ReturnType<typeof vi.fn>;
let mockRemoveEventListener: ReturnType<typeof vi.fn>;
let MockAudioContext: ReturnType<typeof vi.fn>;
let currentFakeCtx: ReturnType<typeof fakeAudioContext>;

beforeEach(() => {
  deviceChangeListeners.clear();

  mockGetUserMedia = vi.fn();
  mockAddEventListener = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
    deviceChangeListeners.set(type, listener);
  });
  mockRemoveEventListener = vi.fn((type: string) => {
    deviceChangeListeners.delete(type);
  });

  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: mockGetUserMedia,
      addEventListener: mockAddEventListener,
      removeEventListener: mockRemoveEventListener,
    },
  });

  currentFakeCtx = fakeAudioContext();
  MockAudioContext = vi.fn().mockImplementation(() => currentFakeCtx);
  vi.stubGlobal('AudioContext', MockAudioContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ─── tests ─────────────────────────────────────────────────────────────────

describe('createMicCapture', () => {
  describe('start() — getUserMedia', () => {
    it('calls navigator.mediaDevices.getUserMedia (not desktopCapturer)', async () => {
      const track = fakeTrack();
      const stream = fakeStream([track]);
      const workletNode = fakeWorkletNode();
      mockGetUserMedia.mockResolvedValue(stream);
      (setupWorklet as ReturnType<typeof vi.fn>).mockResolvedValue(workletNode);

      const capture = createMicCapture({ onPcmFrame: vi.fn(), onError: vi.fn() });
      await capture.start();

      expect(mockGetUserMedia).toHaveBeenCalledOnce();
      const constraints = mockGetUserMedia.mock.calls[0][0];
      expect(constraints).toHaveProperty('audio');
      // Must NOT use desktopCapturer (no 'video' key requesting screen)
      expect(constraints).not.toHaveProperty('video');

      await capture.stop();
    });

    it('creates AudioContext at sampleRate 16000', async () => {
      const stream = fakeStream([fakeTrack()]);
      const workletNode = fakeWorkletNode();
      mockGetUserMedia.mockResolvedValue(stream);
      (setupWorklet as ReturnType<typeof vi.fn>).mockResolvedValue(workletNode);

      const capture = createMicCapture({ onPcmFrame: vi.fn(), onError: vi.fn() });
      await capture.start();

      expect(MockAudioContext).toHaveBeenCalledWith({ sampleRate: 16000 });
      await capture.stop();
    });

    it('forwards worklet port.onmessage PCM frames to onPcmFrame callback', async () => {
      const track = fakeTrack();
      const stream = fakeStream([track]);
      const workletNode = fakeWorkletNode();
      mockGetUserMedia.mockResolvedValue(stream);
      (setupWorklet as ReturnType<typeof vi.fn>).mockResolvedValue(workletNode);

      const onPcmFrame = vi.fn();
      const capture = createMicCapture({ onPcmFrame, onError: vi.fn() });
      await capture.start();

      // Simulate worklet sending a PCM frame
      const pcmBuffer = new ArrayBuffer(512);
      workletNode.port.onmessage!({ data: { pcm: pcmBuffer } } as MessageEvent);

      expect(onPcmFrame).toHaveBeenCalledOnce();
      expect(onPcmFrame).toHaveBeenCalledWith(pcmBuffer);

      await capture.stop();
    });

    it('registers a devicechange listener after stream acquisition', async () => {
      const stream = fakeStream([fakeTrack()]);
      const workletNode = fakeWorkletNode();
      mockGetUserMedia.mockResolvedValue(stream);
      (setupWorklet as ReturnType<typeof vi.fn>).mockResolvedValue(workletNode);

      const capture = createMicCapture({ onPcmFrame: vi.fn(), onError: vi.fn() });
      await capture.start();

      expect(mockAddEventListener).toHaveBeenCalledWith('devicechange', expect.any(Function));
      await capture.stop();
    });
  });

  describe('permission-denied handling (D-20/SC5)', () => {
    it('emits structured onError for NotAllowedError — no unhandled throw', async () => {
      const permissionError = new DOMException('Permission denied', 'NotAllowedError');
      mockGetUserMedia.mockRejectedValue(permissionError);

      const onError = vi.fn();
      const capture = createMicCapture({ onPcmFrame: vi.fn(), onError });
      // Must NOT throw — error is routed to callback
      await expect(capture.start()).resolves.not.toThrow();

      expect(onError).toHaveBeenCalledOnce();
      const [err] = onError.mock.calls[0];
      expect(err.type).toBe('permission-denied');
      expect(err.message).toBe('Microphone permission denied — check your system settings');
    });

    it('does not crash on other getUserMedia errors', async () => {
      mockGetUserMedia.mockRejectedValue(new Error('Device not found'));
      const onError = vi.fn();
      const capture = createMicCapture({ onPcmFrame: vi.fn(), onError });
      await expect(capture.start()).resolves.not.toThrow();
      expect(onError).toHaveBeenCalledOnce();
    });
  });

  describe('devicechange hot-swap (D-20/SC5)', () => {
    it('re-acquires the stream on devicechange without throwing', async () => {
      const track1 = fakeTrack();
      const stream1 = fakeStream([track1]);
      const track2 = fakeTrack();
      const stream2 = fakeStream([track2]);
      const workletNode1 = fakeWorkletNode();
      const workletNode2 = fakeWorkletNode();

      mockGetUserMedia
        .mockResolvedValueOnce(stream1)
        .mockResolvedValueOnce(stream2);
      (setupWorklet as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(workletNode1)
        .mockResolvedValueOnce(workletNode2);

      const capture = createMicCapture({ onPcmFrame: vi.fn(), onError: vi.fn() });
      await capture.start();

      // Fire the devicechange event
      const deviceChangeFn = deviceChangeListeners.get('devicechange') as () => void;
      expect(deviceChangeFn).toBeDefined();
      await deviceChangeFn();

      // Old track stopped
      expect(track1.stop).toHaveBeenCalled();
      // getUserMedia called twice (initial + re-acquire)
      expect(mockGetUserMedia).toHaveBeenCalledTimes(2);

      await capture.stop();
    });

    it('emits device-lost error when re-acquisition fails', async () => {
      const track = fakeTrack();
      const stream = fakeStream([track]);
      const workletNode = fakeWorkletNode();
      mockGetUserMedia
        .mockResolvedValueOnce(stream)
        .mockRejectedValueOnce(new Error('Device removed'));
      (setupWorklet as ReturnType<typeof vi.fn>).mockResolvedValue(workletNode);

      const onError = vi.fn();
      const capture = createMicCapture({ onPcmFrame: vi.fn(), onError });
      await capture.start();

      const deviceChangeFn = deviceChangeListeners.get('devicechange') as () => Promise<void>;
      await deviceChangeFn();

      expect(onError).toHaveBeenCalledOnce();
      const [err] = onError.mock.calls[0];
      expect(err.type).toBe('device-lost');
      expect(err.message).toBe('Audio device disconnected');
    });
  });

  describe('stop() cleanup (no leak)', () => {
    it('stops all tracks, disconnects worklet node, closes AudioContext', async () => {
      const track = fakeTrack();
      const stream = fakeStream([track]);
      const workletNode = fakeWorkletNode();
      mockGetUserMedia.mockResolvedValue(stream);
      (setupWorklet as ReturnType<typeof vi.fn>).mockResolvedValue(workletNode);

      const capture = createMicCapture({ onPcmFrame: vi.fn(), onError: vi.fn() });
      await capture.start();
      await capture.stop();

      expect(track.stop).toHaveBeenCalled();
      expect(workletNode.disconnect).toHaveBeenCalled();
      expect(currentFakeCtx.close).toHaveBeenCalled();
    });

    it('removes the devicechange listener on stop', async () => {
      const stream = fakeStream([fakeTrack()]);
      const workletNode = fakeWorkletNode();
      mockGetUserMedia.mockResolvedValue(stream);
      (setupWorklet as ReturnType<typeof vi.fn>).mockResolvedValue(workletNode);

      const capture = createMicCapture({ onPcmFrame: vi.fn(), onError: vi.fn() });
      await capture.start();
      await capture.stop();

      expect(mockRemoveEventListener).toHaveBeenCalledWith('devicechange', expect.any(Function));
    });

    it('is safe to call stop() without start()', async () => {
      const capture = createMicCapture({ onPcmFrame: vi.fn(), onError: vi.fn() });
      await expect(capture.stop()).resolves.not.toThrow();
    });
  });
});
