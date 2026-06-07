/**
 * Phase 15 / Plan 15-07 — VoiceHUDBand.
 * Phase 16 / Plan 16-04b — Transport controls + VOICE_TTS_CHUNK subscription + latency marks.
 *
 * Transient in-flow live-transcription banner at the same shell slot as
 * TrialBanner (D-15). Mounts unconditionally; collapses to zero-height when
 * idle to avoid mount/unmount layout jank.
 *
 * Expansion technique: grid-template-rows 0fr → 1fr (D-16 per RESEARCH.md —
 * cleaner than max-height). Inner content wrapper has overflow:hidden.
 * Transition: 200ms cubic-bezier(.2,.6,.2,1).
 * Under prefers-reduced-motion: no transition, instant toggle.
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
 *
 * Phase 16 additions (D-09/D-10/WARNING 2):
 *   - Transport controls sub-row visible when voiceState==='speaking':
 *     pause/resume (player.suspend()/resume() via KokoroPlayerHandle interface),
 *     skip button (mode='briefing' only, calls onSkipSection prop),
 *     speed slider (0.5–2x, IBM Plex Mono label)
 *   - VOICE_TTS_CHUNK subscription: onVoiceTtsChunk → queue.enqueue(text)
 *   - VOICE_LATENCY_MARK emissions: kokoro_synth_start (first chunk per session),
 *     first_audio_out (voiceState transition to 'speaking')
 *   - Barge-in cleanup: queue.cancel() on voiceState leaving 'speaking';
 *     player.resume() first if paused (Pitfall 6 — AudioContext must be running)
 */
import { useEffect, useRef, useState } from 'react';
import type { VoiceState } from '../../../shared/voice-types';
import type { KokoroPlayerHandle } from './tts/useKokoroPlayer';
import { useReadAloudQueue } from './useReadAloudQueue';
import { useVoiceSession } from './useVoiceSession';

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
  /**
   * Phase 16 / D-04b: Kokoro player handle providing suspend()/resume()/cancel().
   * Required for transport controls. If absent, controls are hidden.
   */
  player?: KokoroPlayerHandle;
  /**
   * Phase 16 / D-10: Rendering mode.
   *   'briefing' — shows skip button (section walker in BriefingScreen drives this)
   *   'ask'      — no skip button (default, /ask answer flow)
   */
  mode?: 'briefing' | 'ask';
  /**
   * Phase 16 / D-10: Called when user presses Skip in briefing mode.
   * BriefingScreen calls queue.cancel() + increments currentSectionIndex.
   */
  onSkipSection?: () => void;
}

