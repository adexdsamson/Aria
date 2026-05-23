/**
 * Onboarding step 1 — introduce yourself.
 *
 * Collects the display name shown on UnlockScreen ("Good morning, <name>.").
 * Required, non-empty after trim. Stored in plaintext `profile.json` via
 * window.aria.profileSet — buffered by OnboardingWizard and written inside
 * `seal()` alongside the news bundle (same pattern as newsSelection).
 *
 * Quick task 260523-eaf.
 */
import { useEffect, useRef, useState } from 'react';
import { AppLogo, Button } from '../../components/editorial';

export interface NameStepProps {
  initialValue?: string;
  onContinue: (displayName: string) => void;
}

export function NameStep({ initialValue = '', onContinue }: NameStepProps): JSX.Element {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = value.trim();
  const canContinue = trimmed.length > 0;

  function submit(): void {
    if (!canContinue) return;
    onContinue(trimmed);
  }

  return (
    <section
      data-testid="onboarding-name"
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
        Step 1 of 5 · introduce yourself
      </div>
      <h1
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 32,
          fontWeight: 500,
          letterSpacing: '-0.01em',
          color: 'var(--ink)',
          marginTop: 0,
          marginBottom: 12,
        }}
      >
        What should Aria call you?
      </h1>
      <p style={{ color: 'var(--ink-soft)', fontSize: 15, lineHeight: 1.55 }}>
        This stays on your machine. You can change it any time in Settings.
      </p>
      <input
        ref={inputRef}
        type="text"
        data-testid="name-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        placeholder="Your name"
        autoComplete="given-name"
        aria-label="Your name"
        maxLength={80}
        style={{
          width: '100%',
          minHeight: 44,
          padding: '0 12px',
          fontSize: 16,
          border: '1px solid var(--rule)',
          borderRadius: 'var(--radius)',
          background: 'var(--paper)',
          color: 'var(--ink)',
          fontFamily: 'var(--f-body)',
          marginTop: 8,
          boxSizing: 'border-box',
        }}
      />
      <div style={{ marginTop: 20 }}>
        <Button
          variant="primary"
          data-testid="name-submit"
          disabled={!canContinue}
          onClick={submit}
        >
          Continue
        </Button>
      </div>
    </section>
  );
}
