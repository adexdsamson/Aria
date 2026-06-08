/**
 * Phase 15 / Plan 15-06 — Voice session store + half-duplex gate.
 * Phase 16 / Plan 16-03 — Barge-in + pause/resume (D-01/D-09).
 * Phase 17 / Plan 17-05 — pendingApprovalId + confirm-aware setTranscript/bargeIn.
 *
 * Implements:
 *   D-13: micGated=true on turn-start AND for the full TTS playback duration;
 *         PTT start blocked while speaking; micGated=false after ~800ms cooldown.
 *   D-17: VoiceState union includes 'speaking' (Phase 16 seam).
 *   VOICE-07: Aria never transcribes its own TTS (the gate enforces this).
 *   D-01: bargeIn() replaces the no-op guard when voiceState==='speaking'.
 *   D-09: pause()/resume() thread paused boolean through state; clearCooldown on pause.
 *   D-10: pendingApprovalId ref — non-null during awaiting-confirm sub-state.
 *         bargeIn() while pendingApprovalId non-null fires voiceCancelApproval IPC
 *         before the existing voiceAbort logic.
 *         setTranscript(text, final=true) with pendingApprovalId non-null routes
 *         to voiceConfirmApproval IPC (confirm classifier path) instead of
 *         voiceFeedAnswer (Pitfall 4 guard).
 *   D-12: After cancel: pendingApprovalId cleared, session returns to idle.
 *
 * Architecture: a minimal observable store (no Zustand dependency — package not
 * installed). Exports createVoiceSessionStore() factory for testing and
 * useVoiceSession() React hook for components.
 *
 * State machine:
 *   idle ──startTurn()──→ listening ──setTranscript(final=true)──→ processing ──endTurn()──→ idle
 *   any  ──onPlaybackStart()──→ speaking ──onPlaybackEnd()──→ (cooldown ~800ms) ──→ idle
 *   speaking ──bargeIn()──→ idle (D-01: fires voiceAbort IPC fire-and-forget)
 *   speaking ──pause()──→ speaking/paused=true (D-09: caller suspends AudioContext)
 *   speaking/paused ──resume()──→ speaking/paused=false (D-09: caller resumes AudioContext)
 *   [awaiting-confirm sub-state: pendingApprovalId non-null]
 *     bargeIn() → voiceCancelApproval + voiceAbort → idle, pendingApprovalId=null
 *     setTranscript(final=true) → voiceConfirmApproval (with transcript) → clears pendingApprovalId
 *
 * IPC push subscriptions:
 *   window.aria.onVoiceTranscript  → setTranscript
 *   window.aria.onVoiceState       → direct voiceState override from main
 *   window.aria.onVoiceModelProgress → modelProgress update
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { VoiceState, TranscriptDelta } from '../../../shared/voice-types';
import type { AriaApi } from '../../../shared/ipc-contract';

// ─── COOLDOWN constant ────────────────────────────────────────────────────────

/** Half-duplex cooldown after TTS playback ends before mic gate is released (D-13). */
export const HALF_DUPLEX_COOLDOWN_MS = 800;

// ─── store state type ─────────────────────────────────────────────────────────

export interface VoiceSessionState {
  /** Current voice pipeline state (D-17 — 'speaking' must be representable). */
  voiceState: VoiceState;
  /**
   * Half-duplex mic gate (D-13).
   * true during listening, processing, AND for the full TTS playback + cooldown.
   * Callers (VoicePTTButton, useMicCapture) must check this before forwarding PCM.
   */
  micGated: boolean;
  /** Incremental transcript from the STT sidecar. */
  liveTranscript: string;
  /** Model download progress (for the download modal). */
  modelProgress: { receivedBytes: number; totalBytes: number } | null;
  /**
   * Phase 16 / D-09: true while TTS playback is suspended via AudioContext.suspend().
   * Stays alongside voiceState='speaking' so the HUD displays correctly.
   * Callers (VoiceHUDBand) call player.suspend()/player.resume() directly.
   */
  paused: boolean;
  /**
   * Phase 17 / D-10: non-null during awaiting-confirm sub-state.
   * Set by setPendingApproval() when read-back TTS starts for an approval.
   * Cleared on terminal transitions (confirm → approved, cancel → cancelled, barge-in).
   * When non-null:
   *   - setTranscript(final=true) sends to voiceConfirmApproval instead of voiceFeedAnswer
   *   - bargeIn() fires voiceCancelApproval before voiceAbort
   */
  pendingApprovalId: string | null;
}

// ─── store actions type ───────────────────────────────────────────────────────

