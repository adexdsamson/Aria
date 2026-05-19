import { useEffect, useMemo, useState } from 'react';
import type { ProviderAccountDto } from '../../shared/ipc-contract';

export interface AccountChipProps {
  providerKey?: ProviderAccountDto['providerKey'] | null;
  accountId?: string | null;
  account?: ProviderAccountDto | null;
  compact?: boolean;
}

export type AccountChipState =
  | { state: 'loading'; account: null }
  | { state: 'ready'; account: ProviderAccountDto }
  | { state: 'missing'; account: null };

export function useAccountChipData(
  providerKey?: ProviderAccountDto['providerKey'] | null,
  accountId?: string | null,
  account?: ProviderAccountDto | null,
): AccountChipState {
  const [state, setState] = useState<AccountChipState>(() => {
    if (account) return { state: 'ready', account };
    if (!providerKey || !accountId) return { state: 'missing', account: null };
    return { state: 'loading', account: null };
  });

  useEffect(() => {
    if (account) {
      setState({ state: 'ready', account });
      return;
    }
    if (!providerKey || !accountId) {
      setState({ state: 'missing', account: null });
      return;
    }
    let cancelled = false;
    setState({ state: 'loading', account: null });
    void (async () => {
      try {
        const res = await window.aria.providerAccountsList();
        if (cancelled) return;
        if ('error' in res) {
          setState({ state: 'missing', account: null });
          return;
        }
        const found = res.rows.find(
          (row) => row.providerKey === providerKey && row.accountId === accountId,
        );
        setState(found ? { state: 'ready', account: found } : { state: 'missing', account: null });
      } catch {
        if (!cancelled) setState({ state: 'missing', account: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account, accountId, providerKey]);

  return state;
}

export function AccountChip({
  providerKey,
  accountId,
  account,
  compact = false,
}: AccountChipProps): JSX.Element {
  const chip = useAccountChipData(providerKey, accountId, account);
  const data = useMemo(() => resolveChipData(chip, providerKey, accountId), [accountId, chip, providerKey]);

  return (
    <span
      data-testid={accountId ? `account-chip-${providerKey ?? 'unknown'}-${accountId}` : 'account-chip-neutral'}
      data-state={chip.state}
      title={data.title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: compact ? 4 : 6,
        border: `1px solid ${chip.state === 'missing' ? '#d1d5db' : '#cbd5e1'}`,
        borderRadius: 999,
        padding: compact ? '1px 6px' : '2px 8px',
        fontSize: compact ? 11 : 12,
        color: chip.state === 'missing' ? '#6b7280' : '#334155',
        background: chip.state === 'missing' ? '#f3f4f6' : '#fff',
        opacity: chip.state === 'loading' ? 0.7 : 1,
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden>{data.icon}</span>
      <span
        aria-hidden
        data-testid={accountId ? `account-chip-color-${providerKey ?? 'unknown'}-${accountId}` : 'account-chip-color-neutral'}
        data-color={data.color}
        style={{ width: 8, height: 8, borderRadius: 999, background: data.color }}
      />
      <span>{data.label}</span>
    </span>
  );
}

function resolveChipData(
  chip: AccountChipState,
  providerKey?: ProviderAccountDto['providerKey'] | null,
  accountId?: string | null,
): { icon: string; color: string; label: string; title: string } {
  if (chip.state === 'ready') {
    const label = chip.account.displayLabel || emailHandle(chip.account.displayEmail);
    return {
      icon: chip.account.providerKey === 'microsoft' ? 'M' : 'G',
      color: chip.account.displayColor || colorFromAccount(chip.account.accountId),
      label,
      title: chip.account.displayEmail,
    };
  }
  if (chip.state === 'loading') {
    return {
      icon: providerKey === 'microsoft' ? 'M' : providerKey === 'google' ? 'G' : '?',
      color: '#cbd5e1',
      label: 'Loading account',
      title: accountId ?? 'Loading account',
    };
  }
  return {
    icon: providerKey === 'microsoft' ? 'M' : providerKey === 'google' ? 'G' : '?',
    color: '#9ca3af',
    label: accountId ? emailHandle(accountId) : 'No account',
    title: accountId ?? 'No account attached',
  };
}

function emailHandle(email: string): string {
  return email.includes('@') ? email.split('@')[0] || email : email;
}

function colorFromAccount(accountId: string): string {
  let hash = 0;
  for (const ch of accountId) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${hash} 70% 46%)`;
}
