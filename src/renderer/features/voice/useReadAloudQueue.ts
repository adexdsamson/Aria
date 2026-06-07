/**
 * Phase 16 / Plan 16-03 — Shared read-aloud queue hook (D-05/D-07).
 *
 * Implements:
 *   D-05: In-order promise-chain queue for Kokoro TTS playback.
 *         queue = queue.then(() => player.speak(chunk, {speed}))
 *         Natural backpressure: slow synth delays next .then() without blocking.
 *   D-07: Both surfaces (briefing + /ask) route through this single queue,
 *         preventing architectural divergence.
 *   D-02 Pitfall 5 fix: cancel() BOTH resets queueRef (prevents old speech from
 *         resuming mid-new-turn) AND calls player.cancel() (stops current source).
 *
 * Usage:
 *   const queue = useReadAloudQueue(player, speed);
 *   queue.enqueue('First sentence.');
 *   queue.enqueue('Second sentence.');
 *   // on barge-in:
 *   queue.cancel(); // stops current source + prevents queued chunks from playing
 */

import { useRef, useCallback } from 'react';
import type { KokoroPlayerHandle } from './tts/useKokoroPlayer';

// ─── hook ─────────────────────────────────────────────────────────────────────

export interface ReadAloudQueue {
  /** Enqueue a text chunk for TTS playback at the given speed. */
  enqueue(text: string): void;
  /**
   * Cancel all pending and current playback.
   * Resets the promise queue AND calls player.cancel() to stop the active source.
   * D-02 / Pitfall 5: BOTH operations are required.
   */
  cancel(): void;
}

/**
 * useReadAloudQueue — React hook providing an in-order TTS playback queue.
 *
 * @param player  KokoroPlayerHandle (from useKokoroPlayer)
 * @param speed   Playback speed 0.5–2x, passed to player.speak() as options.speed (D-08)
 */
export function useReadAloudQueue(
  player: KokoroPlayerHandle,
  speed: number
): ReadAloudQueue {
  // D-05: promise chain — each speak() appends to the tail.
  // Slow synth naturally backpressures the next .then().
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const enqueue = useCallback(
    (text: string): void => {
      queueRef.current = queueRef.current.then(async () => {
        await player.speak(text, { speed });
      });
    },
    [player, speed]
  );

  const cancel = useCallback((): void => {
    // D-02 / Pitfall 5: BOTH reset queue AND stop current source.
    // Missing the reset causes old speech to resume mid-new-turn.
    queueRef.current = Promise.resolve();
    player.cancel();
  }, [player]);

  return { enqueue, cancel };
}
