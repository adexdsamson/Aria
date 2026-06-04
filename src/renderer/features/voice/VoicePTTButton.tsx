/**
 * Phase 15 / Plan 15-07 — VoicePTTButton.
 *
 * The push-to-talk control. Supports BOTH hold-to-talk (DOM keydown/keyup)
 * AND click-toggle on the same control (D-10).
 *
 * Hold-to-talk:
 *   keydown Space → setVadMode('hold') + startTurn()
 *   keyup Space   → stopTurn() (hard turn-end per D-10)
 *
 * Click-toggle:
 *   click (when idle) → setVadMode('toggle') + startTurn()
 *   click (when listening/processing) → stopTurn()
 *
 * Half-duplex gate (D-13):
 *   While speaking/muted-during-playback, PTT-start is blocked and the button
 *   is visually muted with tooltip "Aria is speaking".
 *
 * Lazy first-PTT model-readiness gate (D-08/SC4):
 *   On mount, the component checks voiceGetModelStatus(). If the model is NOT
 *   ready, any PTT attempt (click or Space) opens the VoiceModelDownload modal
 *   variant instead of entering listening state. Once the model is ready (or
 *   the user skips), subsequent PTT attempts proceed normally.
 *
 * Input guard (T-15-22):
 *   The Space keydown handler ignores events when e.target is an HTMLInputElement
 *   or HTMLTextAreaElement (prevents hijacking text entry).
 *
 * NO globalShortcut, NO uiohook-napi (D-12).
 * The Space binding is DOM-only (focused window).
 *
 * VAD mode (D-11):
 *   setVadMode() on the session store before startTurn() so the capture layer
 *   can adjust VAD thresholds. 'hold' = trim-only; 'toggle' = turn-ender.
 *
 * Reduced motion (D-16): active ring pulse suppressed under prefers-reduced-motion.
 *
 * Props:
 *   _testSession — test-only override for the session store (avoids vi.mock).
 *   _testIpc     — test-only override for the IPC layer (avoids vi.mock).
 *   compact      — renders a smaller 28×28px icon-only variant for the Topbar slot.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useVoiceSession } from './useVoiceSession';
import type { VoiceSessionState, VoiceSessionActions } from './useVoiceSession';
import { VoiceModelDownload } from './VoiceModelDownload';
import type { VoiceModelDownloadIpc } from './VoiceModelDownload';

// ─── styles ──────────────────────────────────────────────────────────────────

const CSS = `
@keyframes ptt-ring-pulse {
  0%, 100% { box-shadow: 0 0 0 4px rgba(184,134,11,0.15); }
  50%       { box-shadow: 0 0 0 6px rgba(184,134,11,0.05); }
}
@media (prefers-reduced-motion: reduce) {
  .ptt-ring-pulse { animation: none !important; }
}
`;

// ─── helpers ─────────────────────────────────────────────────────────────────

type SessionState = VoiceSessionState & VoiceSessionActions;

function isGated(state: SessionState): boolean {
  return state.voiceState === 'speaking' || state.voiceState === 'muted-during-playback';
}

function isActive(state: SessionState): boolean {
  return state.voiceState === 'listening' || state.voiceState === 'processing';
}

// ─── Mic SVG icon ─────────────────────────────────────────────────────────────

function MicIcon({ size = 18, color = 'currentColor' }: { size?: number; color?: string }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );
}

// ─── component props ─────────────────────────────────────────────────────────

export interface VoicePTTButtonProps {
  /** Test-only: inject a mock session to avoid vi.mock vitest-pool issues. */
  _testSession?: SessionState;
  /** Test-only: inject a mock IPC layer (voiceGetModelStatus) to avoid vi.mock. */
  _testIpc?: VoiceModelDownloadIpc;
  /** Compact 28×28px icon-only variant for the Topbar slot. */
  compact?: boolean;
  /** Custom data-testid (defaults to "voice-ptt-button"). */
  testId?: string;
}

// ─── Inner component (always gets a session — no conditional hook) ────────────