export function VoiceHUDBand({
  state,
  transcript,
  player,
  mode = 'ask',
  onSkipSection,
}: VoiceHUDBandProps): JSX.Element {
  const isActive = ACTIVE_STATES.has(state);
  const monoLabel = STATE_MONO_LABEL[state] ?? '';

  // Phase 16 / D-08: speed slider state (0.5–2x)
  const [speed, setSpeed] = useState<number>(1.0);

  // Phase 16: queue (only meaningful when player is provided)
  // Provide a no-op fallback player so the hook always has a valid handle.
  const noopPlayer = useRef<KokoroPlayerHandle>({
    init: async () => undefined,
    speak: async () => undefined,
    cancel: () => undefined,
    suspend: () => undefined,
    resume: () => undefined,
    get ready() { return false; },
  }).current;
  const activePlayer = player ?? noopPlayer;
  const queue = useReadAloudQueue(activePlayer, speed);

  // Phase 16 / D-09: voice session actions for pause/resume
  const session = useVoiceSession();

  // Phase 16 / WARNING 2: session ID tracking for voiceLatencyMark emissions.
  // We track whether we've already fired each mark for the current "speaking"
  // episode, resetting when state leaves 'speaking'.
  const synthStartFiredRef = useRef(false);
  const firstAudioOutFiredRef = useRef(false);
  // Track the sessionId received with the first TTS chunk for this episode.
  const currentSessionIdRef = useRef<string>('');

  // Phase 16 / D-05: Subscribe to VOICE_TTS_CHUNK push channel.
  // Enqueue each chunk into the read-aloud queue; fire kokoro_synth_start
  // latency mark on the first chunk of each session.
  useEffect(() => {
    if (!window.aria?.onVoiceTtsChunk) return;

    const unsub = window.aria.onVoiceTtsChunk((chunk) => {
      // Enqueue the text chunk for Kokoro playback.
      queue.enqueue(chunk.text);

      // WARNING 2 / SC2: fire kokoro_synth_start on the first chunk per session.
      if (!synthStartFiredRef.current) {
        synthStartFiredRef.current = true;
        currentSessionIdRef.current = chunk.sessionId;
        window.aria?.voiceLatencyMark?.({
          sessionId: chunk.sessionId,
          mark: 'kokoro_synth_start',
          t: Date.now(),
        });
      }
    });

    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  // Phase 16 / WARNING 2 / SC2: fire first_audio_out when voiceState transitions
  // to 'speaking' (Kokoro has started playing audio).
  const prevStateRef = useRef<VoiceState>(state);
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;

    if (state === 'speaking' && prev !== 'speaking') {
      // voiceState just entered 'speaking' — first audio is now playing.
      if (!firstAudioOutFiredRef.current) {
        firstAudioOutFiredRef.current = true;
        window.aria?.voiceLatencyMark?.({
          sessionId: currentSessionIdRef.current,
          mark: 'first_audio_out',
          t: Date.now(),
        });
      }
    }

    // When voiceState leaves 'speaking' (barge-in or playback end):
    // cancel the queue to drain any pending TTS chunks (T-16-12b / Pitfall 5/6).
    if (prev === 'speaking' && state !== 'speaking') {
      // Pitfall 6: if paused, resume AudioContext first so the stop() call
      // can propagate through the audio graph.
      if (session.paused) {
        activePlayer.resume();
      }
      queue.cancel();
      // Reset per-session marks for the next speaking episode.
      synthStartFiredRef.current = false;
      firstAudioOutFiredRef.current = false;
      currentSessionIdRef.current = '';
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

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
          }}
        >
          {/* Main row: state label + transcript */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: isActive ? '10px 16px 8px' : '0 16px',
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

          {/* Phase 16 / D-09/D-10: Transport controls sub-row.
              Visible ONLY when speaking AND a player is provided. */}
          {state === 'speaking' && player && (
            <div
              data-testid="voice-hud-transport"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 16px 10px',
                borderTop: '1px solid var(--rule)',
              }}
            >
              {/* Pause / Resume button — D-09 */}
              <button
                type="button"
                data-testid="voice-hud-pause-btn"
                aria-label={session.paused ? 'Resume' : 'Pause'}
                onClick={() => {
                  if (session.paused) {
                    // D-09: resume = state flag + AudioContext.resume()
                    session.resume();
                    player.resume();
                  } else {
                    // D-09: pause = state flag + AudioContext.suspend()
                    session.pause();
                    player.suspend();
                  }
                }}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--rule-strong)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '3px 10px',
                  cursor: 'pointer',
                  fontFamily: 'var(--f-mono)',
                  fontSize: 10,
                  fontWeight: 500,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  color: 'var(--ink)',
                  transition: 'background 160ms ease, border-color 160ms ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(184,150,62,0.08)';
                  e.currentTarget.style.borderColor = 'var(--gold)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = 'var(--rule-strong)';
                }}
              >
                {session.paused ? 'Resume' : 'Pause'}
              </button>

              {/* Skip button — D-10 briefing mode only */}
              {mode === 'briefing' && onSkipSection && (
                <button
                  type="button"
                  data-testid="voice-hud-skip-btn"
                  aria-label="Skip"
                  onClick={onSkipSection}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--rule-strong)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '3px 10px',
                    cursor: 'pointer',
                    fontFamily: 'var(--f-mono)',
                    fontSize: 10,
                    fontWeight: 500,
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                    color: 'var(--ink)',
                    transition: 'background 160ms ease, border-color 160ms ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(184,150,62,0.08)';
                    e.currentTarget.style.borderColor = 'var(--gold)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.borderColor = 'var(--rule-strong)';
                  }}
                >
                  Skip
                </button>
              )}

              {/* Speed slider — D-08: 0.5–2x, IBM Plex Mono label */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginLeft: 'auto',
                }}
              >
                <input
                  type="range"
                  data-testid="voice-hud-speed-slider"
                  min={0.5}
                  max={2}
                  step={0.25}
                  value={speed}
                  aria-label="Speed"
                  onChange={(e) => setSpeed(parseFloat(e.target.value))}
                  style={{
                    width: 80,
                    accentColor: 'var(--gold)',
                    cursor: 'pointer',
                  }}
                />
                <span
                  data-testid="voice-hud-speed-label"
                  style={{
                    fontFamily: '"IBM Plex Mono", var(--f-mono)',
                    fontSize: 10,
                    fontWeight: 500,
                    letterSpacing: '0.05em',
                    color: 'var(--ink)',
                    minWidth: '3ch',
                  }}
                >
                  {speed.toFixed(2)}×
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
