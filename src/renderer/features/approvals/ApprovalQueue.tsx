/**
 * Phase 9 Plan 03 — RE-SKINNED. Account-filter buttons rendered as
 * editorial pills; queue list spacing tightened. ApprovalCard variant
 * dispatch, data-testid attributes, and IPC plumbing unchanged.
 */
import type { ApprovalRowDto } from '../../../shared/ipc-contract';
import { useMemo, useState } from 'react';
import { AccountChip } from '../../components/AccountChip';
import { ApprovalCard, type ApprovalCardProps } from './ApprovalCard';
import { StuckBadge } from './StuckBadge';

export interface ApprovalQueueProps extends Pick<
  ApprovalCardProps,
  'onSelect' | 'onApprove' | 'onReject' | 'onSnooze'
> {
  rows: ApprovalRowDto[];
  selected: Set<string>;
  onCancelStuck(id: string): void | Promise<void>;
}

export function ApprovalQueue(props: ApprovalQueueProps): JSX.Element {
  const [accountFilter, setAccountFilter] = useState<string | null>(null);
  const accounts = useMemo(() => {
    const seen = new Set<string>();
    return props.rows
      .filter((row) => row.provider_key && row.account_id)
      .filter((row) => {
        const key = `${row.provider_key}:${row.account_id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [props.rows]);
  const rows = accountFilter
    ? props.rows.filter((row) => `${row.provider_key}:${row.account_id}` === accountFilter)
    : props.rows;

  return (
    <>
      {accounts.length > 0 && (
        <div
          data-testid="approval-account-filters"
          style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}
        >
          <button
            type="button"
            data-testid="approval-account-filter-all"
            onClick={() => setAccountFilter(null)}
            style={accountFilterStyle(accountFilter === null)}
          >
            All accounts
          </button>
          {accounts.map((row) => {
            const key = `${row.provider_key}:${row.account_id}`;
            const on = accountFilter === key;
            return (
              <button
                key={key}
                type="button"
                data-testid={`approval-account-filter-${row.provider_key}-${row.account_id}`}
                aria-pressed={on}
                onClick={() => setAccountFilter((current) => (current === key ? null : key))}
                style={accountFilterStyle(on)}
              >
                <AccountChip providerKey={row.provider_key} accountId={row.account_id} compact />
              </button>
            );
          })}
        </div>
      )}
      <ul data-testid="approval-queue" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {rows.map((row) => (
          <li key={row.id}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
              <StuckBadge approval={row} onCancel={props.onCancelStuck} />
            </div>
            <ApprovalCard
              row={row}
              selectable
              selected={props.selected.has(row.id)}
              onSelect={props.onSelect}
              onApprove={props.onApprove}
              onReject={props.onReject}
              onSnooze={props.onSnooze}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

function accountFilterStyle(active: boolean): React.CSSProperties {
  return {
    padding: '4px 10px',
    borderRadius: 999,
    fontFamily: 'var(--f-mono)',
    fontSize: 10.5,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    border: `1px solid ${active ? 'var(--ink)' : 'var(--rule)'}`,
    background: active ? 'var(--ink)' : 'transparent',
    color: active ? 'var(--ivory)' : 'var(--gray)',
    cursor: 'pointer',
  };
}
