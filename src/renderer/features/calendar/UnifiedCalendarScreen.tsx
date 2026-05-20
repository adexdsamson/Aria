/**
 * Phase 9 Plan 03 — RE-SKINNED. Editorial top header (Playfair title +
 * italic subtitle), ivory background canvas. Account sidebar + grid
 * layout preserved; IPC, range computation, localStorage hidden-set,
 * and toggle behaviour unchanged.
 */
import { useEffect, useMemo, useState } from 'react';
import type { CalendarEventDto, ProviderAccountDto } from '../../../shared/ipc-contract';
import { LabelRule } from '../../components/editorial';
import { AccountVisibilityToggle } from './AccountVisibilityToggle';
import { CalendarGrid } from './CalendarGrid';

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
        padding: '28px 32px 80px',
        color: 'var(--ink)',
        background: 'var(--ivory)',
        minHeight: '100%',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 14,
          paddingBottom: 14,
          marginBottom: 18,
          borderBottom: '1px solid var(--rule)',
          flexWrap: 'wrap',
        }}
      >
        <h1
          style={{
            fontFamily: 'var(--f-display)',
            fontWeight: 500,
            fontSize: '2.25rem',
            letterSpacing: '-0.015em',
            margin: 0,
          }}
        >
          Calendar
        </h1>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontFamily: 'var(--f-display)',
            fontStyle: 'italic',
            color: 'var(--gray)',
            fontSize: 14,
          }}
        >
          Next 7 days · self-only edits.
        </span>
      </header>
      {loading && (
        <p
          data-testid="calendar-loading"
          style={{ fontFamily: 'var(--f-display)', fontStyle: 'italic', color: 'var(--gray)' }}
        >
          Loading calendar…
        </p>
      )}
      {!loading && (
        <>
          <LabelRule label="Week ahead" align="left" />
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', marginTop: 14 }}>
          <AccountVisibilityToggle
            accounts={accounts}
            hiddenAccountIds={hiddenAccountIds}
            onToggle={toggle}
          />
          <CalendarGrid events={events} accounts={accounts} hiddenAccountIds={hiddenAccountIds} />
          </div>
        </>
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
