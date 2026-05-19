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
    <aside data-testid="calendar-account-sidebar" style={{ minWidth: 220 }}>
      <h2 style={{ fontSize: 14, margin: '0 0 8px 0' }}>Calendars</h2>
      {accounts.map((account) => (
        <label
          key={`${account.providerKey}:${account.accountId}`}
          data-testid={`calendar-account-toggle-${account.providerKey}-${account.accountId}`}
          style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}
        >
          <input
            type="checkbox"
            checked={!hiddenAccountIds.has(account.accountId)}
            onChange={() => onToggle(account.accountId)}
          />
          <AccountChip account={account} compact />
        </label>
      ))}
    </aside>
  );
}
