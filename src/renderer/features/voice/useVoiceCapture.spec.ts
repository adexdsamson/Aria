/**
 * Phase 260609-lq3 — useVoiceCapture spec.
 *
 * Drives voiceState transitions via renderHook + rerender and verifies
 * the full capture/flush/discard/error lifecycle.
 *
 * Injection: createCapture + feedAudio via opts so no real mic or IPC needed.
 */

import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MicCaptureCallbacks, MicCaptureHandle } from './capture/useMicCapture';
import type { createMicCapture } from './capture/useMicCapture';
import type { VoiceSessionState, VoiceSessionActions } from './useVoiceSession';
import { useVoiceCapture } from './useVoiceCapture';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeHandle(): {
  handle: MicCaptureHandle;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
} {
  const start = vi.fn().mockResolvedValue(undefined);
  const stop = vi.fn().mockResolvedValue(undefined);
  const handle: MicCaptureHandle = { start, stop };
  return { handle, start, stop };
}

type CapturedCallbacks = MicCaptureCallbacks | null;

function makeCreateCapture(handle: MicCaptureHandle): {
  createCapture: typeof createMicCapture;
  capturedCallbacks: { value: CapturedCallbacks };
} {
  const capturedCallbacks: { value: CapturedCallbacks } = { value: null };
  const createCapture = vi.fn((cbs: MicCaptureCallbacks) => {
    capturedCallbacks.value = cbs;
    return handle;
  }) as unknown as typeof createMicCapture;
  return { createCapture, capturedCallbacks };
}

