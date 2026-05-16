/**
 * Daily-unlock screen. Five consecutive failures surface a "Forgot password?
 * Restore from backup" link that routes to /restore (RestoreScreen lives in
 * Task 3b).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const MAX_FAILURES = 5;

export interface UnlockScreenProps {
  onUnlocked: () => void;
}

export function UnlockScreen({ onUnlocked }: UnlockScreenProps): JSX.Element {
  const [password, setPassword] = useState('');
  const [failures, setFailures] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = (await window.aria.onboardingUnlock({
        passphrase: password,
        dailyPassword: password,
      } as never)) as { ok?: boolean; error?: string };
      if (res.ok) {
        onUnlocked();
      } else {
        setFailures((f) => f + 1);
        setError(res.error === 'VAULT_TAMPERED' ? 'Vault appears tampered.' : 'Wrong password.');
        setPassword('');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid="unlock-screen" style={{ padding: 24, maxWidth: 480 }}>
      <h1 style={{ marginTop: 0 }}>Unlock Aria</h1>
      <input
        type="password"
        data-testid="unlock-input"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && password.length > 0 && !busy) void submit();
        }}
        style={{ width: '100%', padding: 8, fontSize: 16 }}
      />
      {error && (
        <p data-testid="unlock-error" style={{ color: 'crimson' }}>
          {error} ({failures}/{MAX_FAILURES})
        </p>
      )}
      <button
        data-testid="unlock-submit"
        onClick={submit}
        disabled={busy || password.length === 0}
        style={{ marginTop: 16, padding: '8px 16px' }}
      >
        {busy ? 'Unlocking…' : 'Unlock'}
      </button>
      {failures >= MAX_FAILURES && (
        <p style={{ marginTop: 24 }}>
          <a
            href="#"
            data-testid="unlock-forgot-link"
            onClick={(e) => {
              e.preventDefault();
              navigate('/restore');
            }}
          >
            Forgot password? Restore from backup
          </a>
        </p>
      )}
    </section>
  );
}
