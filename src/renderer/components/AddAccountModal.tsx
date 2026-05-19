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

export function AddAccountModal({ open, onClose, onConnected }: AddAccountModalProps): JSX.Element | null {
  const [selected, setSelected] = useState<ProviderChoice>('microsoft');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

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
    <div role="dialog" aria-modal="true" data-testid="add-account-modal" style={backdropStyle()}>
      <div style={modalStyle()}>
        <h3 style={{ marginTop: 0 }}>Add account</h3>
        <p style={{ color: '#64748b' }}>Connect a Google or Microsoft account for mail and calendar sync.</p>
        <div style={{ display: 'grid', gap: 8 }}>
          {(['microsoft', 'google'] as const).map((provider) => (
            <label key={provider} style={choiceStyle(selected === provider)}>
              <input
                type="radio"
                name="provider"
                value={provider}
                checked={selected === provider}
                onChange={() => setSelected(provider)}
              />
              <span>{provider === 'microsoft' ? 'Microsoft Outlook / M365' : 'Google Gmail + Calendar'}</span>
            </label>
          ))}
        </div>
        {error && <p role="alert" data-testid="add-account-error" style={{ color: '#b91c1c' }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onClose} disabled={busy} data-testid="add-account-cancel">Cancel</button>
          <button type="button" onClick={() => void connect()} disabled={busy} data-testid="add-account-connect">
            Connect
          </button>
        </div>
      </div>
    </div>
  );
}

function backdropStyle(): React.CSSProperties {
  return {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(15, 23, 42, 0.42)',
  };
}

function modalStyle(): React.CSSProperties {
  return {
    width: 460,
    maxWidth: '92vw',
    borderRadius: 12,
    background: '#fff',
    padding: 20,
    boxShadow: '0 24px 60px rgba(15, 23, 42, 0.24)',
  };
}

function choiceStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    border: `1px solid ${active ? '#2563eb' : '#cbd5e1'}`,
    borderRadius: 10,
    padding: 12,
    background: active ? '#eff6ff' : '#fff',
  };
}
