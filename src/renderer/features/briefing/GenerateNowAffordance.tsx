/**
 * Plan 02-04 Task 3 — GenerateNowAffordance.
 *
 * Rendered by BriefingScreen when no briefing row exists for today's local
 * date (e.g. user slept through the cron, just installed, or the cron has
 * not yet fired). Copy is locked to acceptance criterion 'No briefing yet
 * for today'.
 */
import { useState } from 'react';

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
        padding: 'var(--aria-space-lg)',
        border: '1px dashed var(--aria-border)',
        borderRadius: 8,
        maxWidth: 640,
      }}
    >
      <p style={{ marginTop: 0 }}>{GENERATE_NOW_COPY}</p>
      <button
        type="button"
        data-testid="generate-now-btn"
        onClick={() => void onClick()}
        disabled={busy}
      >
        {busy ? 'Generating…' : 'Generate'}
      </button>
      {error && (
        <p data-testid="generate-now-error" style={{ color: 'var(--aria-error-fg, #b91c1c)' }}>
          Failed: {error}
        </p>
      )}
    </div>
  );
}
