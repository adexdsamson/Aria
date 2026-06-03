/**
 * Phase 15 / Plan 15-04 — Renderer mic capture hook.
 *
 * Implements D-19 / D-20 (CONTEXT.md, RESEARCH §Pattern 2/§Pattern 5):
 *   - navigator.mediaDevices.getUserMedia({ audio: true }) — NOT desktopCapturer
 *     (Windows renderer-crash bugs #42765/#46369)
 *   - AudioContext at sampleRate 16000 for renderer-side resample (D-19)
 *   - AudioWorklet via setupWorklet (mic-worklet.ts Blob-URL loader, Plan 15-01 CSP fix)
 *   - PCM frames from port.onmessage → transferable ArrayBuffers → onPcmFrame callback
 *     (Plan 15-05 will forward these over voiceFeedAudio IPC)
 *   - Device hot-swap (devicechange) re-acquires without crash (D-20 / SC5)
 *   - Permission-denied (NotAllowedError) → structured onError (D-20 / SC5)
 *     No unhandled rejection takes down the renderer (STRIDE T-15-11)
 *
 * This module exports createMicCapture() — a factory that returns { start, stop }.
 * The calling component (useMicCapture React hook wrapper, or VoicePTTButton) owns
 * the lifecycle. This design makes the core testable without React hooks.
 *
 * Error copy strings come from UI-SPEC §Copywriting:
 *   "Microphone permission denied — check your system settings"
 *   "Audio device disconnected"
 */

import { setupWorklet } from './mic-worklet';

// ─── public types ──────────────────────────────────────────────────────────

export interface MicCaptureError {
  /** Discriminant for consumer routing (ToastHost + HUD error state). */
  type: 'permission-denied' | 'device-lost' | 'capture-error';
  /** Human-readable message matching UI-SPEC copywriting. */
  message: string;
  /** Underlying cause for logging. */
  cause?: unknown;
}

export interface MicCaptureCallbacks {
  /** Called with each 16 kHz mono PCM frame as a transferable ArrayBuffer. */
  onPcmFrame: (buffer: ArrayBuffer) => void;
  /**
   * Called with a structured error instead of throwing (D-20/SC5, STRIDE T-15-11).
   * Consumers route to ToastHost + VoiceHUDBand error state.
   */
  onError: (err: MicCaptureError) => void;
}

export interface MicCaptureHandle {
  /** Acquire mic, setup worklet, start streaming PCM frames. */
  start: () => Promise<void>;
  /** Stop all tracks, disconnect worklet, close context, remove listeners. */
  stop: () => Promise<void>;
}

// ─── implementation ────────────────────────────────────────────────────────

/**
 * Factory for the mic capture pipeline.
 * Returns { start, stop } — no React hooks, fully unit-testable.
 *
 * Usage in a React hook:
 * ```tsx
 * const captureRef = useRef<MicCaptureHandle | null>(null);
 * useEffect(() => {
 *   captureRef.current = createMicCapture({ onPcmFrame, onError });
 *   return () => { captureRef.current?.stop(); };
 * }, []);
 * ```
 */
