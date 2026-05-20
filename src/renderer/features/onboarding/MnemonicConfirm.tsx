/**
 * Onboarding step 2 — D-03 3-word confirmation challenge. Asks the user to
 * type the words at three random positions; on failure, the main process
 * re-rolls the positions and returns a fresh challenge.
 */
import { useState } from 'react';
import { AppLogo, Button } from '../../components/editorial';

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
    <section
      data-testid="onboarding-confirm"
      style={{
        padding: 32,
        maxWidth: 560,
        margin: '0 auto',
        color: 'var(--ink)',
        fontFamily: 'var(--f-body)',
        background: 'var(--paper)',
      }}
    >
      <div style={{ marginBottom: 18 }}>
        <AppLogo variant="header" />
      </div>
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--gold)',
          marginBottom: 6,
        }}
      >
        Step 2 of 4 · confirm recovery phrase
      </div>
      <h1
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 32,
          fontWeight: 500,
          letterSpacing: '-0.01em',
          color: 'var(--ink)',
          marginTop: 0,
          marginBottom: 14,
        }}
      >
        Confirm your recovery phrase
      </h1>
      <p style={{ color: 'var(--ink-soft)', fontSize: 15, lineHeight: 1.55 }}>
        Enter the words at the following positions from the phrase you just wrote down.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {positions.map((p, i) => (
          <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              style={{
                minWidth: 80,
                fontFamily: 'var(--f-mono)',
                fontSize: 11,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--gray)',
              }}
            >
              Word #{p + 1}
            </span>
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
              style={{
                flex: 1,
                minHeight: 44,
                padding: '0 12px',
                border: '1px solid var(--rule)',
                borderRadius: 'var(--radius)',
                background: 'var(--paper)',
                color: 'var(--ink)',
                fontFamily: 'var(--f-body)',
                fontSize: 14,
              }}
            />
          </label>
        ))}
      </div>
      {error && (
        <p
          data-testid="confirm-error"
          style={{
            color: 'var(--rose)',
            marginTop: 12,
            fontFamily: 'var(--f-body)',
            padding: 10,
            background: 'rgba(177,52,52,0.06)',
            border: '1px solid var(--rose)',
            borderRadius: 'var(--radius)',
          }}
        >
          {error}
        </p>
      )}
      <div style={{ marginTop: 16 }}>
        <Button
          variant="primary"
          data-testid="confirm-submit"
          onClick={submit}
          disabled={submitting || answers.some((a) => a.trim().length === 0)}
        >
          Confirm
        </Button>
      </div>
    </section>
  );
}
