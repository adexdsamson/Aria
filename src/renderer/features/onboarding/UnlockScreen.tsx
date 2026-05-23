/**
 * Daily-unlock screen — editorial morning ritual.
 *
 * The first thing the user sees every day. Designed to feel like opening a
 * leather-bound daybook: centered card with a left gold gutter rule, a quiet
 * time-of-day greeting in Playfair italic, a letterpress-feel password field
 * (thin gold baseline that thickens on focus), and a single commitment button.
 *
 * Behavior preserved verbatim from the prior version:
 *   - Same `window.aria.onboardingUnlock` IPC contract
 *   - Same `onUnlocked` prop
 *   - Same five-failure restore link route (/restore)
 *   - All data-testids unchanged: unlock-screen, unlock-input, unlock-error,
 *     unlock-submit, unlock-forgot-link
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MonogramSquare } from '../../components/editorial';

const MAX_FAILURES = 5;

export interface UnlockScreenProps {
  onUnlocked: () => void;
}

function greetingForHour(h: number): string {
  if (h < 5) return 'Late evening';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Quiet hours';
}

/**
 * Quick 260523-eaf — render the time-of-day greeting, personalized when
 * the user provided a display name during onboarding. Falls back to the
 * generic form when `displayName` is null/empty (fresh install, restore
 * from mnemonic, profile.json read failure).
 */
function formatGreeting(base: string, displayName: string | null): string {
  if (displayName && displayName.trim().length > 0) {
    return `${base}, ${displayName.trim()}.`;
  }
  return `${base}.`;
}

function formatDate(d: Date): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(d);
  } catch {
    return d.toDateString();
  }
}

