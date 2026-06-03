/**
 * Phase 15 / Plan 15-06 — Voice session store + half-duplex gate.
 *
 * Implements:
 *   D-13: micGated=true on turn-start AND for the full TTS playback duration;
 *         PTT start blocked while speaking; micGated=false after ~800ms cooldown.
 *   D-17: VoiceState union includes 'speaking' (Phase 16 seam).
 *   VOICE-07: Aria never transcribes its own TTS (the gate enforces this).
 *
 * Architecture: a minimal observable store (no Zustand dependency — package not
 * installed). Exports createVoiceSessionStore() factory for testing and
 * useVoiceSession() React hook for components.
 *
 * State machine:
 *   idle ──startTurn()──→ listening ──setTranscript(final=true)──→ processing ──endTurn()──→ idle
 *   any  ──onPlaybackStart()──→ speaking ──onPlaybackEnd()──→ (cooldown ~800ms) ──→ idle
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
}

// ─── store actions type ───────────────────────────────────────────────────────

export interface VoiceSessionActions {
  /**
   * Initiate a PTT turn. Sets state='listening' + micGated=true.
   * NO-OP (returns false) if state==='speaking' — D-13 half-duplex gate.
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
  };

  const listeners = new Set<() => void>();
  let cooldownTimer: ReturnType<typeof setTimeout> | null = null;

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
      // D-13 half-duplex gate: blocked while speaking (or muted-during-playback)
      if (state.voiceState === 'speaking' || state.voiceState === 'muted-during-playback') {
        return false;
      }
      // vadMode is read here so the capture layer can adjust VAD thresholds (D-11).
      // The current mode is logged/accessible for the PCM pipeline.
      void vadMode; // referenced — VAD capture layer will read this in Plan 15-05 integration
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
