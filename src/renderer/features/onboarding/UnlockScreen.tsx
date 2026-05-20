/**
 * Daily-unlock screen. Five consecutive failures surface a "Forgot password?
 * Restore from backup" link that routes to /restore (RestoreScreen lives in
 * Task 3b).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLogo, Button } from '../../components/editorial';

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
    <section
      data-testid="unlock-screen"
      style={{
        padding: 32,
        maxWidth: 480,
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
        Daily unlock
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
        Unlock Aria
      </h1>
      <input
        type="password"
        data-testid="unlock-input"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && password.length > 0 && !busy) void submit();
        }}
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
          boxSizing: 'border-box',
        }}
      />
      {error && (
        <p
          data-testid="unlock-error"
          style={{
            color: 'var(--rose)',
            marginTop: 12,
            padding: 10,
            background: 'rgba(177,52,52,0.06)',
            border: '1px solid var(--rose)',
            borderRadius: 'var(--radius)',
          }}
        >
          {error} ({failures}/{MAX_FAILURES})
        </p>
      )}
      <div style={{ marginTop: 16 }}>
        <Button
          variant="primary"
          data-testid="unlock-submit"
          onClick={submit}
          disabled={busy || password.length === 0}
        >
          {busy ? 'Unlocking…' : 'Unlock'}
        </Button>
      </div>
      {failures >= MAX_FAILURES && (
        <p style={{ marginTop: 24 }}>
          <a
            href="#"
            data-testid="unlock-forgot-link"
            onClick={(e) => {
              e.preventDefault();
              navigate('/restore');
            }}
            style={{ color: 'var(--ink)', textDecoration: 'underline' }}
          >
            Forgot password? Restore from backup
          </a>
        </p>
      )}
    </section>
  );
}