export interface VoiceSessionActions {
  /**
   * Initiate a PTT turn. Sets state='listening' + micGated=true.
   * When state==='speaking', calls bargeIn() instead of returning false (D-01).
   * NO-OP (returns false) if state==='muted-during-playback' — D-13 half-duplex gate.
   */
  startTurn(): boolean;

  /**
   * Stop the current PTT turn. Called by VoicePTTButton on keyup (hold) or
   * second click (toggle). Transitions state to 'processing' if currently
   * listening, or to 'idle' otherwise.
   */
  stopTurn(): void;

  /**
   * Switch the VAD role for this turn (D-11).
   *   'hold'   — VAD is a trailing-silence trim only; keyup ends the turn.
   *   'toggle' — VAD onSpeechEnd is the turn-ender.
   * Called by VoicePTTButton BEFORE startTurn.
   */
  setVadMode(mode: 'hold' | 'toggle'): void;

  /**
   * Called by the STT sidecar (via IPC) with incremental transcript.
   * final=true → state transitions to 'processing'.
   */
  setTranscript(text: string, final: boolean): void;

  /**
   * Called after the STT + response pipeline finishes; transitions to 'idle'.
   * Also releases micGated if called from 'processing'.
   */
  endTurn(): void;

  /**
   * Called by useKokoroPlayer BEFORE audio starts playing (D-13 / D-18).
   * Sets state='speaking' + micGated=true.
   */
  onPlaybackStart(): void;

  /**
   * Called by useKokoroPlayer AFTER audio ends (D-13 / D-18).
   * Schedules micGated=false after HALF_DUPLEX_COOLDOWN_MS then state='idle'.
   */
  onPlaybackEnd(): void;

  /**
   * Subscribe to all three VOICE_* IPC push channels.
   * Returns an unsubscribe function (call on component unmount).
   * Mirrors the AppShellNavigateListener useEffect pattern (App.tsx:201-218).
   */
  subscribeToIpc(aria: AriaApi): () => void;

  /**
   * Phase 16 / D-01: Interrupt Aria's TTS playback.
   * No-op if voiceState !== 'speaking'. When speaking:
   *   1. clearCooldown() — cancel in-flight cooldown timer
   *   2. Fire voiceAbort IPC without await (D-02 fire-and-forget)
   *   3. Transition to idle (voiceState='idle', micGated=false, paused=false)
   * SC5: ambient sound without PTT press never triggers anything — no-op guard.
   * NOTE: Caller (VoiceHUDBand 16-04b) is responsible for readAloudQueue.cancel()
   * and player.resume() if paused.
   */
  bargeIn(): void;

  /**
   * Phase 16 / D-09: Suspend TTS playback.
   * Cancels the cooldown timer and sets paused=true.
   * NOTE: Caller (VoiceHUDBand 16-04b) is responsible for player.suspend().
   */
  pause(): void;

  /**
   * Phase 16 / D-09: Resume TTS playback.
   * Sets paused=false.
   * NOTE: Caller (VoiceHUDBand 16-04b) is responsible for player.resume().
   */
  resume(): void;

  /**
   * Phase 17 / D-10: Set the pending approval ID (enter awaiting-confirm sub-state).
   * Called by useVoiceConfirm.triggerReadBack() when read-back TTS begins for an approval.
   * While pendingApprovalId is set:
   *   - setTranscript(final=true) routes to voiceConfirmApproval instead of voiceFeedAnswer
   *   - bargeIn() fires voiceCancelApproval before voiceAbort
   */
  setPendingApproval(approvalId: string): void;

  /**
   * Phase 17 / D-10: Clear the pending approval ID (exit awaiting-confirm sub-state).
   * Called after a terminal confirm/cancel transition.
   */
  clearPendingApproval(): void;
}

export type VoiceSessionStore = {
  getState(): VoiceSessionState & VoiceSessionActions;
  subscribe(listener: () => void): () => void;
  /** Convenience: subscribe to IPC push channels (delegates to getState().subscribeToIpc). */
  subscribeToIpc(aria: AriaApi): () => void;
};

// ─── factory ─────────────────────────────────────────────────────────────────

/**
 * createVoiceSessionStore — pure factory, no React hooks, fully unit-testable.
 * Implements a minimal observable store (publish/subscribe).
 */
