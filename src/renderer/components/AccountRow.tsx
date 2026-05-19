import type { ProviderAccountDto } from '../../shared/ipc-contract';

export interface AccountRowProps {
  account: ProviderAccountDto;
  onDisconnect(account: ProviderAccountDto): void | Promise<void>;
  onSaveLabel?(account: ProviderAccountDto, label: string): void | Promise<void>;
}

export function AccountRow({ account, onDisconnect, onSaveLabel }: AccountRowProps): JSX.Element {
  const label = account.displayLabel || account.displayEmail;
  const color = account.displayColor || colorFromAccount(account.accountId);
  const needsAuth = account.status === 'needs-auth';
  return (
    <article data-testid={`account-row-${account.providerKey}-${account.accountId}`} style={rowStyle()}>
      <span aria-hidden style={{ ...dotStyle(), background: color }} />
      <div style={{ flex: '1 1 auto' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong data-testid={`account-label-${account.accountId}`}>{label}</strong>
          <span data-testid={`account-status-${account.accountId}`} style={chipStyle(needsAuth)}>
            {account.status}
          </span>
        </div>
        <div data-testid={`account-email-${account.accountId}`} style={{ color: '#64748b', fontSize: 13 }}>
          {providerDisplayName(account.providerKey)} · {account.displayEmail}
        </div>
        {account.lastError && (
          <div role="alert" style={{ color: '#b91c1c', fontSize: 12 }}>{account.lastError}</div>
        )}
      </div>
      {onSaveLabel && (
        <button
          type="button"
          data-testid={`account-save-label-${account.accountId}`}
          onClick={() => void onSaveLabel(account, label)}
        >
          Save label
        </button>
      )}
      {needsAuth && <button type="button" data-testid={`account-reconnect-${account.accountId}`}>Reconnect</button>}
      <button
        type="button"
        data-testid={`account-disconnect-${account.accountId}`}
        onClick={() => void onDisconnect(account)}
      >
        Disconnect
      </button>
    </article>
  );
}

function providerDisplayName(providerKey: ProviderAccountDto['providerKey']): string {
  if (providerKey === 'microsoft') return 'Outlook';
  if (providerKey === 'todoist') return 'Todoist';
  return 'Google';
}

function colorFromAccount(accountId: string): string {
  let hash = 0;
  for (const ch of accountId) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${hash} 70% 46%)`;
}

function rowStyle(): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  };
}

function dotStyle(): React.CSSProperties {
  return { width: 14, height: 14, borderRadius: 999, flex: '0 0 auto' };
}

function chipStyle(warn: boolean): React.CSSProperties {
  return {
    borderRadius: 999,
    padding: '2px 8px',
    fontSize: 11,
    background: warn ? '#fef3c7' : '#dcfce7',
    color: warn ? '#92400e' : '#166534',
  };
}
