/**
 * Onboarding wizard state machine — 3 steps:
 *   1. show     — render mnemonic, gated by "I've written these down"
 *   2. confirm  — 3-word position challenge
 *   3. password — daily-unlock password (min 8 chars), then seal vault + open DB
 */
import { useEffect, useState } from 'react';
import { MnemonicShow } from './MnemonicShow';
import { MnemonicConfirm } from './MnemonicConfirm';

type Step = 'loading' | 'show' | 'confirm' | 'password' | 'sealing' | 'done';

export interface OnboardingWizardProps {
  onComplete: () => void;
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps): JSX.Element {
  const [step, setStep] = useState<Step>('loading');
  const [words, setWords] = useState<string[]>([]);
  const [positions, setPositions] = useState<number[]>([]);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

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
        onConfirmed={() => setStep('password')}
      />
    );
  }
  if (step === 'password' || step === 'sealing') {
    return (
      <section data-testid="onboarding-password" style={{ padding: 24, maxWidth: 480 }}>
        <h1 style={{ marginTop: 0 }}>Choose your daily password</h1>
        <p>
          You'll type this every day to unlock Aria. Minimum 8 characters. If you
          forget it, you can recover with your 12-word phrase.
        </p>
        <input
          type="password"
          data-testid="password-input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ width: '100%', padding: 8, fontSize: 16 }}
        />
        {error && (
          <p data-testid="password-error" style={{ color: 'crimson' }}>
            {error}
          </p>
        )}
        <button
          data-testid="password-submit"
          disabled={password.length < 8 || step === 'sealing'}
          onClick={seal}
          style={{ marginTop: 16, padding: '8px 16px' }}
        >
          {step === 'sealing' ? 'Sealing…' : 'Finish setup'}
        </button>
      </section>
    );
  }
  return <p data-testid="onboarding-done">Done.</p>;
}