export function createVoiceSessionStore(): VoiceSessionStore {
  let state: VoiceSessionState = {
    voiceState: 'idle',
    micGated: false,
    liveTranscript: '',
    modelProgress: null,
    paused: false,
    pendingApprovalId: null,
  };

  const listeners = new Set<() => void>();
  let cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  // Phase 16 / D-01: current session ID for voiceAbort IPC payload.
  // Wave 2 VoiceSessionManager establishes the real session ID via IPC;
  // for now we generate a lightweight ID on each startTurn().
  let currentSessionId = '';

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function setState(partial: Partial<VoiceSessionState>): void {
    state = { ...state, ...partial };
    notify();
  }

  function clearCooldown(): void {
    if (cooldownTimer !== null) {
      clearTimeout(cooldownTimer);
      cooldownTimer = null;
    }
  }

  /** Current VAD mode — toggled by VoicePTTButton before startTurn (D-11). */
  let vadMode: 'hold' | 'toggle' = 'hold';

  const actions: VoiceSessionActions = {
    startTurn(): boolean {
      // Phase 16 / D-01: re-pressing PTT while speaking = barge-in, not a no-op.
      if (state.voiceState === 'speaking') {
        actions.bargeIn();
        return false;
      }
      // D-13 half-duplex gate: still blocked while muted-during-playback
      if (state.voiceState === 'muted-during-playback') {
        return false;
      }
      // vadMode is read here so the capture layer can adjust VAD thresholds (D-11).
      // The current mode is logged/accessible for the PCM pipeline.
      void vadMode; // referenced — VAD capture layer will read this in Plan 15-05 integration
      // Phase 16 / D-01: generate a session ID for the new turn.
      // Wave 2 VoiceSessionManager will supply the canonical sessionId via IPC;
      // this lightweight fallback covers the renderer-only path.
      currentSessionId = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `vses_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      setState({ voiceState: 'listening', micGated: true, liveTranscript: '' });
      return true;
    },

    stopTurn(): void {
      // Called by VoicePTTButton on keyup (hold-end) or second click (toggle-stop).
      // If currently listening, transition to processing (waiting for VAD endpointing).
      if (state.voiceState === 'listening') {
        setState({ voiceState: 'processing' });
      } else if (state.voiceState !== 'speaking' && state.voiceState !== 'muted-during-playback') {
        // Already processing or idle — reset to idle
        setState({ voiceState: 'idle', micGated: false, liveTranscript: '' });
      }
    },

    setVadMode(mode: 'hold' | 'toggle'): void {
      vadMode = mode;
      // The VAD mode is used by the capture layer to tune thresholds (D-11).
      // We store it for downstream inspection (e.g. useMicCapture reads it).
    },

    setTranscript(text: string, final: boolean): void {
      if (final) {
        setState({ liveTranscript: text, voiceState: 'processing' });

        // Phase 17 / D-10 / Pitfall 4: if we are in the awaiting-confirm sub-state,
        // route the final transcript to the confirm classifier (VOICE_CONFIRM_APPROVAL)
        // instead of the normal answer path (VOICE_FEED_ANSWER).
        if (state.pendingApprovalId !== null) {
          const approvalId = state.pendingApprovalId;
          // Clear pendingApprovalId immediately after dispatching (fire-and-forget)
          setState({ pendingApprovalId: null });
          if (typeof window !== 'undefined' && window.aria) {
            (window.aria as AriaApi).voiceConfirmApproval?.({
              approvalId,
              transcript: text,
            });
          }
        } else {
          // Normal answer turn: existing VOICE_FEED_ANSWER path is handled by
          // the IPC push subscription (onVoiceTranscript → setTranscript).
          // The voiceFeedAnswer IPC is called externally by the capture layer
          // after receiving the final transcript — we don't call it here.
        }
      } else {
        setState({ liveTranscript: text });
      }
    },

    endTurn(): void {
      setState({ voiceState: 'idle', micGated: false, liveTranscript: '' });
    },

    onPlaybackStart(): void {
      // Cancel any in-flight cooldown (e.g. back-to-back TTS calls)
      clearCooldown();
      setState({ voiceState: 'speaking', micGated: true });
    },

    onPlaybackEnd(): void {
      // Gate stays true during the cooldown — Aria never transcribes its own TTS (D-13)
      cooldownTimer = setTimeout(() => {
        cooldownTimer = null;
        setState({ voiceState: 'idle', micGated: false });
      }, HALF_DUPLEX_COOLDOWN_MS);
    },

    bargeIn(): void {
      // D-01: no-op when not speaking (SC5: ambient sound without PTT never interrupts)
      if (state.voiceState !== 'speaking') return;
      // 1. Cancel any in-flight cooldown timer (D-09)
      clearCooldown();
      // 2. Phase 17 / D-10: if in awaiting-confirm sub-state, cancel the pending approval
      //    BEFORE the voiceAbort (fire-and-forget). This ensures the 'ready' row gets
      //    transitioned to 'cancelled' rather than left orphaned.
      if (state.pendingApprovalId !== null) {
        if (typeof window !== 'undefined' && window.aria) {
          (window.aria as AriaApi).voiceCancelApproval?.({
            approvalId: state.pendingApprovalId,
          });
        }
        // Clear pendingApprovalId immediately (fire-and-forget — no await)
        setState({ pendingApprovalId: null });
      }
      // 3. Fire one-way IPC abort — NO await (D-02 fire-and-forget, ~5ms renderer-side cancel)
      //    Caller (VoiceHUDBand 16-04b) is responsible for readAloudQueue.cancel() and
      //    player.resume() if AudioContext is suspended.
      //    Guard against test environments where window.aria is undefined.
      if (typeof window !== 'undefined' && window.aria) {
        (window.aria as AriaApi).voiceAbort?.({ sessionId: currentSessionId });
      }
      // 4. Transition to idle — clears paused=false, micGated=false
      setState({ voiceState: 'idle', micGated: false, paused: false, liveTranscript: '' });
    },

    pause(): void {
      // D-09: cancel cooldown timer on pause, set paused=true.
      // Caller (VoiceHUDBand 16-04b) is responsible for player.suspend().
      clearCooldown();
      setState({ paused: true });
    },

    resume(): void {
      // D-09: set paused=false.
      // Caller (VoiceHUDBand 16-04b) is responsible for player.resume().
      setState({ paused: false });
    },

    setPendingApproval(approvalId: string): void {
      // Phase 17 / D-10: enter awaiting-confirm sub-state.
      // Called by useVoiceConfirm.triggerReadBack() when read-back TTS begins.
      setState({ pendingApprovalId: approvalId });
    },

    clearPendingApproval(): void {
      // Phase 17 / D-10: exit awaiting-confirm sub-state after terminal transition.
      setState({ pendingApprovalId: null });
    },

    subscribeToIpc(aria: AriaApi): () => void {
      const unsubscribers: Array<() => void> = [];

      if (aria.onVoiceTranscript) {
        const unsub = aria.onVoiceTranscript((delta: TranscriptDelta) => {
          actions.setTranscript(delta.text, delta.final);
        });
        unsubscribers.push(unsub);
      }

      if (aria.onVoiceState) {
        const unsub = aria.onVoiceState((voiceState: VoiceState) => {
          setState({ voiceState });
        });
        unsubscribers.push(unsub);
      }

      if (aria.onVoiceModelProgress) {
        const unsub = aria.onVoiceModelProgress((progress) => {
          setState({ modelProgress: progress });
        });
        unsubscribers.push(unsub);
      }

      return () => {
        for (const unsub of unsubscribers) {
          unsub();
        }
      };
    },
  };

  return {
    getState(): VoiceSessionState & VoiceSessionActions {
      return { ...state, ...actions };
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    subscribeToIpc(aria: AriaApi): () => void {
      return actions.subscribeToIpc(aria);
    },
  };
}

// ─── module-level singleton (for component use) ───────────────────────────────

/** Singleton store shared across components. Reset via createVoiceSessionStore() in tests. */
let _singleton: VoiceSessionStore | null = null;

function getSessionStore(): VoiceSessionStore {
  if (!_singleton) {
    _singleton = createVoiceSessionStore();
  }
  return _singleton;
}

// ─── React hook ───────────────────────────────────────────────────────────────

/**
 * useVoiceSession — React hook that subscribes to the session store.
 *
 * Subscribes to the IPC push channels (onVoiceTranscript/onVoiceState/
 * onVoiceModelProgress) on mount, unsubscribes on teardown.
 * Mirrors the AppShellNavigateListener useEffect pattern (App.tsx:201-218).
 *
 * Returns the current state merged with actions.
 */
export function useVoiceSession(): VoiceSessionState & VoiceSessionActions {
  const store = getSessionStore();
  const [, forceUpdate] = useState(0);

  // Subscribe to store changes for re-render
  useEffect(() => {
    const unsub = store.subscribe(() => {
      forceUpdate((n) => n + 1);
    });
    return unsub;
  }, [store]);

  // Subscribe to IPC push channels
  const subscribedRef = useRef(false);
  const ipcUnsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (subscribedRef.current) return;
    if (typeof window === 'undefined' || !window.aria) return;
    subscribedRef.current = true;

    ipcUnsubRef.current = store.getState().subscribeToIpc(window.aria as AriaApi);

    return () => {
      ipcUnsubRef.current?.();
      ipcUnsubRef.current = null;
      subscribedRef.current = false;
    };
  }, [store]);

  return store.getState();
}

/**
 * useVoiceSessionActions — stable actions ref (no re-renders on state changes).
 * Use when a component only needs actions, not state.
 */
export function useVoiceSessionActions(): VoiceSessionActions {
  const actionsRef = useCallback(() => getSessionStore().getState(), []);
  return actionsRef();
}
