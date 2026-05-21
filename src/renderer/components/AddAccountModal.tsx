import { useState } from 'react';

type ProviderChoice = 'google' | 'microsoft';

export interface AddAccountModalProps {
  open: boolean;
  onClose(): void;
  onConnected?(): void | Promise<void>;
}

function isErr(v: unknown): v is { error: string } {
  return !!v && typeof v === 'object' && 'error' in v;
}

const PROVIDERS: Array<{ id: ProviderChoice; letter: string; letterColor: string; letterBg: string; name: string; scopes: string }> = [
  {
    id: 'microsoft',
    letter: 'M',
    letterColor: '#0078d4',
    letterBg: 'rgba(0,120,212,0.1)',
    name: 'Microsoft Outlook / M365',
    scopes: 'Mail.Read + Calendars.ReadWrite (Graph)',
  },
  {
    id: 'google',
    letter: 'G',
    letterColor: '#4285f4',
    letterBg: 'rgba(66,133,244,0.1)',
    name: 'Google · Gmail + Calendar',
    scopes: 'gmail.readonly + calendar.events (loopback OAuth)',
  },
];

export function AddAccountModal({ open, onClose, onConnected }: AddAccountModalProps): JSX.Element | null {
  const [selected, setSelected] = useState<ProviderChoice>('microsoft');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const selectedProvider = PROVIDERS.find(p => p.id === selected)!;

  async function connect(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = selected === 'microsoft'
        ? await window.aria.microsoftConnect()
        : await window.aria.gmailConnect();
      const failed = isErr(result) || Boolean((result as { ok?: boolean }).ok === false);
      if (failed) {
        setError('error' in result ? result.error : 'connect-failed');
        return;
      }
      await onConnected?.();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="add-account-modal"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: 500, maxWidth: '92vw',
        background: 'var(--paper)',
        borderRadius: 'var(--radius)',
        padding: '28px 32px',
        boxShadow: '0 8px 48px rgba(0,0,0,0.22)',
        fontFamily: 'var(--f-body)',
        color: 'var(--ink)',
      }}>
        {/* Header */}
        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 8 }}>
          Add account
        </div>
        <h3 style={{ fontFamily: 'var(--f-display)', fontSize: 24, fontWeight: 400, margin: '0 0 8px', color: 'var(--ink)' }}>
          Choose a provider
        </h3>
        <p style={{ fontSize: 13, color: 'var(--ink-soft, #6b6455)', margin: '0 0 20px', lineHeight: 1.5 }}>
          Aria reads from Google and Microsoft for mail + calendar. You can connect more than one of each.
        </p>

        {/* Provider options */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {PROVIDERS.map(provider => (
            <label
              key={provider.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '14px 16px', borderRadius: 'var(--radius)',
                border: `1px solid ${selected === provider.id ? 'var(--gold)' : 'var(--rule)'}`,
                background: selected === provider.id ? 'rgba(185,144,60,0.04)' : 'var(--paper)',
                cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              <input
                type="radio"
                name="provider"
                value={provider.id}
                checked={selected === provider.id}
                onChange={() => setSelected(provider.id)}
                style={{ accentColor: 'var(--gold)', width: 16, height: 16, flexShrink: 0 }}
              />
              {/* Provider avatar */}
              <div style={{
                width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                background: provider.letterBg, color: provider.letterColor,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--f-display)', fontSize: 16, fontWeight: 400,
              }}>
                {provider.letter}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', marginBottom: 2 }}>
                  {provider.name}
                </div>
                <code style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--gray)', letterSpacing: '0.02em' }}>
                  {provider.scopes}
                </code>
              </div>
            </label>
          ))}
        </div>

        {/* Privacy note */}
        <div style={{
          padding: '10px 14px', borderLeft: '2px solid var(--gold)',
          background: 'rgba(185,144,60,0.04)',
          borderRadius: '0 var(--radius) var(--radius) 0',
          fontSize: 12, color: 'var(--ink-soft, #6b6455)', lineHeight: 1.55,
          marginBottom: 20,
        }}>
          OAuth opens in a separate window. Tokens go to your OS keychain via{' '}
          <code style={{ fontFamily: 'var(--f-mono)', fontSize: 11 }}>safeStorage</code>;
          Aria's servers never see them.
        </div>

        {/* Error */}
        {error && (
          <p role="alert" data-testid="add-account-error" style={{ fontSize: 13, color: 'var(--rose, #b13434)', margin: '0 0 14px' }}>
            {error}
          </p>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            data-testid="add-account-cancel"
            style={{ padding: '9px 18px', border: '1px solid var(--rule)', borderRadius: 'var(--radius)', background: 'var(--paper)', color: 'var(--ink-soft, #6b6455)', fontFamily: 'var(--f-body)', fontSize: 13, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void connect()}
            disabled={busy}
            data-testid="add-account-connect"
            style={{ padding: '9px 20px', border: 'none', borderRadius: 'var(--radius)', background: 'var(--gold)', color: '#fff', fontFamily: 'var(--f-body)', fontSize: 13, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1, transition: 'opacity 0.15s' }}
          >
            {busy ? 'Connecting…' : `Continue with ${selectedProvider.id === 'microsoft' ? 'Microsoft' : 'Google'} →`}
          </button>
        </div>
      </div>
    </div>
  );
}
