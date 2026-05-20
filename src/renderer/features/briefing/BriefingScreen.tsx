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
 *
 * Phase 9 Plan 03 — RE-SKINNED. Visual chrome upgraded to editorial primitives
 * (.card, LabelRule, RouteBadge, Button). All IPC + state + data-testid +
 * aria attributes are preserved verbatim from the previous implementation.
 */
import { useCallback, useEffect, useState } from 'react';
import type { BriefingPayload, IpcError } from '../../../shared/ipc-contract';
import { Button, Card, RouteBadge } from '../../components/editorial';
import { GenerateNowAffordance } from './GenerateNowAffordance';
import { SectionCalendar } from './SectionCalendar';
import { SectionEmail } from './SectionEmail';
import { SectionNews } from './SectionNews';
import { InlineApprovalsPreview } from '../approvals/InlineApprovalsPreview';
import { BriefingFeedbackChips } from './BriefingFeedbackChips';

// Plan 08-03 Task 3 — Stream 3 wired up.
async function dismissBriefingInsight(briefingDate: string, kind: string): Promise<void> {
  try {
    await window.aria.briefingInsightDismiss({ briefingDate, kind });
  } catch {
    /* non-fatal — keep the optimistic UI dismiss in component state */
  }
}

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
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const res = await window.aria.briefingToday();
    if (isPayload(res)) {
      setPayload(res);
    } else if (isErr(res)) {
      setPayload(null);
    }
    setLoaded(true);
  }, []);

  const regenerate = useCallback(async (): Promise<void> => {
    setConfirmOpen(false);
    setRegenerating(true);
    setRegenerateError(null);
    try {
      const res = await window.aria.briefingRegenerateToday();
      if (isPayload(res)) {
        setPayload(res);
      } else if (isErr(res)) {
        setRegenerateError((res as { error: string }).error);
      }
    } finally {
      setRegenerating(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!loaded) {
    return (
      <section style={{ padding: '32px 40px' }}>
        <p
          data-testid="briefing-loading"
          style={{ fontFamily: 'var(--f-display)', fontStyle: 'italic', color: 'var(--gray)' }}
        >
          Loading…
        </p>
      </section>
    );
  }

  if (!payload) {
    return (
      <section style={{ maxWidth: 920, margin: '0 auto', padding: '32px 40px 80px' }} data-testid="briefing-screen">
        <h1 style={{ fontFamily: 'var(--f-display)', fontWeight: 500, fontSize: 'clamp(2rem, 4vw, 2.75rem)', letterSpacing: '-0.02em', margin: '0 0 14px 0' }}>
          Today’s Briefing
        </h1>
        <GenerateNowAffordance onDone={() => void load()} />
      </section>
    );
  }

  const dateLabel = formatHeader(payload.date, payload.tz);

  return (
    <section
      style={{ maxWidth: 920, margin: '0 auto', padding: '32px 40px 80px', color: 'var(--ink)' }}
      data-testid="briefing-screen"
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          paddingBottom: 12,
          marginBottom: 28,
          borderBottom: '1px solid var(--rule)',
        }}
      >
        <h1
          style={{
            fontFamily: 'var(--f-display)',
            fontWeight: 500,
            fontSize: 'clamp(1.75rem, 3.5vw, 2.5rem)',
            letterSpacing: '-0.02em',
            margin: 0,
            flex: 1,
            minWidth: 0,
          }}
        >
          Today’s Briefing —{' '}
          <span style={{ fontStyle: 'italic', color: 'var(--gray)' }}>{dateLabel}</span>
        </h1>
        <span data-testid={`route-badge-${payload.route}`}>
          <RouteBadge route={payload.route} />
        </span>
        <Button
          variant="ghost"
          data-testid="briefing-regenerate-btn"
          onClick={() => setConfirmOpen(true)}
          disabled={regenerating}
          style={{
            minHeight: 32,
            padding: '4px 10px',
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--gold)',
          }}
        >
          {regenerating ? 'Regenerating…' : '↺ Regenerate'}
        </Button>
      </header>
      {regenerateError && (
        <p
          role="alert"
          data-testid="briefing-regenerate-error"
          style={{
            color: 'var(--rose)',
            fontSize: 12,
            fontFamily: 'var(--f-mono)',
            letterSpacing: '0.06em',
            margin: '0 0 12px 0',
          }}
        >
          Could not regenerate: {regenerateError}
        </p>
      )}
      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="briefing-regenerate-confirm"
          style={{
            border: '1px solid var(--rule-strong)',
            background: 'var(--ivory-deep)',
            padding: '14px 18px',
            borderRadius: 6,
            marginBottom: 16,
            fontSize: 13.5,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <p style={{ margin: 0, flex: 1, color: 'var(--ink-soft)' }}>
            Regenerate today’s briefing? This replaces the current one and writes a new routing_log row.
          </p>
          <Button
            variant="primary"
            data-testid="briefing-regenerate-confirm-btn"
            onClick={() => void regenerate()}
            disabled={regenerating}
            style={{ minHeight: 30, padding: '0 14px', fontSize: 12.5 }}
          >
            Regenerate
          </Button>
          <Button
            variant="ghost"
            data-testid="briefing-regenerate-cancel-btn"
            onClick={() => setConfirmOpen(false)}
            disabled={regenerating}
            style={{ minHeight: 30, padding: '0 12px', fontSize: 12.5 }}
          >
            Cancel
          </Button>
        </div>
      )}

      <InlineApprovalsPreview />
      {payload.openActions && payload.openActions.length > 0 && (
        <section data-testid="briefing-open-actions" style={{ marginBottom: 36 }}>
          <h2
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: '1.5rem',
              fontWeight: 500,
              letterSpacing: '-0.01em',
              margin: '0 0 12px 0',
            }}
          >
            Open Actions
          </h2>
          <Card>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {payload.openActions.map((item, i) => (
                <li
                  key={item.id}
                  style={{
                    padding: '10px 0',
                    borderBottom:
                      i === payload.openActions!.length - 1 ? 'none' : '1px solid var(--rule)',
                  }}
                >
                  <strong style={{ color: 'var(--ink)' }}>{item.title}</strong>
                  <div style={{ color: 'var(--gray)', fontSize: 13.5, fontStyle: 'italic', marginTop: 4 }}>
                    {item.why}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
      {payload.thisWeekInsights?.state === 'locked' && (
        <section data-testid="briefing-insights-locked" style={{ marginBottom: 28 }}>
          <h2
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: '1.5rem',
              fontWeight: 500,
              letterSpacing: '-0.01em',
              margin: '0 0 8px 0',
            }}
          >
            This week
          </h2>
          <p style={{ fontSize: 13.5, color: 'var(--gray)', fontStyle: 'italic', margin: 0 }}>
            Insights unlock in <strong>{payload.thisWeekInsights.daysRemaining}</strong> day{payload.thisWeekInsights.daysRemaining === 1 ? '' : 's'}.
          </p>
        </section>
      )}
      {payload.thisWeekInsights?.state === 'unlocked' && payload.thisWeekInsights.rows.length > 0 && (
        <section data-testid="briefing-insights" style={{ marginBottom: 28 }}>
          <h2
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: '1.5rem',
              fontWeight: 500,
              letterSpacing: '-0.01em',
              margin: '0 0 8px 0',
            }}
          >
            This week
          </h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {payload.thisWeekInsights.rows.slice(0, 3).map((r) => (
              <li
                key={r.id}
                data-testid={`briefing-insight-${r.kind}`}
                style={{ fontSize: 14, color: 'var(--ink-soft)', padding: '6px 0' }}
              >
                {r.sentences[0] ?? '(insight ready — open Settings → Insights)'}
                <Button
                  variant="ghost"
                  data-testid={`briefing-insight-dismiss-${r.kind}`}
                  onClick={() => void dismissBriefingInsight(payload.date, r.kind)}
                  style={{
                    marginLeft: 8,
                    fontSize: 10,
                    padding: '2px 8px',
                    minHeight: 'auto',
                    fontFamily: 'var(--f-mono)',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--gray-soft)',
                  }}
                >
                  Dismiss
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div style={{ marginBottom: 36 }}>
        <SectionCalendar items={payload.calendar} error={payload.errors?.calendar} />
        <BriefingFeedbackChips briefingDate={payload.date} sectionKey="calendar" />
      </div>
      <div style={{ marginBottom: 36 }}>
        <SectionEmail
          items={payload.email}
          error={payload.errors?.email}
          emailEmptyStateReason={payload.emailEmptyStateReason}
        />
        <BriefingFeedbackChips briefingDate={payload.date} sectionKey="email" />
      </div>
      <div>
        <SectionNews
          items={payload.news}
          date={payload.date}
          error={payload.errors?.news}
        />
        <BriefingFeedbackChips briefingDate={payload.date} sectionKey="news" />
      </div>
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
