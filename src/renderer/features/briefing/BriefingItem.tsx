import type { BriefingItem as BriefingItemDto } from '../../../shared/ipc-contract';
import { AccountChip } from '../../components/AccountChip';

type BriefingItemWithAccount = BriefingItemDto & {
  provider_key?: 'google' | 'microsoft' | null;
  providerKey?: 'google' | 'microsoft' | null;
  account_id?: string | null;
  accountId?: string | null;
};

export function BriefingItem({
  item,
  testId,
  children,
}: {
  item: BriefingItemWithAccount;
  testId: string;
  children?: React.ReactNode;
}): JSX.Element {
  const providerKey = item.providerKey ?? item.provider_key ?? null;
  const accountId = item.accountId ?? item.account_id ?? null;
  return (
    <li data-testid={testId} style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>{item.title}</strong>
        <AccountChip providerKey={providerKey} accountId={accountId} compact />
        {children}
      </div>
      <div data-testid="rationale" style={{ color: 'var(--aria-muted-fg)' }}>
        {item.why}
      </div>
    </li>
  );
}
