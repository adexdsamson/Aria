/**
 * Phase 9 Plan 03 — RE-SKINNED. Editorial checkbox rows with smallcaps
 * section header. data-testid + onToggle behaviour preserved.
 */
import type { ProviderAccountDto } from '../../../shared/ipc-contract';
import { AccountChip } from '../../components/AccountChip';

export function AccountVisibilityToggle({
  accounts,
  hiddenAccountIds,
  onToggle,
}: {
  accounts: ProviderAccountDto[];
  hiddenAccountIds: Set<string>;
  onToggle(accountId: string): void;
}): JSX.Element {
  return (
    <aside
      data-testid="calendar-account-sidebar"
      style={{
        minWidth: 220,
        padding: '14px 16px',
        background: 'var(--paper)',
        border: '1px solid var(--rule)',
        borderRadius: 8,
      }}
    >
      <div
        className="smallcaps"
        style={{ color: 'var(--gray-soft)', marginBottom: 10 }}
        aria-hidden="true"
      >
        Accounts
      </div>
      <h2 style={{ position: 'absolute', left: -10000 }}>Calendars</h2>
      {accounts.map((account) => {
        const visible = !hiddenAccountIds.has(account.accountId);
        return (
          <label
            key={`${account.providerKey}:${account.accountId}`}
            data-testid={`calendar-account-toggle-${account.providerKey}-${account.accountId}`}
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              padding: '6px 0',
              cursor: 'pointer',
              fontSize: 13,
              color: 'var(--ink)',
            }}
          >
            <input
              type="checkbox"
              checked={visible}
              onChange={() => onToggle(account.accountId)}
              style={{ accentColor: account.displayColor || 'var(--gold)' }}
            />
            <AccountChip account={account} compact />
          </label>
        );
      })}
    </aside>
  );
}