export function UnlockScreen({ onUnlocked }: UnlockScreenProps): JSX.Element {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [failures, setFailures] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const now = useMemo(() => new Date(), []);
  const greetingBase = greetingForHour(now.getHours());
  const greeting = formatGreeting(greetingBase, displayName);
  const dateLabel = formatDate(now);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Quick 260523-eaf — fetch the display name once on mount. PROFILE_GET
  // runs pre-unlock (no DB dependency) and returns `null` on any failure,
  // so the greeting safely falls back to the generic form.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = (await window.aria.profileGet()) as { displayName: string | null } | { error: string };
        if (cancelled) return;
        if ('displayName' in res) setDisplayName(res.displayName);
      } catch {
        // Swallow — generic greeting is the safe fallback.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(): Promise<void> {
    if (busy || password.length === 0) return;
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
        inputRef.current?.focus();
      }
    } finally {
      setBusy(false);
    }
  }

  const showRecovery = failures >= MAX_FAILURES;

  return (
    <div
      data-testid="unlock-screen"
      style={{
        flex: '1 1 auto',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 24px',
        background: 'var(--ivory)',
        // Subtle paper grain — radial vignette + low-opacity diagonal weave
        backgroundImage:
          'radial-gradient(circle at 30% 20%, rgba(184,134,11,0.04) 0%, transparent 55%), ' +
          'radial-gradient(circle at 75% 80%, rgba(184,134,11,0.025) 0%, transparent 50%)',
        color: 'var(--ink)',
        fontFamily: 'var(--f-body)',
      }}
    >
      <section
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 420,
          background: 'var(--paper)',
          border: '1px solid var(--rule)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 1px 0 rgba(0,0,0,0.02), 0 24px 48px -24px rgba(26,26,26,0.12)',
          padding: '40px 36px 32px',
          overflow: 'hidden',
        }}
      >
        {/* Editorial left gutter — thin gold rule */}
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            top: 28,
            bottom: 28,
            width: 2,
            background: 'var(--gold)',
            opacity: 0.85,
          }}
        />

        {/* Compact brand mark — no Est. tag, no subtitle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <MonogramSquare size={26} />
          <span
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 18,
              fontWeight: 500,
              letterSpacing: '-0.01em',
              color: 'var(--ink)',
            }}
          >
            Aria
          </span>
        </div>

        {/* Time-of-day greeting — quiet, personal */}
        <p
          style={{
            fontFamily: 'var(--f-display)',
            fontStyle: 'italic',
            fontSize: 14,
            color: 'var(--ink-soft)',
            margin: '0 0 4px 0',
            opacity: 0.7,
          }}
        >
          {greeting}
        </p>

        {/* Single heading — no competing eyebrow */}
        <h1
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 30,
            fontWeight: 500,
            letterSpacing: '-0.015em',
            color: 'var(--ink)',
            margin: '0 0 6px 0',
            lineHeight: 1.15,
          }}
        >
          Welcome back
        </h1>

        <p
          style={{
            fontSize: 14,
            color: 'var(--ink-soft)',
            margin: '0 0 28px 0',
            opacity: 0.78,
            lineHeight: 1.5,
          }}
        >
          Type your daily password to open the vault.
        </p>

        {/* Letterpress-style password field — thin baseline rule, no boxed border */}
        <div style={{ position: 'relative', marginBottom: error ? 12 : 24 }}>
          <input
            ref={inputRef}
            type={showPassword ? 'text' : 'password'}
            data-testid="unlock-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
            placeholder="Daily password"
            autoComplete="current-password"
            disabled={busy}
            aria-label="Daily password"
            style={{
              width: '100%',
              padding: '10px 44px 10px 0',
              fontSize: 17,
              fontFamily: 'var(--f-body)',
              color: 'var(--ink)',
              background: 'transparent',
              border: 'none',
              borderBottom: '2px solid var(--rule-strong)',
              outline: 'none',
              boxSizing: 'border-box',
              transition: 'border-color 180ms ease',
            }}
            onFocus={(e) => (e.currentTarget.style.borderBottomColor = 'var(--gold)')}
            onBlur={(e) => (e.currentTarget.style.borderBottomColor = 'var(--rule-strong)')}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            tabIndex={-1}
            style={{
              position: 'absolute',
              right: 0,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              padding: 6,
              cursor: 'pointer',
              color: 'var(--ink-soft)',
              opacity: 0.55,
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.55')}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>

        {error && (
          <p
            data-testid="unlock-error"
            role="alert"
            style={{
              fontSize: 13,
              color: 'var(--rose)',
              margin: '0 0 20px 0',
              padding: '8px 12px',
              background: 'rgba(184,73,58,0.06)',
              borderLeft: '2px solid var(--rose)',
              borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
            }}
          >
            {error}{' '}
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, opacity: 0.75 }}>
              · {failures}/{MAX_FAILURES}
            </span>
          </p>
        )}

        {/* Single commitment — full-width button */}
        <button
          type="button"
          data-testid="unlock-submit"
          onClick={() => void submit()}
          disabled={busy || password.length === 0}
          style={{
            width: '100%',
            padding: '12px 16px',
            fontSize: 14,
            fontFamily: 'var(--f-body)',
            fontWeight: 600,
            letterSpacing: '0.01em',
            color: 'var(--paper)',
            background: busy || password.length === 0 ? 'var(--rule-strong)' : 'var(--ink)',
            border: 'none',
            borderRadius: 'var(--radius)',
            cursor: busy || password.length === 0 ? 'not-allowed' : 'pointer',
            transition: 'background 160ms ease, transform 80ms ease',
          }}
          onMouseEnter={(e) => {
            if (!busy && password.length > 0) e.currentTarget.style.background = 'var(--ink-soft)';
          }}
          onMouseLeave={(e) => {
            if (!busy && password.length > 0) e.currentTarget.style.background = 'var(--ink)';
          }}
          onMouseDown={(e) => {
            if (!busy && password.length > 0) e.currentTarget.style.transform = 'translateY(1px)';
          }}
          onMouseUp={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
        >
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>

        {/* Recovery link — always present, quieter; promoted by error count */}
        <div
          style={{
            marginTop: 20,
            paddingTop: 16,
            borderTop: '1px solid var(--rule)',
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'var(--ink-soft)',
              opacity: 0.55,
            }}
          >
            {dateLabel}
          </span>
          <a
            href="#"
            data-testid="unlock-forgot-link"
            onClick={(e) => {
              e.preventDefault();
              navigate('/restore');
            }}
            style={{
              fontSize: 12,
              color: showRecovery ? 'var(--gold-deep)' : 'var(--ink-soft)',
              opacity: showRecovery ? 1 : 0.6,
              textDecoration: 'underline',
              textDecorationColor: 'var(--rule-strong)',
              textUnderlineOffset: 3,
              transition: 'color 160ms ease, opacity 160ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--gold-deep)';
              e.currentTarget.style.opacity = '1';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = showRecovery ? 'var(--gold-deep)' : 'var(--ink-soft)';
              e.currentTarget.style.opacity = showRecovery ? '1' : '0.6';
            }}
          >
            {showRecovery ? 'Restore from backup' : 'Forgot password?'}
          </a>
        </div>
      </section>
    </div>
  );
}
