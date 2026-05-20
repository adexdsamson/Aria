/**
 * Onboarding wizard state machine — 3 steps:
 *   1. show     — render mnemonic, gated by "I've written these down"
 *   2. confirm  — 3-word position challenge
 *   3. password — daily-unlock password (min 8 chars), then seal vault + open DB
 */
import { useEffect, useState } from 'react';
import { MnemonicShow } from './MnemonicShow';
import { MnemonicConfirm } from './MnemonicConfirm';
import { CountrySectorPicker } from './CountrySectorPicker';
import { AppLogo, Button, Card } from '../../components/editorial';

type Step = 'loading' | 'show' | 'confirm' | 'news-picker' | 'password' | 'sealing' | 'done';

export interface OnboardingWizardProps {
  onComplete: () => void;
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps): JSX.Element {
  const [step, setStep] = useState<Step>('loading');
  const [words, setWords] = useState<string[]>([]);
  const [positions, setPositions] = useState<number[]>([]);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [newsSelection, setNewsSelection] = useState<{ country: string; sectors: string[] } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = (await window.aria.onboardingGenMnemonic()) as {
        mnemonic: string;
        positions: number[];
      };
      if (cancelled) return;
      setWords(res.mnemonic.split(' '));
      setPositions(res.positions);
      setStep('show');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function seal(): Promise<void> {
    setStep('sealing');
    setError(null);
    const res = (await window.aria.onboardingSeal({
      dailyPassword: password,
      passphrase: password,
    } as never)) as { ok?: true; error?: string };
    if (res.ok) {
      // Post-UAT correction: DB is only open after seal succeeds. Persist
      // the buffered news selection here; non-blocking on failure — user
      // can re-pick via Settings → News Sources.
      if (newsSelection) {
        try {
          const newsRes = (await window.aria.newsSetBundle(newsSelection)) as
            | { ok: boolean }
            | { error: string };
          if ('error' in newsRes || ('ok' in newsRes && !newsRes.ok)) {
            // eslint-disable-next-line no-console
            console.warn('newsSetBundle failed post-seal; user can re-pick in Settings', newsRes);
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('newsSetBundle threw post-seal; user can re-pick in Settings', err);
        }
      }
      setStep('done');
      onComplete();
    } else {
      setError(res.error ?? 'Seal failed');
      setStep('password');
    }
  }

  if (step === 'loading') return <p data-testid="onboarding-loading">Preparing…</p>;
  if (step === 'show') {
    return (
      <MnemonicShow
        words={words}
        onContinue={() => {
          setWords([]); // drop local copy
          setStep('confirm');
        }}
      />
    );
  }
  if (step === 'confirm') {
    return (
      <MnemonicConfirm
        positions={positions}
        onPositionsUpdated={setPositions}
        onConfirmed={() => setStep('news-picker')}
      />
    );
  }
  if (step === 'news-picker') {
    return (
      <CountrySectorPicker
        onSelected={(sel) => {
          setNewsSelection(sel);
          setStep('password');
        }}
      />
    );
  }
  if (step === 'password' || step === 'sealing') {
    return (
      <section
        data-testid="onboarding-password"
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
          Step 4 of 4 · seal your vault
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
          Choose your daily password
        </h1>
        <p style={{ color: 'var(--ink-soft)', fontSize: 15, lineHeight: 1.55 }}>
          You&apos;ll type this every day to unlock Aria. Minimum 8 characters. If you
          forget it, you can recover with your 12-word phrase.
        </p>
        <input
          type="password"
          data-testid="password-input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={step === 'sealing'}
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
        {step === 'sealing' && (
          <div
            data-testid="onboarding-sealing"
            style={{
              marginTop: 16,
              padding: 14,
              background: 'var(--ivory-deep)',
              border: '1px solid var(--rule)',
              borderTop: '2px solid var(--gold)',
              borderRadius: 'var(--radius)',
            }}
          >
            <div
              style={{
                fontFamily: 'var(--f-display)',
                fontStyle: 'italic',
                fontSize: 18,
                color: 'var(--ink)',
                marginBottom: 4,
              }}
            >
              Sealing your vault…
            </div>
            <div
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 10,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: 'var(--gray)',
              }}
            >
              5–15 seconds on this machine
            </div>
          </div>
        )}
        {error && (
          <Card style={{ marginTop: 16, padding: 14, borderTop: '2px solid var(--rose)' }}>
            <p data-testid="password-error" style={{ color: 'var(--rose)', margin: 0, fontFamily: 'var(--f-body)' }}>
              {error}
            </p>
          </Card>
        )}
        <div style={{ marginTop: 20 }}>
          <Button
            variant="primary"
            data-testid="password-submit"
            disabled={password.length < 8 || step === 'sealing'}
            onClick={seal}
          >
            {step === 'sealing' ? 'Sealing…' : 'Finish setup'}
          </Button>
        </div>
      </section>
    );
  }
  return <p data-testid="onboarding-done">Done.</p>;
}
