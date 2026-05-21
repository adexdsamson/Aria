/**
 * CalendarGrid — 7-day week grid with hourly time slots.
 *
 * Phase 9 design-ref `app-screen-calendar.jsx` layout port:
 *   - Sticky day-header row across 7 columns (TODAY / WED / THU / ...)
 *   - Time-label rail on the left (08:00 → 18:00 by default)
 *   - Empty cells with thin rules for the grid background
 *   - Events positioned absolutely via top/height calculated from start/end
 *   - Today column subtly highlighted
 *   - All-day / dateOnly events sit in a pinned row above the time grid
 *
 * Re-skin discipline: events list + accounts list come from the same IPC.
 * No new IPC, no DTO changes. The grid is pure presentation over the
 * existing `CalendarEventDto` shape.
 */
import { useMemo } from 'react';
import type { CalendarEventDto, ProviderAccountDto } from '../../../shared/ipc-contract';
import { RecurrenceUnsupportedPill, useRecurrenceUnsupportedToast } from './RecurrenceUnsupportedPill';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const SLOT_PX = 56; // vertical px per hour
const FIRST_HOUR = 8; // 08:00
const LAST_HOUR = 18; // 18:00 (10 slots → 560px tall)
const HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => FIRST_HOUR + i);

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function sameYmd(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function shortWeekday(d: Date, isToday: boolean): string {
  if (isToday) return 'TODAY';
  return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(d).toUpperCase().slice(0, 3);
}

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

  const today = useMemo(() => startOfDay(new Date()), []);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(today.getTime() + i * DAY_MS)),
    [today],
  );

  // Partition events into timed (have startAtUtc) vs all-day (have startDate only).
  const timedEvents = visible.filter((e) => !!e.startAtUtc && !e.startDate);
  const allDayEvents = visible.filter((e) => !!e.startDate);

  return (
    <div
      data-testid="calendar-grid"
      style={{
        flex: '1 1 auto',
        minWidth: 0,
        background: 'var(--paper)',
        border: '1px solid var(--rule)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
      }}
    >
      {/* Day header row — 1 spacer column for time rail + 7 day columns */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '56px repeat(7, 1fr)',
          borderBottom: '1px solid var(--rule)',
          background: 'var(--ivory)',
        }}
      >
        <div aria-hidden="true" />
        {days.map((d, i) => {
          const isToday = sameYmd(d, today);
          return (
            <div
              key={i}
              style={{
                padding: '12px 10px 10px',
                borderLeft: i === 0 ? 'none' : '1px solid var(--rule)',
                background: isToday ? 'var(--ink)' : 'transparent',
                color: isToday ? 'var(--paper)' : 'var(--ink)',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 10,
                  fontWeight: 500,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: isToday ? 'var(--gold-light)' : 'var(--gray)',
                  marginBottom: 4,
                }}
              >
                {shortWeekday(d, isToday)}
              </div>
              <div
                style={{
                  fontFamily: 'var(--f-display)',
                  fontSize: 22,
                  fontWeight: 500,
                  lineHeight: 1,
                }}
              >
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* All-day strip */}
      {allDayEvents.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '56px repeat(7, 1fr)',
            borderBottom: '1px solid var(--rule)',
            background: 'var(--ivory-deep)',
            minHeight: 30,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 9,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--gray-soft)',
              padding: '6px 8px',
              textAlign: 'right',
            }}
          >
            All day
          </div>
          {days.map((d, i) => {
            const onThisDay = allDayEvents.filter((e) => {
              if (!e.startDate) return false;
              try {
                const evd = new Date(`${e.startDate}T00:00:00`);
                return sameYmd(evd, d);
              } catch {
                return false;
              }
            });
            return (
              <div
                key={i}
                style={{
                  padding: '4px 6px',
                  borderLeft: i === 0 ? 'none' : '1px solid var(--rule)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                {onThisDay.map((e) => {
                  const account = accounts.find(
                    (a) => a.providerKey === e.providerKey && a.accountId === e.accountId,
                  );
                  const color = account?.displayColor || e.accountDisplayColor || 'var(--gold)';
                  return (
                    <div
                      key={e.id}
                      data-testid={`calendar-event-${e.id}`}
                      title={e.summary || '(no title)'}
                      style={{
                        fontSize: 11,
                        padding: '2px 6px',
                        borderLeft: `2px solid ${color}`,
                        background: 'var(--paper)',
                        color: 'var(--ink)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
                      }}
                    >
                      {e.summary || '(no title)'}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* Timed grid — time rail + 7 day columns; events positioned absolutely per cell */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '56px repeat(7, 1fr)',
          position: 'relative',
        }}
      >
        {/* Time rail */}
        <div style={{ borderRight: '1px solid var(--rule)' }}>
          {HOURS.map((h, i) => (
            <div
              key={h}
              style={{
                height: SLOT_PX,
                padding: '4px 8px 0',
                fontFamily: 'var(--f-mono)',
                fontSize: 10,
                color: 'var(--gray-soft)',
                letterSpacing: '0.08em',
                textAlign: 'right',
                borderTop: i === 0 ? 'none' : '1px solid var(--rule)',
                boxSizing: 'border-box',
              }}
            >
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>

        {/* 7 day columns */}
        {days.map((d, dayIdx) => {
          const isToday = sameYmd(d, today);
          const dayStart = startOfDay(d).getTime();
          const dayEnd = dayStart + DAY_MS;
          const todaysEvents = timedEvents.filter((e) => {
            if (!e.startAtUtc) return false;
            const start = new Date(e.startAtUtc).getTime();
            return start >= dayStart && start < dayEnd;
          });

          return (
            <div
              key={dayIdx}
              style={{
                position: 'relative',
                borderLeft: dayIdx === 0 ? 'none' : '1px solid var(--rule)',
                background: isToday ? 'rgba(184,134,11,0.025)' : 'transparent',
              }}
            >
              {/* Hour grid lines */}
              {HOURS.map((h, i) => (
                <div
                  key={h}
                  style={{
                    height: SLOT_PX,
                    borderTop: i === 0 ? 'none' : '1px solid var(--rule)',
                    boxSizing: 'border-box',
                  }}
                />
              ))}

              {/* Events for this day, absolutely positioned */}
              {todaysEvents.map((e) => {
                const account = accounts.find(
                  (a) => a.providerKey === e.providerKey && a.accountId === e.accountId,
                );
                const color = account?.displayColor || e.accountDisplayColor || 'var(--gold)';
                const startMs = new Date(e.startAtUtc!).getTime();
                const endMs = e.endAtUtc ? new Date(e.endAtUtc).getTime() : startMs + 30 * 60 * 1000;
                // Offset from FIRST_HOUR in hours.
                const startHours = (startMs - dayStart) / HOUR_MS - FIRST_HOUR;
                const durHours = Math.max(0.5, (endMs - startMs) / HOUR_MS);
                if (startHours < 0 || startHours > LAST_HOUR - FIRST_HOUR + 1) return null;
                const top = startHours * SLOT_PX;
                const height = durHours * SLOT_PX - 2;
                return (
                  <div
                    key={e.id}
                    data-testid={`calendar-event-${e.id}`}
                    title={e.summary || '(no title)'}
                    style={{
                      position: 'absolute',
                      left: 4,
                      right: 4,
                      top,
                      height,
                      background: 'var(--paper)',
                      border: '1px solid var(--rule)',
                      borderLeft: `3px solid ${color}`,
                      borderRadius: 'var(--radius-sm)',
                      padding: '4px 8px',
                      overflow: 'hidden',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                      transition: 'transform 140ms cubic-bezier(0.23, 1, 0.32, 1), box-shadow 140ms ease',
                    }}
                    onMouseEnter={(ev) => {
                      ev.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
                    }}
                    onMouseLeave={(ev) => {
                      ev.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)';
                    }}
                  >
                    <div
                      style={{
                        fontFamily: 'var(--f-display)',
                        fontSize: 12.5,
                        fontWeight: 500,
                        color: 'var(--ink)',
                        lineHeight: 1.25,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {e.summary || '(no title)'}
                    </div>
                    <div
                      style={{
                        marginTop: 2,
                        fontFamily: 'var(--f-mono)',
                        fontSize: 10,
                        color: 'var(--gray)',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {formatTimeRange(e)}
                    </div>
                    <RecurrenceUnsupportedPill event={e} />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Empty state */}
      {visible.length === 0 && (
        <div
          style={{
            padding: '32px 24px',
            textAlign: 'center',
            fontFamily: 'var(--f-display)',
            fontStyle: 'italic',
            color: 'var(--gray)',
            borderTop: '1px solid var(--rule)',
            background: 'var(--ivory-deep)',
          }}
        >
          No events in this range.
        </div>
      )}
    </div>
  );
}

function formatTimeRange(event: CalendarEventDto): string {
  if (!event.startAtUtc) return '';
  try {
    const start = new Date(event.startAtUtc);
    const startLabel = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(start);
    if (!event.endAtUtc) return startLabel;
    const end = new Date(event.endAtUtc);
    const endLabel = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(end);
    return `${startLabel} – ${endLabel}`;
  } catch {
    return event.startAtUtc;
  }
}
