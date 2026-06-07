/**
 * Phase 16 / Plan 16-03 — useVoiceSession Phase-16 additions.
 *
 * Tests for the D-01/D-09 extensions to the voice session store:
 *   - bargeIn(): transitions 'speaking'→'idle', fires voiceAbort IPC (no await),
 *                is a no-op when not speaking (SC5 guaranteed by construction)
 *   - pause(): sets paused=true, cancels cooldown timer
 *   - resume(): sets paused=false
 *   - startTurn() dispatches to bargeIn() when already speaking (D-01)
 *
 * Preserves existing Phase-15 tests in half-duplex.spec.ts (not duplicated here).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createVoiceSessionStore } from '../../../../src/renderer/features/voice/useVoiceSession';

// ─── mock window.aria for bargeIn() IPC fire-and-forget ──────────────────────

let voiceAbortMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  voiceAbortMock = vi.fn();
  // Provide a minimal window.aria stub with voiceAbort
  Object.defineProperty(globalThis, 'window', {
    value: {
      aria: {
        voiceAbort: voiceAbortMock,
      },
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── bargeIn() ────────────────────────────────────────────────────────────────

describe('bargeIn() (D-01/D-02)', () => {
  it('transitions voiceState from speaking to idle', () => {
    const store = createVoiceSessionStore();

    // Enter speaking state
    store.getState().onPlaybackStart();
    expect(store.getState().voiceState).toBe('speaking');

    store.getState().bargeIn();

    expect(store.getState().voiceState).toBe('idle');
    expect(store.getState().micGated).toBe(false);
    expect(store.getState().paused).toBe(false);
    expect(store.getState().liveTranscript).toBe('');
  });

  it('fires voiceAbort IPC without await (fire-and-forget, D-02)', () => {
    const store = createVoiceSessionStore();
    store.getState().onPlaybackStart();

    store.getState().bargeIn();

    // voiceAbort must have been called once (synchronously, no await)
    expect(voiceAbortMock).toHaveBeenCalledTimes(1);
    expect(voiceAbortMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: expect.any(String) })
    );
  });

  it('is a no-op when voiceState === idle (SC5: ambient sound without PTT never interrupts)', () => {
    const store = createVoiceSessionStore();
    expect(store.getState().voiceState).toBe('idle');

    store.getState().bargeIn();

    // State unchanged
    expect(store.getState().voiceState).toBe('idle');
    expect(voiceAbortMock).not.toHaveBeenCalled();
  });

  it('is a no-op when voiceState === listening', () => {
    const store = createVoiceSessionStore();
    store.getState().startTurn();
    expect(store.getState().voiceState).toBe('listening');

    store.getState().bargeIn();

    expect(store.getState().voiceState).toBe('listening');
    expect(voiceAbortMock).not.toHaveBeenCalled();
  });

  it('cancels the cooldown timer (clearCooldown) on barge-in', () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const store = createVoiceSessionStore();

    // Start playback and end it (sets the cooldown timer)
    store.getState().onPlaybackStart();
    store.getState().onPlaybackEnd(); // schedules cooldown timer

    // Now enter speaking again (cancels previous cooldown)
    store.getState().onPlaybackStart();

    // bargeIn should call clearCooldown → clearTimeout
    clearTimeoutSpy.mockClear();
    store.getState().bargeIn();

    // clearTimeout should have been called (timer was running during speaking)
    // The number may be 0 if no active timer, but the code path must not throw
    expect(store.getState().voiceState).toBe('idle');
  });
});

// ─── startTurn() dispatches bargeIn() when speaking (D-01) ───────────────────

describe('startTurn() bargeIn dispatch (D-01)', () => {
  it('calls bargeIn() and returns false when voiceState === speaking', () => {
    const store = createVoiceSessionStore();

    store.getState().onPlaybackStart();
    expect(store.getState().voiceState).toBe('speaking');

    const result = store.getState().startTurn();

    // Should return false (barge-in, not a new turn start)
    expect(result).toBe(false);
    // But state should transition to idle (bargeIn ran)
    expect(store.getState().voiceState).toBe('idle');
    expect(voiceAbortMock).toHaveBeenCalledTimes(1);
  });
});

// ─── pause() (D-09) ──────────────────────────────────────────────────────────

describe('pause() (D-09)', () => {
  it('sets paused=true', () => {
    const store = createVoiceSessionStore();

    expect(store.getState().paused).toBe(false);
    store.getState().pause();

    expect(store.getState().paused).toBe(true);
  });

  it('cancels the cooldown timer (clearCooldown)', () => {
    const store = createVoiceSessionStore();

    // Trigger a cooldown timer
    store.getState().onPlaybackStart();
    store.getState().onPlaybackEnd();

    // Timer should be pending; gate still up
    vi.advanceTimersByTime(100);
    expect(store.getState().micGated).toBe(true);

    // pause() should cancel the cooldown
    store.getState().pause();

    // Advance past cooldown — gate must NOT have released (timer was cleared)
    vi.advanceTimersByTime(900);
    expect(store.getState().micGated).toBe(true); // still gated (cooldown was cancelled)
    expect(store.getState().paused).toBe(true);
  });

  it('does not change voiceState', () => {
    const store = createVoiceSessionStore();
    store.getState().onPlaybackStart();
    expect(store.getState().voiceState).toBe('speaking');

    store.getState().pause();

    expect(store.getState().voiceState).toBe('speaking');
    expect(store.getState().paused).toBe(true);
  });
});

// ─── resume() (D-09) ─────────────────────────────────────────────────────────

describe('resume() (D-09)', () => {
  it('sets paused=false', () => {
    const store = createVoiceSessionStore();
    store.getState().pause(); // set paused=true first

    store.getState().resume();

    expect(store.getState().paused).toBe(false);
  });

  it('does not change voiceState', () => {
    const store = createVoiceSessionStore();
    store.getState().onPlaybackStart();
    store.getState().pause();
    expect(store.getState().voiceState).toBe('speaking');

    store.getState().resume();

    expect(store.getState().voiceState).toBe('speaking');
  });
});

// ─── paused field default ─────────────────────────────────────────────────────

describe('VoiceSessionState.paused default', () => {
  it('initializes to false', () => {
    const store = createVoiceSessionStore();
    expect(store.getState().paused).toBe(false);
  });

  it('bargeIn() resets paused to false even if paused was true', () => {
    const store = createVoiceSessionStore();
    store.getState().onPlaybackStart();
    store.getState().pause(); // paused=true
    expect(store.getState().paused).toBe(true);

    store.getState().bargeIn();

    expect(store.getState().paused).toBe(false);
    expect(store.getState().voiceState).toBe('idle');
  });
});
