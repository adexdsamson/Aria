/**
 * AccountVisibilityToggle — sidebar list of connected accounts with per-account
 * visibility checkbox. Phase 9 design-ref pass:
 *   - Two-line row: bold display label / provider · email in mono small
 *   - Color square next to checkbox (uses account.displayColor)
 *   - Plain ivory-deep background, single 1px rule border, no inner card chrome
 *
 * IPC + data-testids + onToggle preserved verbatim.
 */
import type { ProviderAccountDto } from '../../../shared/ipc-contract';

function providerLabel(key: ProviderAccountDto['providerKey']): string {
  if (key === 'google') return 'Gmail';
  if (key === 'microsoft') return 'Outlook';
  return 'Todoist';
}

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
        minWidth: 240,
        maxWidth: 280,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--gray)',
          marginBottom: 12,
        }}
        aria-hidden="true"
      >
        Accounts
      </div>
      <h2 style={{ position: 'absolute', left: -10000 }}>Calendars</h2>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {accounts.map((account) => {
          const visible = !hiddenAccountIds.has(account.accountId);
          const color = account.displayColor || 'var(--gold)';
          const label = account.displayLabel || account.displayEmail;
          const provider = providerLabel(account.providerKey);
          return (
            <li
              key={`${account.providerKey}:${account.accountId}`}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}
            >
              <label
                data-testid={`calendar-account-toggle-${account.providerKey}-${account.accountId}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  paddingTop: 2,
                }}
              >
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={() => onToggle(account.accountId)}
                  style={{
                    accentColor: color,
                    cursor: 'pointer',
                    width: 14,
                    height: 14,
                    margin: 0,
                  }}
                />
                <span
                  aria-hidden="true"
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 2,
                    background: color,
                    border: '1px solid var(--rule-strong)',
                    flexShrink: 0,
                  }}
                />
              </label>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontFamily: 'var(--f-body)',
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--ink)',
                    lineHeight: 1.25,
                  }}
                >
                  {label}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--f-mono)',
                    fontSize: 11,
                    color: 'var(--gray)',
                    lineHeight: 1.4,
                    marginTop: 2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {provider} · {account.displayEmail}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
