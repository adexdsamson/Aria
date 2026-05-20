/**
 * Plan 02-04 Task 3 — GenerateNowAffordance.
 *
 * Rendered by BriefingScreen when no briefing row exists for today's local
 * date (e.g. user slept through the cron, just installed, or the cron has
 * not yet fired). Copy is locked to acceptance criterion 'No briefing yet
 * for today'.
 *
 * Phase 9 Plan 03 — RE-SKINNED. Editorial empty state with Playfair italic
 * copy and a primary editorial button. data-testid and IPC call preserved.
 */
import { useState } from 'react';
import { Button } from '../../components/editorial';

export const GENERATE_NOW_COPY = 'No briefing yet for today — generate now?';

export function GenerateNowAffordance({ onDone }: { onDone: () => void }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <div
      data-testid="generate-now-affordance"
      style={{
        padding: '28px 32px',
        border: '1px solid var(--rule)',
        background: 'var(--paper)',
        borderRadius: 8,
        maxWidth: 640,
      }}
    >
      <p
        style={{
          margin: '0 0 18px 0',
          fontFamily: 'var(--f-display)',
          fontStyle: 'italic',
          fontSize: '1.125rem',
          color: 'var(--gray)',
          lineHeight: 1.55,
        }}
      >
        {GENERATE_NOW_COPY}
      </p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button
          variant="primary"
          data-testid="generate-now-btn"
          onClick={() => void onClick()}
          disabled={busy}
        >
          {busy ? 'Generating…' : 'Generate now'}
        </Button>
        <span
          className="smallcaps"
          style={{ color: 'var(--gray-soft)' }}
          aria-hidden="true"
        >
          Routes through the LLM router · 2–4 seconds
        </span>
      </div>
      {error && (
        <p
          data-testid="generate-now-error"
          style={{
            color: 'var(--rose)',
            fontSize: 13,
            marginTop: 12,
            marginBottom: 0,
          }}
        >
          Failed: {error}
        </p>
      )}
    </div>
  );
}