function makeSession(voiceState: VoiceSessionState['voiceState'] = 'idle'): VoiceSessionState & VoiceSessionActions {
  return {
    voiceState,
    micGated: false,
    liveTranscript: '',
    modelProgress: null,
    paused: false,
    pendingApprovalId: null,
    startTurn: vi.fn().mockReturnValue(true),
    stopTurn: vi.fn(),
    setVadMode: vi.fn(),
    setTranscript: vi.fn(),
    endTurn: vi.fn(),
    onPlaybackStart: vi.fn(),
    onPlaybackEnd: vi.fn(),
    bargeIn: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    setPendingApproval: vi.fn(),
    clearPendingApproval: vi.fn(),
    subscribeToIpc: vi.fn().mockReturnValue(() => {}),
  };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('useVoiceCapture', () => {
  let dispatchEventSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dispatchEventSpy = vi.spyOn(window, 'dispatchEvent').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // (a) start-turn: voiceState→'listening' calls capture.start()
  it('(a) calls capture.start() when voiceState transitions to listening', () => {
    const { handle, start } = makeHandle();
    const { createCapture } = makeCreateCapture(handle);
    const feedAudio = vi.fn().mockResolvedValue({ ok: true });

    const idleSession = makeSession('idle');
    const listeningSession = makeSession('listening');

    const { rerender } = renderHook(
      ({ session }: { session: VoiceSessionState & VoiceSessionActions }) =>
        useVoiceCapture(session, { createCapture, feedAudio }),
      { initialProps: { session: idleSession } },
    );

    // Transition idle → listening
    rerender({ session: listeningSession });

    expect(createCapture).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
  });

  // (b) frames accumulate via onPcmFrame
  it('(b) accumulates PCM frames via the onPcmFrame callback', () => {
    const { handle } = makeHandle();
    const { createCapture, capturedCallbacks } = makeCreateCapture(handle);
    const feedAudio = vi.fn().mockResolvedValue({ ok: true });

    const idleSession = makeSession('idle');
    const listeningSession = makeSession('listening');

    renderHook(
      ({ session }: { session: VoiceSessionState & VoiceSessionActions }) =>
        useVoiceCapture(session, { createCapture, feedAudio }),
      { initialProps: { session: idleSession } },
    );

    // Start listening — captures callbacks
    const { rerender } = renderHook(
      ({ session }: { session: VoiceSessionState & VoiceSessionActions }) =>
        useVoiceCapture(session, { createCapture, feedAudio }),
      { initialProps: { session: idleSession } },
    );
    rerender({ session: listeningSession });

    // Push two frames
    expect(capturedCallbacks.value).not.toBeNull();
    capturedCallbacks.value!.onPcmFrame(new Uint8Array([1, 2]).buffer);
    capturedCallbacks.value!.onPcmFrame(new Uint8Array([3, 4]).buffer);

    // Frames are accumulated (will be verified in test (c))
    expect(capturedCallbacks.value).not.toBeNull();
  });

  // (c) stopTurn (listening→processing) flushes concatenated buffer to feedAudio exactly once
  it('(c) flushes concatenated PCM buffer to feedAudio on listening→processing transition', async () => {
    const { handle, stop } = makeHandle();
    const { createCapture, capturedCallbacks } = makeCreateCapture(handle);
    const feedAudio = vi.fn().mockResolvedValue({ ok: true });
    const endTurn = vi.fn();

    const idleSession = makeSession('idle');
    const listeningSession = makeSession('listening');
    const processingSession = { ...makeSession('processing'), endTurn };

    const { rerender } = renderHook(
      ({ session }: { session: VoiceSessionState & VoiceSessionActions }) =>
        useVoiceCapture(session, { createCapture, feedAudio }),
      { initialProps: { session: idleSession } },
    );

    // idle → listening
    rerender({ session: listeningSession });

    // Push two known frames
    capturedCallbacks.value!.onPcmFrame(new Uint8Array([1, 2]).buffer);
    capturedCallbacks.value!.onPcmFrame(new Uint8Array([3, 4]).buffer);

    // listening → processing (stopTurn)
    rerender({ session: processingSession });

    // Wait for async flush
    await vi.waitFor(() => expect(feedAudio).toHaveBeenCalledOnce());

    expect(stop).toHaveBeenCalledOnce();
    const sentBuffer = feedAudio.mock.calls[0][0] as ArrayBuffer;
    expect(sentBuffer.byteLength).toBe(4);
    expect(Array.from(new Uint8Array(sentBuffer))).toEqual([1, 2, 3, 4]);
    expect(endTurn).toHaveBeenCalledOnce();
  });

  // (d) zero frames → feedAudio NOT called, but endTurn IS called
  it('(d) does NOT call feedAudio on zero-byte turn; still calls endTurn', async () => {
    const { handle } = makeHandle();
    const { createCapture } = makeCreateCapture(handle);
    const feedAudio = vi.fn().mockResolvedValue({ ok: true });
    const endTurn = vi.fn();

    const idleSession = makeSession('idle');
    const listeningSession = makeSession('listening');
    const processingSession = { ...makeSession('processing'), endTurn };

    const { rerender } = renderHook(
      ({ session }: { session: VoiceSessionState & VoiceSessionActions }) =>
        useVoiceCapture(session, { createCapture, feedAudio }),
      { initialProps: { session: idleSession } },
    );

    // idle → listening (no frames pushed)
    rerender({ session: listeningSession });

    // listening → processing
    rerender({ session: processingSession });

    // Wait for async path to complete
    await vi.waitFor(() => expect(endTurn).toHaveBeenCalledOnce());

    expect(feedAudio).not.toHaveBeenCalled();
  });

  // (e) bargeIn (idle without processing) → capture.stop() called, feedAudio NOT called
  it('(e) calls capture.stop() and discards buffer on bargeIn (listening→idle)', async () => {
    const { handle, stop } = makeHandle();
    const { createCapture, capturedCallbacks } = makeCreateCapture(handle);
    const feedAudio = vi.fn().mockResolvedValue({ ok: true });
    const endTurn = vi.fn();

    const idleSession1 = makeSession('idle');
    const listeningSession = makeSession('listening');
    const idleSession2 = { ...makeSession('idle'), endTurn };

    const { rerender } = renderHook(
      ({ session }: { session: VoiceSessionState & VoiceSessionActions }) =>
        useVoiceCapture(session, { createCapture, feedAudio }),
      { initialProps: { session: idleSession1 } },
    );

    // idle → listening
    rerender({ session: listeningSession });
    // Push a frame
    capturedCallbacks.value!.onPcmFrame(new Uint8Array([5, 6, 7]).buffer);

    // listening → idle (bargeIn path)
    rerender({ session: idleSession2 });

    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());

    expect(feedAudio).not.toHaveBeenCalled();
    // endTurn is NOT called on bargeIn discard (session transitions externally)
    expect(endTurn).not.toHaveBeenCalled();
  });

  // (f) onError → capture.stop(), feedAudio NOT called, endTurn called, aria:toast dispatched
  it('(f) onError: stops capture, dispatches aria:toast, calls endTurn, never calls feedAudio', async () => {
    const { handle, stop } = makeHandle();
    const { createCapture, capturedCallbacks } = makeCreateCapture(handle);
    const feedAudio = vi.fn().mockResolvedValue({ ok: true });
    const endTurn = vi.fn();

    const idleSession = makeSession('idle');
    const listeningSession = { ...makeSession('listening'), endTurn };

    const { rerender } = renderHook(
      ({ session }: { session: VoiceSessionState & VoiceSessionActions }) =>
        useVoiceCapture(session, { createCapture, feedAudio }),
      { initialProps: { session: idleSession } },
    );

    // idle → listening
    rerender({ session: listeningSession });

    const errMsg = 'Microphone permission denied — check your system settings';
    capturedCallbacks.value!.onError({
      type: 'permission-denied',
      message: errMsg,
    });

    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());

    expect(feedAudio).not.toHaveBeenCalled();
    expect(endTurn).toHaveBeenCalledOnce();

    // aria:toast CustomEvent dispatched with shape { kind: 'error', message }
    expect(dispatchEventSpy).toHaveBeenCalledOnce();
    const evt = dispatchEventSpy.mock.calls[0][0] as CustomEvent;
    expect(evt.type).toBe('aria:toast');
    expect(evt.detail).toMatchObject({ kind: 'error', message: errMsg });
  });
});
