/**
 * Plan 02-04 Task 3 — Today's Calendar section of the briefing.
 *
 * Renders top-3 calendar items with title + rationale. All-day events get an
 * "All day" tag (XCUT-07 surfacing).
 */
import type { BriefingItem } from '../../../shared/ipc-contract';

export function SectionCalendar({
  items,
  error,
}: {
  items: BriefingItem[];
  error?: string;
}): JSX.Element {
  const top3 = items.slice(0, 3);
  return (
    <section data-testid="briefing-section-calendar">
      <h2 style={{ fontSize: 'var(--aria-type-xl)' }}>Today’s Calendar</h2>
      {error && (
        <div
          data-testid="section-error-calendar"
          style={{
            backgroundColor: '#fef3c7',
            color: '#92400e',
            padding: 8,
            borderRadius: 6,
            marginBottom: 8,
          }}
        >
          {error}
        </div>
      )}
      {top3.length === 0 && !error && <p>No items today.</p>}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {top3.map((it) => {
          const allDay = it.title.startsWith('[All day]') || /\ball day\b/i.test(it.why);
          return (
            <li key={it.id} data-testid={`calendar-item-${it.id}`} style={{ marginBottom: 12 }}>
              <strong>{it.title}</strong>
              {allDay && (
                <span
                  data-testid={`calendar-item-${it.id}-allday`}
                  style={{
                    marginLeft: 6,
                    fontSize: 'var(--aria-type-sm)',
                    color: 'var(--aria-muted-fg)',
                  }}
                >
                  All day
                </span>
              )}
              <div data-testid="rationale" style={{ color: 'var(--aria-muted-fg)' }}>
                {it.why}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
