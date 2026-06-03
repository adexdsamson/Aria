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
 *   compact      — renders a smaller 28×28px icon-only variant for the Topbar slot.
 */
import { useEffect, useRef } from 'react';
import { useVoiceSession } from './useVoiceSession';
import type { VoiceSessionState, VoiceSessionActions } from './useVoiceSession';

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
  /** Compact 28×28px icon-only variant for the Topbar slot. */
  compact?: boolean;
  /** Custom data-testid (defaults to "voice-ptt-button"). */
  testId?: string;
}

// ─── Inner component (always gets a session — no conditional hook) ────────────

function VoicePTTButtonCore({
  session,
  compact = false,
  testId = 'voice-ptt-button',
}: {
  session: SessionState;
  compact?: boolean;
  testId?: string;
}): JSX.Element {
  const holdActiveRef = useRef(false);
  const gated = isGated(session);
  const active = isActive(session);

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
      session.setVadMode('hold');
      session.startTurn();
    }

    function onKeyUp(e: KeyboardEvent): void {
      if (e.key !== ' ' && e.code !== 'Space') return;
      if (!holdActiveRef.current) return;
      holdActiveRef.current = false;
      session.stopTurn();
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [session, gated]);

  // ── Click handler (toggle path, D-10) ───────────────────────────────────
  function handleClick(): void {
    if (gated) return;

    if (active) {
      // Second click stops the current turn (toggle-stop)
      session.stopTurn();
    } else {
      // First click starts a new toggle turn
      session.setVadMode('toggle');
      session.startTurn();
    }
  }

  // ── Visual state ─────────────────────────────────────────────────────────
  const btnSize = compact ? 28 : 44;
  const iconSize = compact ? 14 : 18;
  const gatedStyle: React.CSSProperties = gated
    ? { opacity: 0.5, cursor: 'not-allowed' }
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

  const micColor = active ? 'var(--gold)' : gated ? 'var(--gray-faint)' : 'var(--gray)';

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
          aria-label="Push to talk — hold Space or click to toggle"
          aria-disabled={gated ? 'true' : undefined}
          title={gated ? 'Aria is speaking' : undefined}
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
    </>
  );
}

// ─── Public component — wraps Core with hook or test session ──────────────────

/**
 * VoicePTTButton — public export.
 *
 * In production, calls useVoiceSession() to get the live session store.
 * In tests, accepts _testSession to inject a mock session without vi.mock.
 */
export function VoicePTTButton({ _testSession, compact, testId }: VoicePTTButtonProps): JSX.Element {
  const liveSession = useVoiceSession();
  const session = _testSession ?? liveSession;
  return <VoicePTTButtonCore session={session} compact={compact} testId={testId} />;
}
