/**
 * Phase 15 / Plan 15-07 — VoiceStatusDot.
 *
 * A thin wrapper around the existing StatusDot editorial primitive that maps
 * VoiceState → StatusDotKind (D-14 — NO new design tokens).
 *
 * Placed in the Topbar right cluster between the bell and AvatarMenu.
 * Encodes every voice state via the existing 4-color vocabulary:
 *   idle            → idle (gray-faint)
 *   listening       → warn (gold + slow pulse)
 *   processing      → warn (gold + spinner arc)
 *   speaking        → ok (moss, static)
 *   muted-during-playback → idle (gray-faint + struck-mic icon)
 *   error           → err (rose, static)
 *
 * Accessibility: aria-label="Microphone: {STATE}" on the wrapper span.
 * A visually-hidden aria-live sibling announces state changes without
 * coupling to every pulse/animation tick (D-14/VOICE-07).
 *
 * Reduced motion (D-16): pulse and spinner arc are suppressed under
 * prefers-reduced-motion: reduce — state stays encoded in color + mono label.
 * Mirrors the GateLoadingScreen reduced-motion precedent (App.tsx:133-136).
 */
import { StatusDot } from '../../components/editorial/StatusDot';
import type { StatusDotKind } from '../../components/editorial/StatusDot';
import type { VoiceState } from '../../../shared/voice-types';

// ─── styles ──────────────────────────────────────────────────────────────────

const CSS = `
@keyframes voice-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.45; }
}
@keyframes voice-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .voice-pulse-anim { animation: none !important; }
  .voice-spin-anim  { display: none !important; }
}
`;

// ─── state label map (human-readable for aria-label) ─────────────────────────

const STATE_LABEL: Record<VoiceState, string> = {
  idle: 'Idle',
  listening: 'Listening',
  processing: 'Processing',
  speaking: 'Speaking',
  'muted-during-playback': 'Muted',
  error: 'Error',
};

// ─── VoiceState → StatusDotKind mapping (D-14) ───────────────────────────────

function stateToKind(state: VoiceState): StatusDotKind {
  switch (state) {
    case 'speaking':
      return 'ok';
    case 'listening':
    case 'processing':
      return 'warn';
    case 'error':
      return 'err';
    case 'idle':
    case 'muted-during-playback':
    default:
      return 'idle';
  }
}

// ─── component ───────────────────────────────────────────────────────────────

export interface VoiceStatusDotProps {
  state: VoiceState;
}

export function VoiceStatusDot({ state }: VoiceStatusDotProps): JSX.Element {
  const kind = stateToKind(state);
  const label = STATE_LABEL[state];
  const isListening = state === 'listening';
  const isProcessing = state === 'processing';
  const isMuted = state === 'muted-during-playback';

  return (
    <>
      <style>{CSS}</style>
      <span
        data-testid="aria-topbar-voice-dot"
        aria-label={`Microphone: ${label}`}
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {/* Listening pulse wrapper */}
        <span
          className={isListening ? 'voice-pulse-anim' : undefined}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: isListening ? 'voice-pulse 2s ease-in-out infinite' : undefined,
          }}
        >
          <StatusDot kind={kind} />
        </span>

        {/* Processing spinner arc (10×10 SVG) */}
        {isProcessing && (
          <svg
            data-voice-spinner
            className="voice-spin-anim"
            width={10}
            height={10}
            viewBox="0 0 10 10"
            fill="none"
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              animation: 'voice-spin 700ms linear infinite',
              pointerEvents: 'none',
            }}
            aria-hidden="true"
          >
            <circle
              cx={5}
              cy={5}
              r={4}
              stroke="var(--gold)"
              strokeWidth={1.5}
              strokeDasharray="12 14"
              strokeLinecap="round"
            />
          </svg>
        )}

        {/* Muted struck-mic indicator */}
        {isMuted && (
          <span
            data-voice-struck-mic
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              display: 'inline-flex',
              pointerEvents: 'none',
            }}
          >
            <svg
              width={12}
              height={12}
              viewBox="0 0 12 12"
              fill="none"
              stroke="var(--gray-faint)"
              strokeWidth={1.5}
            >
              {/* Diagonal struck-through line over mic */}
              <line x1={1} y1={11} x2={11} y2={1} stroke="var(--gray)" strokeWidth={1.5} />
            </svg>
          </span>
        )}

        {/* Visually-hidden aria-live sibling — announces state without pulse ticks */}
        <span
          aria-live="polite"
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            overflow: 'hidden',
            clip: 'rect(0,0,0,0)',
            whiteSpace: 'nowrap',
          }}
        >
          {`Microphone: ${label}`}
        </span>
      </span>
    </>
  );
}
