/**
 * Phase 9 Plan 03 — RE-SKINNED. Editorial row layout (Playfair title +
 * mono "Why" rationale rail). Renders as an <li> so the parent <ul> stays
 * semantically valid; data-testid and props are unchanged.
 */
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
    <li
      data-testid={testId}
      style={{
        padding: '14px 0',
        borderBottom: '1px solid var(--rule)',
        listStyle: 'none',
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 6 }}>
        <strong
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: '1rem',
            fontWeight: 500,
            color: 'var(--ink)',
            lineHeight: 1.35,
            flex: '1 1 auto',
            minWidth: 0,
          }}
        >
          {item.title}
        </strong>
        <AccountChip providerKey={providerKey} accountId={accountId} compact />
        {children}
      </div>
      <div
        data-testid="rationale"
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          color: 'var(--gray)',
          fontSize: 13.5,
          lineHeight: 1.55,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 9,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--gold)',
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          Why
        </span>
        <span style={{ fontStyle: 'italic' }}>{item.why}</span>
      </div>
    </li>
  );
}
