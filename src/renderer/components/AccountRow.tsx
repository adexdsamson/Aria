import { useState } from 'react';
import type { ProviderAccountDto } from '../../shared/ipc-contract';

export interface AccountRowProps {
  account: ProviderAccountDto;
  onDisconnect(account: ProviderAccountDto): void | Promise<void>;
  onSync?(account: ProviderAccountDto): void | Promise<void>;
  onSaveLabel?(account: ProviderAccountDto, label: string): void | Promise<void>;
}

export function AccountRow({ account, onDisconnect, onSync, onSaveLabel }: AccountRowProps): JSX.Element {
  const [syncing, setSyncing] = useState(false);
  const label = account.displayLabel || account.displayEmail;
  const needsAuth = account.status === 'needs-auth';
  const degraded = account.status === 'degraded';
  const dotColor = needsAuth
    ? '#c98a3a'
    : degraded
      ? '#b34'
      : '#1f7a4d';

  async function handleSync(): Promise<void> {
    if (!onSync || syncing) return;
    setSyncing(true);
    try {
      await onSync(account);
    } finally {
      setSyncing(false);
    }
  }
  return (
    <article data-testid={`account-row-${account.providerKey}-${account.accountId}`} style={rowStyle()}>
      <span aria-hidden style={{ ...dotStyle(), background: dotColor }} />
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <strong
            data-testid={`account-label-${account.accountId}`}
            style={{
              fontFamily: 'var(--f-display)',
              fontWeight: 500,
              fontSize: 17,
              letterSpacing: '-0.005em',
              color: 'var(--ink)',
            }}
          >
            {label}
          </strong>
          <span data-testid={`account-status-${account.accountId}`} style={chipStyle(needsAuth, degraded)}>
            {account.status}
          </span>
        </div>
        <div
          data-testid={`account-email-${account.accountId}`}
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--gray-soft)',
            marginTop: 4,
          }}
        >
          {providerDisplayName(account.providerKey)} · {account.displayEmail}
        </div>
        {account.lastError && (
          <div
            role="alert"
            style={{
              color: '#b34',
              fontFamily: 'var(--f-mono)',
              fontSize: 12,
              marginTop: 6,
            }}
          >
            {account.lastError}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flex: '0 0 auto' }}>
        {onSaveLabel && (
          <button
            type="button"
            data-testid={`account-save-label-${account.accountId}`}
            onClick={() => void onSaveLabel(account, label)}
            style={linkBtnStyle()}
          >
            Save label
          </button>
        )}
        {needsAuth && (
          <button
            type="button"
            data-testid={`account-reconnect-${account.accountId}`}
            style={linkBtnStyle()}
          >
            Reconnect
          </button>
        )}
        {onSync && !needsAuth && (
          <button
            type="button"
            data-testid={`account-sync-${account.accountId}`}
            onClick={() => void handleSync()}
            disabled={syncing}
            style={linkBtnStyle()}
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        )}
        <button
          type="button"
          data-testid={`account-disconnect-${account.accountId}`}
          onClick={() => void onDisconnect(account)}
          style={linkBtnStyle()}
        >
          Disconnect
        </button>
      </div>
    </article>
  );
}

function providerDisplayName(providerKey: ProviderAccountDto['providerKey']): string {
  if (providerKey === 'microsoft') return 'Outlook';
  if (providerKey === 'todoist') return 'Todoist';
  return 'Google';
}

function rowStyle(): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    borderTop: '1px solid var(--rule)',
    padding: '18px 4px',
  };
}

function dotStyle(): React.CSSProperties {
  return {
    width: 9,
    height: 9,
    borderRadius: 999,
    flex: '0 0 auto',
    marginTop: 2,
    boxShadow: '0 0 0 3px rgba(0,0,0,0.03)',
  };
}

function chipStyle(needsAuth: boolean, degraded: boolean): React.CSSProperties {
  const color = needsAuth ? '#c98a3a' : degraded ? '#b34' : 'var(--gold, #8a6d3b)';
  return {
    fontFamily: 'var(--f-mono)',
    fontSize: 10,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color,
    border: `1px solid ${color}`,
    borderRadius: 2,
    padding: '1px 6px',
    lineHeight: 1.4,
  };
}

function linkBtnStyle(): React.CSSProperties {
  return {
    background: 'transparent',
    border: 'none',
    padding: '4px 0',
    fontFamily: 'var(--f-display)',
    fontSize: 15,
    color: 'var(--ink)',
    cursor: 'pointer',
    borderBottom: '1px solid transparent',
    transition: 'border-color 160ms ease, color 160ms ease',
  };
}
