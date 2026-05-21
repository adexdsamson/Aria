/**
 * Plan 08.1-03 Task 3 — ActivateLicenseForm.
 *
 * Single input + submit. Validates the key format client-side BEFORE calling
 * the activation IPC to avoid wasted round-trips. Maps typed server-error
 * codes to actionable inline copy.
 */
import { useCallback, useState } from 'react';
import { useEntitlement } from './useEntitlement';
import { Button } from '../../components/editorial';
import { openCustomerPortal, setToastImpl } from '../../lib/entitlement-actions';

// ARIA-<26 Crockford base32 chars>-<4 hex checksum>
// Crockford base32 excludes I, L, O, U; case-insensitive.
const KEY_RE = /^ARIA-[0-9A-HJKMNP-TV-Z]{26}-[0-9A-F]{4}$/i;

export interface ActivateLicenseFormProps {
  /** Called after a successful activation OR when the user clicks Cancel. */
  onClose?: () => void;
  /** Backwards-compat alias for onClose used by some call sites. */
  onCancel?: () => void;
  initialKey?: string;
  /** Optional toast surface for "Activated!" copy (defaults to console). */
  showToast?: (kind: 'success' | 'error' | 'info', message: string) => void;
}

type ServerErrorCode =
  | 'install-cap-exceeded'
  | 'key-not-found'
  | 'key-revoked'
  | 'invalid-signature'
  | 'already-bound'
  | 'revoked'
  | 'rate-limited'
  | 'network-timeout'
  | 'network-error'
  | 'server-error'
  | 'bad-response'
  | 'bad-request'
  | string;

function copyForCode(code: ServerErrorCode): string {
  switch (code) {
    case 'install-cap-exceeded':
      return 'This key is already in use on 3 devices. Manage your installs in the Customer Portal.';
    case 'key-not-found':
      return 'Key not recognized. Double-check the key in your activation email.';
    case 'key-revoked':
    case 'revoked':
      return 'This key has been revoked. Contact support.';
    case 'rate-limited':
      return 'Too many attempts. Wait a minute and try again.';
    case 'network-timeout':
    case 'network-error':
      return "Couldn't reach the activation server. Check your connection and try again.";
    case 'server-error':
    case 'bad-response':
      return 'The activation server returned an unexpected response. Try again in a moment.';
    case 'bad-request':
      return "That key doesn't look right. Re-paste the entire ARIA-… key from your email.";
    case 'invalid-signature':
      return 'The activation response failed signature verification. Restart Aria and try again.';
    default:
      return `Activation failed (${code}). Contact support if this persists.`;
  }
}

export function ActivateLicenseForm(props: ActivateLicenseFormProps): JSX.Element {
  const { activate } = useEntitlement();
  const [key, setKey] = useState(props.initialKey ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(
    null,
  );
  const [formatHint, setFormatHint] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    const cb = props.onClose ?? props.onCancel;
    cb?.();
  }, [props.onClose, props.onCancel]);

  const onSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const trimmed = key.trim();
      setError(null);
      setFormatHint(null);
      if (!KEY_RE.test(trimmed)) {
        setFormatHint(
          "Doesn't look like a valid Aria key — they start with 'ARIA-'.",
        );
        return;
      }
      setBusy(true);
      try {
        const res = await activate(trimmed);
        if (res.ok) {
          if (props.showToast) {
            props.showToast('success', 'Activated! Welcome to Pro.');
          } else {
            // Fallback to console for test envs without a toast host.
            // eslint-disable-next-line no-console
            console.log('[success] Activated! Welcome to Pro.');
          }
          handleClose();
        } else {
          setError({
            code: res.error.code,
            message: copyForCode(res.error.code),
          });
        }
      } catch (err) {
        setError({
          code: 'network-error',
          message: copyForCode('network-error'),
        });
        // eslint-disable-next-line no-console
        console.error('[activate]', err);
      } finally {
        setBusy(false);
      }
    },
    [activate, key, props, handleClose],
  );

  return (
    <form
      onSubmit={onSubmit}
      data-testid="activate-license-form"
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <label
        htmlFor="activate-license-key"
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--gray)',
        }}
      >
        License key
      </label>
      <input
        id="activate-license-key"
        data-testid="activate-license-input"
        type="text"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="ARIA-XXXXXXXXXXXXXXXXXXXXXXXXXX-XXXX"
        autoComplete="off"
        spellCheck={false}
        disabled={busy}
        style={{
          width: '100%',
          minHeight: 44,
          padding: '0 14px',
          borderRadius: 'var(--radius)',
          border: '1px solid var(--rule)',
          background: 'var(--paper)',
          color: 'var(--ink)',
          fontFamily: 'var(--f-mono)',
          fontSize: 13,
          letterSpacing: '0.04em',
          boxSizing: 'border-box',
          outline: 'none',
          transition: 'border-color 0.15s',
        }}
        onFocus={e => { e.currentTarget.style.borderColor = 'var(--gold)'; }}
        onBlur={e => { e.currentTarget.style.borderColor = 'var(--rule)'; }}
      />
      {formatHint && (
        <p
          role="alert"
          data-testid="activate-format-hint"
          style={{ color: 'var(--rose)', fontSize: 12, margin: 0, fontFamily: 'var(--f-mono)' }}
        >
          {formatHint}
        </p>
      )}
      {error && (
        <div
          role="alert"
          data-testid={`activate-error-${error.code}`}
          style={{
            color: 'var(--ink)',
            fontSize: 13,
            padding: '10px 14px',
            border: '1px solid var(--rose)',
            background: 'rgba(177,52,52,0.06)',
            borderRadius: 'var(--radius)',
            fontFamily: 'var(--f-body)',
          }}
        >
          <p style={{ margin: 0 }}>{error.message}</p>
          {error.code === 'install-cap-exceeded' && (
            <button
              type="button"
              data-testid="activate-error-portal-link"
              onClick={() => { void openCustomerPortal(); }}
              style={{ marginTop: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--gold)', textDecoration: 'underline', fontSize: 13 }}
            >
              Open Customer Portal
            </button>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <Button
          type="submit"
          variant="primary"
          data-testid="activate-submit"
          disabled={busy}
        >
          {busy ? 'Activating…' : 'Activate'}
        </Button>
        <Button
          variant="ghost"
          data-testid="activate-cancel"
          onClick={handleClose}
          disabled={busy}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

// Re-export for tests that want to inject a toast surface globally.
export { setToastImpl };
