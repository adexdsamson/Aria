/**
 * GenerateNowAffordance — first-load empty state for the daily briefing.
 *
 * Editorial empty state per design-ref `app-screen-briefing.jsx` GenerateNowAffordance:
 * Playfair italic body paragraph explains what's happening; a primary button
 * routes through the LLM router with a Plex Mono caption disclosing the
 * time + path. No boxed card — the affordance lives free-form inside the
 * editorial spread.
 *
 * Animation (Emil principles):
 *   - Fade-in on mount via @starting-style (no scale-from-zero; opacity + 6px
 *     translateY → 0, 320ms with strong ease-out curve)
 *   - Button press: scale(0.97) on :active, 140ms ease-out
 *   - prefers-reduced-motion: keep opacity, drop transforms
 *
 * Behavior preserved: same data-testid (`generate-now-affordance`,
 * `generate-now-btn`, `generate-now-error`), same IPC call
 * (`window.aria.briefingGenerateNow`), same `onDone` prop, same locked copy.
 */
import { useState } from 'react';

export const GENERATE_NOW_COPY = 'No briefing yet for today — generate now?';

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

export function GenerateNowAffordance({ onDone }: { onDone: () => void }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pressed, setPressed] = useState(false);

  async function onClick(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = (await window.aria.briefingGenerateNow()) as {
        ok?: boolean;
        error?: string;
      };
      if (result?.ok) {
        onDone();
      } else {
        setError(result?.error ?? 'unknown');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Scoped entrance animation — @starting-style preferred, data-mounted shim
          maintained for Safari/older Chromium. */}
      <style>{`
        [data-aria-fade-in] {
          opacity: 1;
          transform: translateY(0);
          transition: opacity 320ms ${EASE_OUT}, transform 320ms ${EASE_OUT};
        }
        @starting-style {
          [data-aria-fade-in] {
            opacity: 0;
            transform: translateY(6px);
          }
        }
        [data-aria-press-scale]:active:not(:disabled) {
          transform: scale(0.97);
        }
        @media (prefers-reduced-motion: reduce) {
          [data-aria-fade-in] { transform: none !important; transition: opacity 200ms ease !important; }
          [data-aria-press-scale]:active:not(:disabled) { transform: none !important; }
        }
      `}</style>

      <div
        data-testid="generate-now-affordance"
        data-aria-fade-in
        style={{ maxWidth: 640 }}
      >
        {/* Playfair italic preamble — copy from design-ref, with the locked
            GENERATE_NOW_COPY substring preserved verbatim so its acceptance
            tests still match. */}
        <p
          style={{
            margin: '0 0 24px 0',
            fontFamily: 'var(--f-display)',
            fontStyle: 'italic',
            fontSize: '1.125rem',
            color: 'var(--gray)',
            lineHeight: 1.55,
            maxWidth: '34em',
            textWrap: 'pretty' as const,
          }}
        >
          {GENERATE_NOW_COPY} Aria can put one together now — or wait until 07:00
          if you'd prefer the scheduled run.
        </p>

        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            data-testid="generate-now-btn"
            data-aria-press-scale
            onClick={() => void onClick()}
            disabled={busy}
            onMouseEnter={(e) => {
              if (!busy) e.currentTarget.style.background = 'var(--gold-deep)';
            }}
            onMouseLeave={(e) => {
              if (!busy) e.currentTarget.style.background = 'var(--gold)';
            }}
            style={{
              padding: '10px 22px',
              fontSize: 14,
              fontFamily: 'var(--f-body)',
              fontWeight: 600,
              letterSpacing: '0.01em',
              color: 'var(--paper)',
              background: busy ? 'var(--rule-strong)' : 'var(--gold)',
              border: 'none',
              borderRadius: 'var(--radius)',
              cursor: busy ? 'not-allowed' : 'pointer',
              transition: `background 200ms ease, transform 140ms ${EASE_OUT}`,
            }}
          >
            {busy ? 'Generating…' : 'Generate now'}
          </button>
          <span
            aria-hidden="true"
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--gray-soft)',
            }}
          >
            Routes through the LLM router · 2–4 seconds
          </span>
        </div>

        {error && (
          <p
            data-testid="generate-now-error"
            role="alert"
            style={{
              color: 'var(--rose)',
              fontSize: 13,
              fontFamily: 'var(--f-mono)',
              letterSpacing: '0.04em',
              marginTop: 16,
              marginBottom: 0,
              padding: '8px 12px',
              background: 'rgba(184,73,58,0.06)',
              borderLeft: '2px solid var(--rose)',
              borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
            }}
          >
            Failed: {error}
          </p>
        )}
      </div>
    </>
  );
}