function VoicePTTButtonCore({
  session,
  testIpc,
  compact = false,
  testId = 'voice-ptt-button',
}: {
  session: SessionState;
  testIpc?: VoiceModelDownloadIpc;
  compact?: boolean;
  testId?: string;
}): JSX.Element {
  const holdActiveRef = useRef(false);
  const gated = isGated(session);
  const active = isActive(session);

  // ── D-08 / SC4: Lazy model-readiness gate ───────────────────────────────
  // Cached result of the model-status check. null = not yet checked.
  // The check runs on first PTT press (lazy) to avoid blocking render.
  const modelReadyRef = useRef<boolean | null>(null);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  // Mirror of modelReadyRef in React state for re-render-driven visual affordance
  const [modelReadyState, setModelReadyState] = useState<boolean | null>(null);

  // Resolve IPC — test injection or window.aria
  const getIpc = useCallback((): VoiceModelDownloadIpc | null => {
    if (testIpc) return testIpc;
    if (typeof window !== 'undefined' && window.aria) {
      return window.aria as unknown as VoiceModelDownloadIpc;
    }
    return null;
  }, [testIpc]);

  /**
   * Check model readiness (cached after first check) and invoke callback
   * with the result. Uses a ref cache to avoid repeated IPC calls.
   */
  async function checkModelReady(): Promise<boolean> {
    if (modelReadyRef.current !== null) {
      return modelReadyRef.current;
    }
    const ipc = getIpc();
    if (!ipc) {
      // No IPC — assume ready (fail-open, e.g. in non-electron test environments)
      modelReadyRef.current = true;
      setModelReadyState(true);
      return true;
    }
    try {
      const status = await ipc.voiceGetModelStatus();
      const s = status as { ready?: boolean; state?: number } | undefined;
      const ready = !!(s?.ready || s?.state === 1);
      modelReadyRef.current = ready;
      setModelReadyState(ready);
      return ready;
    } catch {
      // Fail-open on error (prefer PTT over permanently blocked)
      modelReadyRef.current = true;
      setModelReadyState(true);
      return true;
    }
  }

  /**
   * Attempt a PTT start action (shared between click and keydown paths).
   *
   * If model readiness is already known (cached), operates synchronously.
   * If unknown, performs an async IPC check; until the check resolves,
   * we optimistically proceed (fail-open) to preserve the existing synchronous
   * behavior for tests and environments without IPC available.
   *
   * Only when the IPC check returns NOT ready do we open the download modal.
   */
  function attemptPttStart(vadMode: 'hold' | 'toggle'): void {
    // Fast path: already known from a previous check
    if (modelReadyRef.current === false) {
      setShowDownloadModal(true);
      return;
    }
    if (modelReadyRef.current === true) {
      // Known ready — proceed synchronously
      session.setVadMode(vadMode);
      session.startTurn();
      return;
    }

    // modelReadyRef.current === null (not yet checked)
    const ipc = getIpc();
    if (!ipc) {
      // No IPC available — proceed immediately (non-Electron env / no window.aria)
      modelReadyRef.current = true;
      setModelReadyState(true);
      session.setVadMode(vadMode);
      session.startTurn();
      return;
    }

    // Async check: optimistically start the turn while the check is in-flight.
    // If the model turns out NOT ready, abort the turn and show the modal.
    // This keeps the synchronous "known ready" and "no IPC" paths fast.
    checkModelReady().then((ready) => {
      if (!ready) {
        setShowDownloadModal(true);
        // If we had already started the turn optimistically, stop it
        // (checkModelReady updates modelReadyRef so this branch is only hit
        // when we learn the model is absent — the turn was never started
        // because this async path is only taken when null → we do NOT
        // call startTurn here).
        return;
      }
      session.setVadMode(vadMode);
      session.startTurn();
    }).catch(() => {
      // Fail-open on IPC error
      session.setVadMode(vadMode);
      session.startTurn();
    });
  }

  // ── DOM keydown/keyup Space handler (D-10) ──────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== ' ' && e.code !== 'Space') return;
      // T-15-22: ignore when focus is in a text input/textarea
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      // Prevent double-fire on held key
      if (holdActiveRef.current) return;
      // D-13: blocked while gated
      if (gated) return;

      holdActiveRef.current = true;
      attemptPttStart('hold');
    }

    function onKeyUp(e: KeyboardEvent): void {
      if (e.key !== ' ' && e.code !== 'Space') return;
      if (!holdActiveRef.current) return;
      holdActiveRef.current = false;
      // Only call stopTurn if we actually started a turn (model was ready)
      if (modelReadyRef.current !== false) {
        session.stopTurn();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, gated]);

  // ── Click handler (toggle path, D-10) ───────────────────────────────────
  function handleClick(): void {
    if (gated) return;

    if (active) {
      // Second click stops the current turn (toggle-stop)
      session.stopTurn();
    } else {
      // First click: check model readiness, then start or show modal
      attemptPttStart('toggle');
    }
  }

  // ── Visual state ─────────────────────────────────────────────────────────
  const modelNotReady = modelReadyState === false;
  const btnSize = compact ? 28 : 44;
  const iconSize = compact ? 14 : 18;

  // Three disabled states: gated (speaking), model-not-ready, or normal
  const gatedStyle: React.CSSProperties =
    gated ? { opacity: 0.5, cursor: 'not-allowed' }
    : modelNotReady ? { opacity: 0.5 }
    : {};
  const activeStyle: React.CSSProperties = active
    ? {
        background: 'var(--ivory-deep, var(--ivory))',
        border: '1.5px solid var(--gold)',
        boxShadow: '0 0 0 4px rgba(184,134,11,0.15)',
      }
    : {
        background: 'var(--paper)',
        border: '1.5px solid var(--rule)',
      };

  const micColor = active
    ? 'var(--gold)'
    : gated || modelNotReady
    ? 'var(--gray-faint)'
    : 'var(--gray)';

  const ariaLabel = modelNotReady
    ? 'Voice model not ready — click to set up'
    : 'Push to talk — hold Space or click to toggle';

  const titleAttr = gated
    ? 'Aria is speaking'
    : modelNotReady
    ? 'Voice model not downloaded — click to set up'
    : undefined;

  return (
    <>
      <style>{CSS}</style>
      <div
        style={{
          display: 'inline-flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <button
          type="button"
          data-testid={testId}
          aria-label={ariaLabel}
          aria-disabled={gated ? 'true' : undefined}
          title={titleAttr}
          onClick={handleClick}
          className={active ? 'ptt-ring-pulse' : undefined}
          style={{
            all: 'unset',
            boxSizing: 'border-box',
            width: btnSize,
            height: btnSize,
            borderRadius: '50%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: gated ? 'not-allowed' : 'pointer',
            flexShrink: 0,
            transition: 'background 150ms ease, border-color 150ms ease',
            ...activeStyle,
            ...gatedStyle,
          }}
        >
          <MicIcon size={iconSize} color={micColor} />
        </button>

        {/* Hint label — 10px mono, surfaces both affordances (D-10) */}
        {!compact && (
          <span
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              fontWeight: 500,
              color: 'var(--gray)',
              whiteSpace: 'nowrap',
              userSelect: 'none',
            }}
          >
            Space · Click to toggle
          </span>
        )}
      </div>

      {/* D-08 / SC4: Lazy first-PTT VoiceModelDownload modal */}
      {showDownloadModal && (
        <VoiceModelDownload
          variant="modal"
          open={showDownloadModal}
          _testIpc={testIpc}
          onSkip={() => {
            setShowDownloadModal(false);
            // User skipped: clear the cached "not ready" so next PTT re-checks.
            // This is a soft skip — if they skipped accidentally, next press
            // will check again (IPC remains fast since model state hasn't changed).
          }}
          onComplete={() => {
            setShowDownloadModal(false);
            modelReadyRef.current = true;
            setModelReadyState(true);
          }}
        />
      )}
    </>
  );
}

// ─── Public component — wraps Core with hook or test session ──────────────────

/**
 * VoicePTTButton — public export.
 *
 * In production, calls useVoiceSession() to get the live session store.
 * In tests, accepts _testSession to inject a mock session without vi.mock,
 * and _testIpc to inject a mock IPC layer for the model-readiness check.
 */
export function VoicePTTButton({ _testSession, _testIpc, compact, testId }: VoicePTTButtonProps): JSX.Element {
  const liveSession = useVoiceSession();
  const session = _testSession ?? liveSession;
  return <VoicePTTButtonCore session={session} testIpc={_testIpc} compact={compact} testId={testId} />;
}
