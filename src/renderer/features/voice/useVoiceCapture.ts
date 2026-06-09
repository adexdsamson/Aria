/**
 * Phase 260609-lq3 — Renderer mic-capture → STT feed wiring hook.
 *
 * Reacts to voiceState changes from the flat VoiceSessionState & VoiceSessionActions
 * snapshot, drives the createMicCapture lifecycle, accumulates PCM frames per turn,
 * and flushes a concatenated ArrayBuffer to window.aria.voiceFeedAudio on turn-end.
 *
 * Threat mitigations (from plan threat model):
 *   T-lq3-01: Zero-PCM guard — no feedAudio call on 0-byte buffer; endTurn always called.
 *   T-lq3-02: Capture only starts on 'listening' (gate enforced by useEffect condition).
 *   T-lq3-03: feedAudio wrapped in try/finally so session never hangs in 'processing'.
 */

import { useEffect, useRef } from 'react';
import {
  createMicCapture,
  type MicCaptureHandle,
} from './capture/useMicCapture';
import type { VoiceSessionState, VoiceSessionActions } from './useVoiceSession';

// ─── injection interface ──────────────────────────────────────────────────────

export interface VoiceCaptureOpts {
  /**
   * Injectable factory for testability. Defaults to createMicCapture from
   * capture/useMicCapture.
   */
  createCapture?: typeof createMicCapture;
  /**
   * Injectable feedAudio for testability. Defaults to window.aria.voiceFeedAudio.
   */
  feedAudio?: (buf: ArrayBuffer) => Promise<unknown>;
}

// ─── hook ─────────────────────────────────────────────────────────────────────

/**
 * useVoiceCapture — drives mic capture lifecycle from voiceState transitions.
 *
 * @param session - Flat VoiceSessionState & VoiceSessionActions snapshot from useVoiceSession().
 * @param opts    - Injectable createCapture + feedAudio for testing.
 */
export function useVoiceCapture(
  session: VoiceSessionState & VoiceSessionActions,
  opts: VoiceCaptureOpts = {},
): void {
  const captureRef = useRef<MicCaptureHandle | null>(null);
  const framesRef = useRef<ArrayBuffer[]>([]);
  const prevStateRef = useRef<VoiceSessionState['voiceState']>(session.voiceState);

  // Stable resolved opts refs (avoid stale closure from re-renders)
  const resolvedCreateCapture = opts.createCapture ?? createMicCapture;
  const resolvedFeedAudio: (buf: ArrayBuffer) => Promise<unknown> =
    opts.feedAudio ??
    ((buf: ArrayBuffer) => {
      const api = typeof window !== 'undefined' ? (window as { aria?: { voiceFeedAudio?: (buf: ArrayBuffer) => Promise<unknown> } }).aria : undefined;
      return api?.voiceFeedAudio?.(buf) ?? Promise.resolve();
    });

  // Use refs so the effect closure always gets the latest values
  const createCaptureRef = useRef(resolvedCreateCapture);
  const feedAudioRef = useRef(resolvedFeedAudio);
  createCaptureRef.current = resolvedCreateCapture;
  feedAudioRef.current = resolvedFeedAudio;

  // Session ref — stable access inside async closures
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    const curr = session.voiceState;
    const prev = prevStateRef.current;
    prevStateRef.current = curr;

    if (prev !== 'listening' && curr === 'listening') {
      // ── Start a fresh turn ──────────────────────────────────────────────
      framesRef.current = [];

      const handle = createCaptureRef.current({
        onPcmFrame(buf: ArrayBuffer): void {
          framesRef.current.push(buf);
        },
        onError(err): void {
          // Stop capture — use captureRef so we never have a closure-before-assignment issue
          void captureRef.current?.stop();
          captureRef.current = null;
          framesRef.current = [];

          // Surface toast via DOM event bus (mirrors useVoiceConfirm.ts:63 pattern)
          if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(
              new CustomEvent('aria:toast', {
                detail: { kind: 'error', message: err.message },
              }),
            );
          }

          // Return session to idle — NEVER leave it hanging in 'processing'
          sessionRef.current.endTurn();
        },
      });

      captureRef.current = handle;
      void handle.start();

    } else if (prev === 'listening' && curr === 'processing') {
      // ── Stop + flush ────────────────────────────────────────────────────
      const handle = captureRef.current;
      captureRef.current = null;
      const frames = framesRef.current;
      framesRef.current = [];

      void (async () => {
        if (handle) await handle.stop();

        const totalBytes = frames.reduce((n, f) => n + f.byteLength, 0);

        // T-lq3-01: Zero-PCM guard — no IPC call on empty buffer
        if (totalBytes === 0) {
          sessionRef.current.endTurn();
          return;
        }

        // Concatenate Int16 frames byte-accurately into a single ArrayBuffer
        const out = new Uint8Array(totalBytes);
        let offset = 0;
        for (const f of frames) {
          out.set(new Uint8Array(f), offset);
          offset += f.byteLength;
        }

        // T-lq3-03: always call endTurn in finally path — session must not hang
        try {
          await feedAudioRef.current(out.buffer);
        } finally {
          sessionRef.current.endTurn();
        }
      })();

    } else if (curr === 'idle' && captureRef.current !== null) {
      // ── bargeIn / back-to-idle: stop + discard ──────────────────────────
      const handle = captureRef.current;
      captureRef.current = null;
      framesRef.current = [];
      void handle.stop();
    }
  }, [session.voiceState]); // eslint-disable-line react-hooks/exhaustive-deps
}