export function createMicCapture(callbacks: MicCaptureCallbacks): MicCaptureHandle {
  const { onPcmFrame, onError } = callbacks;

  // Mutable state (not React state — this is a plain object factory)
  let audioCtx: AudioContext | null = null;
  let workletNode: AudioWorkletNode | null = null;
  let currentTracks: MediaStreamTrack[] = [];
  let deviceChangeHandler: (() => Promise<void>) | null = null;

  // ─── internal helpers ────────────────────────────────────────────────────

  function stopCurrentTracks(): void {
    for (const track of currentTracks) {
      try { track.stop(); } catch { /* best-effort */ }
    }
    currentTracks = [];
  }

  function disconnectWorklet(): void {
    if (workletNode) {
      try { workletNode.disconnect(); } catch { /* best-effort */ }
      workletNode = null;
    }
  }

  async function closeContext(): Promise<void> {
    if (audioCtx) {
      try { await audioCtx.close(); } catch { /* best-effort */ }
      audioCtx = null;
    }
  }

  function removeDeviceChangeListener(): void {
    if (deviceChangeHandler) {
      navigator.mediaDevices.removeEventListener('devicechange', deviceChangeHandler);
      deviceChangeHandler = null;
    }
  }

  /**
   * Core acquisition: getUserMedia → AudioContext → setupWorklet → wire source.
   * Throws on failure — callers catch and route to onError.
   */
  async function acquire(): Promise<void> {
    // D-19: getUserMedia for mic — NOT desktopCapturer
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    currentTracks = stream.getAudioTracks ? stream.getAudioTracks() : [];

    // Create a 16 kHz AudioContext for renderer-side resample (D-19)
    audioCtx = new AudioContext({ sampleRate: 16000 });

    // Setup inline-Blob-URL worklet (mic-worklet.ts, depends on Plan 15-01 CSP fix)
    workletNode = await setupWorklet(audioCtx);

    // Wire: source → workletNode
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(workletNode);

    // Forward PCM frames to caller as transferable ArrayBuffers (D-19)
    workletNode.port.onmessage = (event: MessageEvent<{ pcm: ArrayBuffer }>) => {
      if (event.data?.pcm) {
        onPcmFrame(event.data.pcm);
      }
    };
  }

  // ─── public API ───────────────────────────────────────────────────────────

  async function start(): Promise<void> {
    try {
      await acquire();

      // Register devicechange listener for hot-swap (D-20/SC5)
      deviceChangeHandler = async () => {
        // Stop old tracks before re-acquiring
        stopCurrentTracks();
        disconnectWorklet();
        // Do NOT close the AudioContext — reuse it across device changes

        try {
          await acquire();
        } catch {
          onError({
            type: 'device-lost',
            message: 'Audio device disconnected',  // UI-SPEC §Copywriting
          });
        }
      };

      navigator.mediaDevices.addEventListener('devicechange', deviceChangeHandler);
    } catch (err: unknown) {
      // Route getUserMedia errors to onError — NEVER let them be unhandled (T-15-11)
      if (isPermissionDenied(err)) {
        onError({
          type: 'permission-denied',
          // UI-SPEC §Copywriting — exact copy
          message: 'Microphone permission denied — check your system settings',
          cause: err,
        });
      } else {
        onError({
          type: 'capture-error',
          message: (err instanceof Error) ? err.message : 'Microphone capture failed',
          cause: err,
        });
      }
    }
  }

  async function stop(): Promise<void> {
    removeDeviceChangeListener();
    stopCurrentTracks();
    disconnectWorklet();
    await closeContext();
  }

  return { start, stop };
}

// ─── React hook wrapper ────────────────────────────────────────────────────

/**
 * useMicCapture — React hook wrapping createMicCapture.
 *
 * Returns { start, stop } stable refs. Cleans up on unmount.
 * Consumers (VoicePTTButton, useVoiceSession) call start()/stop() directly.
 */
import { useRef, useEffect } from 'react';

export function useMicCapture(callbacks: MicCaptureCallbacks): MicCaptureHandle {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const handleRef = useRef<MicCaptureHandle | null>(null);

  useEffect(() => {
    const stableCallbacks: MicCaptureCallbacks = {
      onPcmFrame: (buf) => callbacksRef.current.onPcmFrame(buf),
      onError: (err) => callbacksRef.current.onError(err),
    };
    const handle = createMicCapture(stableCallbacks);
    handleRef.current = handle;

    return () => {
      handle.stop().catch(() => { /* best-effort on unmount */ });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Return a stable object that delegates to the current handle
  const stableHandle = useRef<MicCaptureHandle>({
    start: () => handleRef.current?.start() ?? Promise.resolve(),
    stop: () => handleRef.current?.stop() ?? Promise.resolve(),
  });

  return stableHandle.current;
}

// ─── helpers ──────────────────────────────────────────────────────────────

function isPermissionDenied(err: unknown): boolean {
  if (err instanceof DOMException) {
    return err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';
  }
  return false;
}
