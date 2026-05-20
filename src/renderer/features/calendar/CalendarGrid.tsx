/**
 * Phase 9 Plan 03 — RE-SKINNED. Event cards rendered with paper bg, 1px
 * rule border, account-color left rail, Playfair title + mono time meta.
 * Event positioning + IPC + toast wiring preserved.
 */
import type { CalendarEventDto, ProviderAccountDto } from '../../../shared/ipc-contract';
import { AccountChip } from '../../components/AccountChip';
import { RecurrenceUnsupportedPill, useRecurrenceUnsupportedToast } from './RecurrenceUnsupportedPill';

export function CalendarGrid({
  events,
  accounts,
  hiddenAccountIds,
}: {
  events: CalendarEventDto[];
  accounts: ProviderAccountDto[];
  hiddenAccountIds: Set<string>;
}): JSX.Element {
  const visible = events.filter((event) => !hiddenAccountIds.has(event.accountId));
  useRecurrenceUnsupportedToast(visible);

  return (
    <div data-testid="calendar-grid" style={{ flex: '1 1 auto' }}>
      {visible.length === 0 && (
        <p style={{ fontFamily: 'var(--f-display)', fontStyle: 'italic', color: 'var(--gray)' }}>
          No events in this range.
        </p>
      )}
      <div style={{ display: 'grid', gap: 10 }}>
        {visible.map((event) => {
          const account = accounts.find(
            (row) => row.providerKey === event.providerKey && row.accountId === event.accountId,
          );
          const color = account?.displayColor || event.accountDisplayColor || 'var(--gray-faint)';
          return (
            <article
              key={event.id}
              data-testid={`calendar-event-${event.id}`}
              style={{
                background: 'var(--paper)',
                border: '1px solid var(--rule)',
                borderLeft: `3px solid ${color}`,
                borderRadius: 4,
                padding: '12px 14px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'baseline',
                  flexWrap: 'wrap',
                }}
              >
                <strong
                  style={{
                    fontFamily: 'var(--f-display)',
                    fontWeight: 500,
                    fontSize: 15,
                    color: 'var(--ink)',
                    lineHeight: 1.3,
                  }}
                >
                  {event.summary || '(no title)'}
                </strong>
                <AccountChip
                  providerKey={event.providerKey}
                  accountId={event.accountId}
                  account={account ?? null}
                  compact
                />
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontFamily: 'var(--f-mono)',
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  color: 'var(--gray-soft)',
                }}
              >
                {formatEventTime(event)}
              </div>
              <div style={{ marginTop: 6 }}>
                <RecurrenceUnsupportedPill event={event} />
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function formatEventTime(event: CalendarEventDto): string {
  if (event.startDate) return event.startDate;
  if (!event.startAtUtc) return 'Unknown time';
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(event.startAtUtc));
  } catch {
    return event.startAtUtc;
  }
}
