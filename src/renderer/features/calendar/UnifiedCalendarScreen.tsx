/**
 * UnifiedCalendarScreen — week-of view.
 *
 * Phase 9 design-ref `app-screen-calendar.jsx` layout port:
 *   - Topbar owns the page heading ("UNIFIED CALENDAR / Week of N {month}"),
 *     so this screen does NOT render a duplicate h1.
 *   - Left sidebar: account visibility list + "WRITE SCOPE" caption.
 *   - Right: 7-day week grid (CalendarGrid) with day columns + hourly slots.
 *
 * IPC + state + data-testids preserved verbatim.
 */
import { useEffect, useMemo, useState } from 'react';
import type { CalendarEventDto, ProviderAccountDto } from '../../../shared/ipc-contract';
import { AccountVisibilityToggle } from './AccountVisibilityToggle';
import { CalendarGrid } from './CalendarGrid';
import { SkeletonRoot, SkeletonBlock, SkeletonLine } from '../../components/Skeleton';

const STORAGE_KEY = 'aria:calendar:hidden-account-ids';

export function UnifiedCalendarScreen(): JSX.Element {
  const [accounts, setAccounts] = useState<ProviderAccountDto[]>([]);
  const [events, setEvents] = useState<CalendarEventDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [hiddenAccountIds, setHiddenAccountIds] = useState<Set<string>>(() => readHidden());

  const range = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { startUtc: start.toISOString(), endUtc: end.toISOString() };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const [accountRes, eventRes] = await Promise.all([
          window.aria.providerAccountsList(),
          window.aria.calendarListEventsRange(range),
        ]);
        if (cancelled) return;
        if (!('error' in accountRes)) setAccounts(accountRes.rows);
        if (!('error' in eventRes)) setEvents(eventRes.rows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range]);

  function toggle(accountId: string): void {
    setHiddenAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next)));
      return next;
    });
  }

  return (
    <section
      data-testid="unified-calendar-screen"
      style={{
        padding: '24px 32px 80px',
        color: 'var(--ink)',
        background: 'var(--ivory)',
        minHeight: '100%',
      }}
    >
      {loading && (
        <div data-testid="calendar-loading">
          <SkeletonRoot
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(220px, 260px) 1fr',
              gap: 28,
              alignItems: 'flex-start',
            }}
          >
            {/* Sidebar skeleton */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <SkeletonLine width="60%" height={10} />
              {[1, 2, 3].map((i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <SkeletonLine width={16} height={16} style={{ borderRadius: 3, flexShrink: 0 }} />
                  <SkeletonLine width="70%" height={12} />
                </div>
              ))}
            </div>
            {/* 7-day grid skeleton */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Day headers */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
                {Array.from({ length: 7 }).map((_, i) => (
                  <SkeletonLine key={i} width="100%" height={36} style={{ borderRadius: 5 }} />
                ))}
              </div>
              {/* Event rows */}
              {[1, 2, 3].map((row) => (
                <div
                  key={row}
                  style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}
                >
                  {Array.from({ length: 7 }).map((_, i) => (
                    <SkeletonBlock
                      key={i}
                      width="100%"
                      height={i % 3 === 0 ? 52 : i % 2 === 0 ? 36 : 0}
                      radius={4}
                      style={{ opacity: i % 3 === 1 ? 0 : 1 }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </SkeletonRoot>
        </div>
      )}

      {!loading && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(220px, 260px) 1fr',
            gap: 28,
            alignItems: 'flex-start',
          }}
        >
          {/* Sidebar — accounts + write-scope caption */}
          <aside style={{ position: 'sticky', top: 0 }}>
            <AccountVisibilityToggle
              accounts={accounts}
              hiddenAccountIds={hiddenAccountIds}
              onToggle={toggle}
            />

            {/* Write-scope disclosure (replaces the misplaced top-right "Next 7 days
                · self-only edits." line from the prior pass). */}
            <div
              style={{
                marginTop: 32,
                paddingTop: 18,
                borderTop: '1px solid var(--rule)',
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
                  marginBottom: 10,
                }}
              >
                Write scope
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  color: 'var(--ink-soft)',
                  lineHeight: 1.55,
                }}
              >
                v1 only edits self-only, non-recurring events. Multi-attendee and
                recurring events stay read-only — Aria will refuse.
              </p>
            </div>
          </aside>

          {/* 7-day grid */}
          <CalendarGrid events={events} accounts={accounts} hiddenAccountIds={hiddenAccountIds} />
        </div>
      )}
    </section>
  );
}

function readHidden(): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}
