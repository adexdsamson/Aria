/**
 * Phase 15 / Plan 15-06 — useVoiceSession TDD spec
 *
 * Tests the Zustand-equivalent voice session store (state machine + IPC subscriptions).
 * Uses React's useReducer+Context under the hood (Zustand not installed).
 *
 * Acceptance criteria:
 *   - createVoiceSessionStore exposes a state machine: idle→listening→processing→speaking→idle
 *   - micGated is true during listening, processing, and speaking states
 *   - startTurn() is blocked while state === 'speaking' (D-13 half-duplex gate)
 *   - onPlaybackStart sets state='speaking' + micGated=true
 *   - onPlaybackEnd schedules micGated=false after ~800ms cooldown then state='idle' (D-13)
 *   - IPC subscriptions: window.aria.onVoiceTranscript / onVoiceState / onVoiceModelProgress
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createVoiceSessionStore } from './useVoiceSession';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeAriaApi(overrides?: {
  onVoiceTranscript?: (cb: (d: unknown) => void) => () => void;
  onVoiceState?: (cb: (d: unknown) => void) => () => void;
  onVoiceModelProgress?: (cb: (d: unknown) => void) => () => void;
}) {
  return {
    onVoiceTranscript: overrides?.onVoiceTranscript ?? vi.fn(() => vi.fn()),
    onVoiceState: overrides?.onVoiceState ?? vi.fn(() => vi.fn()),
    onVoiceModelProgress: overrides?.onVoiceModelProgress ?? vi.fn(() => vi.fn()),
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('createVoiceSessionStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initial state is idle with micGated=false', () => {
    const store = createVoiceSessionStore();
    const state = store.getState();
    expect(state.voiceState).toBe('idle');
    expect(state.micGated).toBe(false);
  });

  it('startTurn() transitions to listening and sets micGated=true', () => {
    const store = createVoiceSessionStore();
    store.getState().startTurn();
    const state = store.getState();
    expect(state.voiceState).toBe('listening');
    expect(state.micGated).toBe(true);
  });

  it('startTurn() is blocked (no-op) while state === speaking (D-13 half-duplex gate)', () => {
    const store = createVoiceSessionStore();
    // Simulate speaking state by calling onPlaybackStart
    store.getState().onPlaybackStart();
    expect(store.getState().voiceState).toBe('speaking');

    // Attempt PTT start while speaking — must be rejected
    store.getState().startTurn();

    // State must remain speaking, not listening
    expect(store.getState().voiceState).toBe('speaking');
    expect(store.getState().micGated).toBe(true);
  });

  it('onPlaybackStart sets state=speaking and micGated=true', () => {
    const store = createVoiceSessionStore();
    store.getState().onPlaybackStart();
    const state = store.getState();
    expect(state.voiceState).toBe('speaking');
    expect(state.micGated).toBe(true);
  });

  it('onPlaybackEnd schedules micGated=false after ~800ms cooldown', () => {
    const store = createVoiceSessionStore();

    // Enter speaking state
    store.getState().onPlaybackStart();
    expect(store.getState().voiceState).toBe('speaking');

    // Trigger playback end
    store.getState().onPlaybackEnd();

    // Before cooldown, micGated should still be true (or state transitioning)
    // The cooldown is ~800ms so before that passes, gate should still be active
    vi.advanceTimersByTime(400);
    expect(store.getState().micGated).toBe(true);

    // After ~800ms, micGated should be false and state should be idle
    vi.advanceTimersByTime(500);
    const stateAfter = store.getState();
    expect(stateAfter.micGated).toBe(false);
    expect(stateAfter.voiceState).toBe('idle');
  });

  it('setTranscript updates liveTranscript', () => {
    const store = createVoiceSessionStore();
    store.getState().startTurn();
    store.getState().setTranscript('hello world', false);
    expect(store.getState().liveTranscript).toBe('hello world');
  });

  it('setTranscript with final=true transitions to processing then idle', () => {
    const store = createVoiceSessionStore();
    store.getState().startTurn();
    store.getState().setTranscript('final text', true);
    // After final transcript, should move to processing
    expect(store.getState().voiceState).toBe('processing');
    expect(store.getState().liveTranscript).toBe('final text');
  });

  it('endTurn() from processing transitions to idle', () => {
    const store = createVoiceSessionStore();
    store.getState().startTurn();
    store.getState().setTranscript('done', true);
    store.getState().endTurn();
    expect(store.getState().voiceState).toBe('idle');
    expect(store.getState().micGated).toBe(false);
  });

  it('subscribe() IPC channels and returns an unsubscribe function', () => {
    const unsubTranscript = vi.fn();
    const unsubState = vi.fn();
    const unsubProgress = vi.fn();

    const ariaApi = makeAriaApi({
      onVoiceTranscript: vi.fn(() => unsubTranscript),
      onVoiceState: vi.fn(() => unsubState),
      onVoiceModelProgress: vi.fn(() => unsubProgress),
    });

    const store = createVoiceSessionStore();
    const unsubscribe = store.subscribeToIpc(ariaApi as unknown as Window['aria']);

    expect(ariaApi.onVoiceTranscript).toHaveBeenCalledTimes(1);
    expect(ariaApi.onVoiceState).toHaveBeenCalledTimes(1);
    expect(ariaApi.onVoiceModelProgress).toHaveBeenCalledTimes(1);

    unsubscribe();

    expect(unsubTranscript).toHaveBeenCalledTimes(1);
    expect(unsubState).toHaveBeenCalledTimes(1);
    expect(unsubProgress).toHaveBeenCalledTimes(1);
  });

  it('VoiceState push sets voiceState on the store', () => {
    let capturedCb: ((d: unknown) => void) | null = null;
    const ariaApi = makeAriaApi({
      onVoiceState: (cb) => {
        capturedCb = cb;
        return vi.fn();
      },
    });

    const store = createVoiceSessionStore();
    store.subscribeToIpc(ariaApi as unknown as Window['aria']);

    expect(capturedCb).not.toBeNull();
    capturedCb!('listening');

    expect(store.getState().voiceState).toBe('listening');
  });
});
