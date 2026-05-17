/**
 * Plan 02-04 Task 3 — BriefingScreen.
 *
 * Layout:
 *   H1 "Today's Briefing — <weekday>, <date>"
 *   If no briefing for today → <GenerateNowAffordance>
 *   Else → SectionCalendar / SectionEmail (with B4 fallback) / SectionNews
 *   Route badge ([FRONTIER] or [LOCAL]) on the top header row.
 *
 * Loads via window.aria.briefingToday() on mount and after GenerateNowAffordance
 * fires onDone.
 */
import { useCallback, useEffect, useState } from 'react';
import type { BriefingPayload, IpcError } from '../../../shared/ipc-contract';
import { GenerateNowAffordance } from './GenerateNowAffordance';
import { SectionCalendar } from './SectionCalendar';
import { SectionEmail } from './SectionEmail';
import { SectionNews } from './SectionNews';

function isPayload(v: unknown): v is BriefingPayload {
  return !!v && typeof v === 'object' && 'date' in (v as object) && 'sections' in (v as object) === false
    && 'calendar' in (v as object);
}

function isErr(v: unknown): v is IpcError | { error: string } {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

export function BriefingScreen(): JSX.Element {
  const [payload, setPayload] = useState<BriefingPayload | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const res = await window.aria.briefingToday();
    if (isPayload(res)) {
      setPayload(res);
    } else if (isErr(res)) {
      setPayload(null);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!loaded) {
    return (
      <section style={{ padding: 'var(--aria-space-xl)' }}>
        <p data-testid="briefing-loading">Loading…</p>
      </section>
    );
  }

  if (!payload) {
    return (
      <section style={{ padding: 'var(--aria-space-xl)' }} data-testid="briefing-screen">
        <h1 style={{ fontSize: 'var(--aria-type-3xl)', marginTop: 0 }}>Today’s Briefing</h1>
        <GenerateNowAffordance onDone={() => void load()} />
      </section>
    );
  }

  const dateLabel = formatHeader(payload.date, payload.tz);

  return (
    <section style={{ padding: 'var(--aria-space-xl)' }} data-testid="briefing-screen">
      <header
        style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}
      >
        <h1 style={{ fontSize: 'var(--aria-type-3xl)', margin: 0 }}>
          Today’s Briefing — {dateLabel}
        </h1>
        <span data-testid={`route-badge-${payload.route}`} style={badgeStyle(payload.route)}>
          [{payload.route}]
        </span>
      </header>

      <SectionCalendar items={payload.calendar} error={payload.errors?.calendar} />
      <SectionEmail
        items={payload.email}
        error={payload.errors?.email}
        emailEmptyStateReason={payload.emailEmptyStateReason}
      />
      <SectionNews
        items={payload.news}
        date={payload.date}
        error={payload.errors?.news}
      />
    </section>
  );
}

function formatHeader(date: string, tz: string): string {
  try {
    const d = new Date(`${date}T12:00:00Z`);
    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(d);
  } catch {
    return date;
  }
}

function badgeStyle(route: BriefingPayload['route']): React.CSSProperties {
  return {
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 'var(--aria-type-sm)',
    backgroundColor: route === 'FRONTIER' ? '#dbeafe' : '#e5e7eb',
    color: route === 'FRONTIER' ? '#1e3a8a' : '#374151',
  };
}
