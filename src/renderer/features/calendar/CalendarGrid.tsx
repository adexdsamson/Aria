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
      {visible.length === 0 && <p>No events in this range.</p>}
      <div style={{ display: 'grid', gap: 10 }}>
        {visible.map((event) => {
          const account = accounts.find(
            (row) => row.providerKey === event.providerKey && row.accountId === event.accountId,
          );
          const color = account?.displayColor || event.accountDisplayColor || '#64748b';
          return (
            <article
              key={event.id}
              data-testid={`calendar-event-${event.id}`}
              style={{
                border: '1px solid #e2e8f0',
                borderLeft: `6px solid ${color}`,
                borderRadius: 12,
                padding: 12,
                background: '#fff',
              }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>{event.summary || '(no title)'}</strong>
                <AccountChip
                  providerKey={event.providerKey}
                  accountId={event.accountId}
                  account={account ?? null}
                  compact
                />
              </div>
              <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>
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
