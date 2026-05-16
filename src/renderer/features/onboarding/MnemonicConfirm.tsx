/**
 * Onboarding step 2 — D-03 3-word confirmation challenge. Asks the user to
 * type the words at three random positions; on failure, the main process
 * re-rolls the positions and returns a fresh challenge.
 */
import { useState } from 'react';

export interface MnemonicConfirmProps {
  positions: number[];
  onConfirmed: () => void;
  onPositionsUpdated: (positions: number[]) => void;
}

export function MnemonicConfirm({
  positions,
  onConfirmed,
  onPositionsUpdated,
}: MnemonicConfirmProps): JSX.Element {
  const [answers, setAnswers] = useState<string[]>(['', '', '']);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const res = (await window.aria.onboardingConfirm({
        positions,
        answers,
      } as never)) as { ok: boolean; positions?: number[] };
      if (res.ok) {
        onConfirmed();
      } else {
        setError('Those words did not match. Try again with the new positions.');
        if (res.positions) onPositionsUpdated(res.positions);
        setAnswers(['', '', '']);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section data-testid="onboarding-confirm" style={{ padding: 24, maxWidth: 720 }}>
      <h1 style={{ marginTop: 0 }}>Confirm your recovery phrase</h1>
      <p>Enter the words at the following positions from the phrase you just wrote down.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {positions.map((p, i) => (
          <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ minWidth: 80 }}>Word #{p + 1}</span>
            <input
              type="text"
              autoComplete="off"
              data-testid={`confirm-input-${i}`}
              value={answers[i]}
              onChange={(e) => {
                const next = [...answers];
                next[i] = e.target.value;
                setAnswers(next);
              }}
              style={{ flex: 1, padding: 6 }}
            />
          </label>
        ))}
      </div>
      {error && (
        <p data-testid="confirm-error" style={{ color: 'crimson' }}>
          {error}
        </p>
      )}
      <button
        data-testid="confirm-submit"
        onClick={submit}
        disabled={submitting || answers.some((a) => a.trim().length === 0)}
        style={{ marginTop: 16, padding: '8px 16px' }}
      >
        Confirm
      </button>
    </section>
  );
}
