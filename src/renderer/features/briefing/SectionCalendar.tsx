/**
 * Plan 02-04 Task 3 — Today's Calendar section of the briefing.
 *
 * Renders top-3 calendar items with title + rationale. All-day events get an
 * "All day" tag (XCUT-07 surfacing).
 *
 * Phase 9 Plan 03 — RE-SKINNED. Visual chrome upgraded to editorial primitives
 * (.label-rule, .card, Playfair section title). Existing data-testid + props
 * unchanged; behaviour is identical.
 */
import type { BriefingItem } from '../../../shared/ipc-contract';
import { BriefingItem as BriefingItemRow } from './BriefingItem';

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
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
        <h2
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 'clamp(1.5rem, 2.5vw, 1.75rem)',
            fontWeight: 500,
            letterSpacing: '-0.01em',
            margin: 0,
          }}
        >
          Today’s Calendar
        </h2>
        {top3.length > 0 && (
          <span
            className="smallcaps"
            style={{ color: 'var(--gray-soft)' }}
            aria-hidden="true"
          >
            Top {top3.length}
          </span>
        )}
      </div>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontStyle: 'italic',
          color: 'var(--gray)',
          fontSize: 14,
          marginBottom: 14,
        }}
      >
        Calendar items ranked by attendee weight, prep status, and time.
      </div>
      {error && (
        <div
          data-testid="section-error-calendar"
          style={{
            background: 'rgba(184,73,58,0.08)',
            color: 'var(--rose)',
            border: '1px solid rgba(184,73,58,0.25)',
            padding: '10px 14px',
            borderRadius: 6,
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}
      {top3.length === 0 && !error && (
        <p style={{ fontStyle: 'italic', color: 'var(--gray)', margin: 0 }}>No items today.</p>
      )}
      {top3.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {top3.map((it) => {
            const allDay = it.title.startsWith('[All day]') || /\ball day\b/i.test(it.why);
            return (
              <BriefingItemRow key={it.id} item={it} testId={`calendar-item-${it.id}`}>
                {allDay && (
                  <span
                    data-testid={`calendar-item-${it.id}-allday`}
                    className="smallcaps"
                    style={{ marginLeft: 6, color: 'var(--gray-soft)' }}
                  >
                    All day
                  </span>
                )}
              </BriefingItemRow>
            );
          })}
        </ul>
      )}
    </section>
  );
}
