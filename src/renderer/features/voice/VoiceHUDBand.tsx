/**
 * Phase 15 / Plan 15-07 — VoiceHUDBand.
 *
 * Transient in-flow live-transcription banner at the same shell slot as
 * TrialBanner (D-15). Mounts unconditionally; collapses to zero-height when
 * idle to avoid mount/unmount layout jank.
 *
 * Expansion technique: grid-template-rows 0fr → 1fr (D-Claude discretion per
 * RESEARCH.md — cleaner than max-height). Inner content wrapper has
 * overflow:hidden. Transition: 200ms cubic-bezier(.2,.6,.2,1).
 * Under prefers-reduced-motion: no transition, instant toggle (D-16).
 *
 * Aria contract: role="status" aria-live="polite" aria-atomic="false".
 * The label + transcript are in a single live region so screen readers
 * announce the transcript text as it arrives (D-15).
 *
 * Transcript rendering (T-15-21): transcript is rendered as a plain React
 * text node (never dangerouslySetInnerHTML) to prevent injection.
 *
 * Per-state copy per UI-SPEC §Copywriting:
 *   listening → "LISTENING" label + "Listening…" display
 *   processing → "PROCESSING" label + "Transcribing…"
 *   speaking → "SPEAKING" label + echo text
 *   muted → "MUTED" label + "Mic muted during playback"
 *   error → "ERROR" label + error message
 *   idle → collapsed (no label shown)
 */
import type { VoiceState } from '../../../shared/voice-types';

// ─── styles ──────────────────────────────────────────────────────────────────

const CSS = `
@keyframes voice-hud-dots {
  0%   { content: ''; }
  33%  { content: '.'; }
  66%  { content: '..'; }
  100% { content: '...'; }
}
.voice-hud-dots::after {
  content: '…';
  animation: voice-hud-dots 1.2s steps(3, end) infinite;
}
@media (prefers-reduced-motion: reduce) {
  .voice-hud-dots::after {
    animation: none;
    content: '…';
  }
  [data-voice-hud-band] {
    transition: none !important;
  }
}
`;

// ─── active states (non-idle) ─────────────────────────────────────────────────

const ACTIVE_STATES: Set<VoiceState> = new Set([
  'listening',
  'processing',
  'speaking',
  'muted-during-playback',
  'error',
]);

// ─── state label (mono uppercase, UI-SPEC) ────────────────────────────────────

const STATE_MONO_LABEL: Partial<Record<VoiceState, string>> = {
  listening: 'LISTENING',
  processing: 'PROCESSING',
  speaking: 'SPEAKING',
  'muted-during-playback': 'MUTED',
  error: 'ERROR',
};

// ─── state label color ────────────────────────────────────────────────────────

function labelColor(state: VoiceState): string {
  switch (state) {
    case 'listening':
    case 'processing':
      return 'var(--gold)';
    case 'speaking':
      return 'var(--moss)';
    case 'muted-during-playback':
      return 'var(--gray)';
    case 'error':
      return 'var(--rose)';
    default:
      return 'var(--gold)';
  }
}

// ─── component ───────────────────────────────────────────────────────────────

export interface VoiceHUDBandProps {
  state: VoiceState;
  /** Live transcript text — rendered as plain text (T-15-21). */
  transcript: string;
}

export function VoiceHUDBand({ state, transcript }: VoiceHUDBandProps): JSX.Element {
  const isActive = ACTIVE_STATES.has(state);
  const monoLabel = STATE_MONO_LABEL[state] ?? '';

  // Per-state transcript display text
  let displayText = transcript;
  if (state === 'listening' && !transcript) {
    displayText = 'Listening…';
  } else if (state === 'processing') {
    displayText = transcript || 'Transcribing…';
  } else if (state === 'speaking') {
    displayText = transcript || 'Speaking…';
  } else if (state === 'muted-during-playback') {
    displayText = 'Mic muted during playback';
  }

  return (
    <>
      <style>{CSS}</style>
      <div
        data-testid="voice-hud-band"
        data-voice-hud-band
        role="status"
        aria-live="polite"
        aria-atomic="false"
        style={{
          display: 'grid',
          gridTemplateRows: isActive ? '1fr' : '0fr',
          transition: 'grid-template-rows 200ms cubic-bezier(.2,.6,.2,1)',
          background: 'var(--ivory)',
          borderBottom: isActive ? '1px solid var(--rule)' : 'none',
          overflow: 'hidden',
        }}
      >
        {/* Inner overflow wrapper — required for grid 0fr collapse */}
        <div
          data-voice-hud-inner
          style={{
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: isActive ? '10px 16px' : '0 16px',
          }}
        >
          {/* Mono uppercase state label */}
          <span
            data-testid="voice-hud-state-label"
            aria-hidden="true"
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: labelColor(state),
              flexShrink: 0,
            }}
          >
            {monoLabel}
          </span>

          {/* Transcript text — plain text (T-15-21 injection mitigation) */}
          <span
            data-testid="voice-hud-transcript"
            style={{
              flex: 1,
              fontFamily: 'var(--f-body)',
              fontSize: 14,
              fontWeight: 400,
              lineHeight: 1.5,
              color: state === 'muted-during-playback'
                ? 'var(--gray)'
                : state === 'error'
                  ? 'var(--rose)'
                  : 'var(--ink)',
              fontStyle: state === 'muted-during-playback' ? 'italic' : undefined,
            }}
          >
            {/* Render as plain text node — never dangerouslySetInnerHTML */}
            {displayText}
          </span>
        </div>
      </div>
    </>
  );
}
