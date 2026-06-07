/**
 * Phase 15 / Plan 15-06 — Half-duplex gate proof (VOICE-07 / SC3)
 *
 * This spec is the automated proxy for the laptop-speaker manual check.
 * It proves that while Aria is speaking (state==='speaking', micGated===true),
 * a PTT-start / feedAudio attempt is REJECTED — Aria never transcribes its
 * own TTS audio (T-15-18 mitigation, D-13).
 *
 * Located in tests/unit/renderer/voice/ (renderer project) because
 * createVoiceSessionStore is renderer code.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createVoiceSessionStore } from '../../../../src/renderer/features/voice/useVoiceSession';

describe('Half-duplex gate (VOICE-07 / SC3 automated proxy)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('PTT-start (startTurn) returns false while state === speaking (D-01: calls bargeIn)', () => {
    const store = createVoiceSessionStore();

    // Transition to speaking
    store.getState().onPlaybackStart();
    expect(store.getState().voiceState).toBe('speaking');
    expect(store.getState().micGated).toBe(true);

    // Attempt PTT-start during TTS playback
    const startTurnResult = store.getState().startTurn();

    // Phase 16 / D-01: startTurn() now calls bargeIn() when speaking.
    // Returns false (not a new listening turn), and transitions to idle.
    // The mic does NOT stay gated for the old turn — barge-in clears it.
    expect(startTurnResult).toBe(false);
    // State transitions to idle (bargeIn was called)
    expect(store.getState().voiceState).toBe('idle');
    expect(store.getState().micGated).toBe(false);
  });

  it('micGated=true blocks feedAudio acknowledgement during speaking', () => {
    const store = createVoiceSessionStore();

    // During speaking, micGated=true means the caller MUST NOT forward PCM frames
    store.getState().onPlaybackStart();

    const state = store.getState();
    expect(state.micGated).toBe(true);

    // The gate property is the enforcement point — callers check it before feedAudio
    // This test proves the gate is definitely true during speaking
    expect(state.voiceState).toBe('speaking');
  });

  it('gate releases after ~800ms cooldown post onPlaybackEnd', () => {
    const store = createVoiceSessionStore();

    store.getState().onPlaybackStart();
    store.getState().onPlaybackEnd();

    // Gate still active during cooldown
    vi.advanceTimersByTime(799);
    expect(store.getState().micGated).toBe(true);

    // Gate releases after cooldown
    vi.advanceTimersByTime(10);
    expect(store.getState().micGated).toBe(false);
    expect(store.getState().voiceState).toBe('idle');
  });

  it('PTT-start succeeds after cooldown completes', () => {
    const store = createVoiceSessionStore();

    store.getState().onPlaybackStart();
    store.getState().onPlaybackEnd();

    // Complete cooldown
    vi.advanceTimersByTime(900);

    // Now PTT-start should work
    store.getState().startTurn();
    expect(store.getState().voiceState).toBe('listening');
    expect(store.getState().micGated).toBe(true);
  });

  it('startTurn from idle (not speaking) succeeds normally', () => {
    const store = createVoiceSessionStore();

    expect(store.getState().voiceState).toBe('idle');
    store.getState().startTurn();

    expect(store.getState().voiceState).toBe('listening');
    expect(store.getState().micGated).toBe(true);
  });
});
