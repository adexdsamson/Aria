/**
 * Plan 08-01 Task 8 — Settings → Insights section.
 *
 * Surfaces:
 *   - When gate is locked: "Insights unlock in N days" + per-corpus breakdown
 *   - When unlocked: list of latest insight cards + "Recompute now" affordance
 *
 * MUST be reachable from `SettingsScreen.tsx` (L-04-04 invariant —
 * `feedback_verifier_blindspot_ui_wiring`).
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  InsightKindDto,
  InsightsLatestResult,
} from '../../../shared/ipc-contract';

function hasError(v: unknown): v is { error: string } {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

const KIND_LABEL: Record<InsightKindDto, string> = {
  calendar_load: 'Calendar load',
  response_time: 'Response time',
  recurring_themes: 'Recurring themes',
  approval_edits: 'Draft edit pattern',
};

export function InsightsSection(): JSX.Element {
  const [result, setResult] = useState<InsightsLatestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await window.aria.insightsLatest();
    if (hasError(res)) {
      setError(res.error);
      setResult(null);
      return;
    }
    setError(null);
    setResult(res);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRecompute = useCallback(async () => {
    setBusy(true);
    setToast(null);
    try {
      const res = await window.aria.insightsRecompute();
      if (hasError(res)) {
        setToast(`Failed: ${res.error}`);
      } else {
        const asUnknown = res as unknown as { ok: boolean; written?: number; error?: string };
        if (asUnknown.ok === false) {
          setToast(`Failed: ${asUnknown.error ?? 'unknown'}`);
        } else {
          const w = asUnknown.written ?? 0;
          setToast(`Recomputed ${w} insight${w === 1 ? '' : 's'}.`);
          await load();
        }
      }
    } finally {
      setBusy(false);
    }
  }, [load]);

  return (
    <section data-testid="settings-insights" style={{ padding: 'var(--aria-space-xl)' }}>
      <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 28, fontWeight: 500, color: 'var(--ink)', marginTop: 0, borderBottom: '1px solid var(--rule)', paddingBottom: 12 }}>Insights</h2>
      <p style={{ fontSize: 13, color: 'var(--aria-fg-muted, #6b7280)', maxWidth: 640 }}>
        Aria derives weekly insights from your own data only — calendar load,
        response time, recurring themes, and draft-edit patterns. Numeric
        aggregates only ever leave your machine; raw email, calendar, and
        meeting content do not.
      </p>

      {error && (
        <p role="alert" data-testid="insights-error" style={{ color: '#b91c1c', fontSize: 12 }}>
          Could not load insights: {error}
        </p>
      )}

      {result?.state === 'locked' && (
        <div data-testid="insights-locked" style={lockedBoxStyle()}>
          <strong>Insights unlock in {result.daysRemaining} day{result.daysRemaining === 1 ? '' : 's'}.</strong>
          <p style={{ fontSize: 12, marginTop: 6 }}>
            Aria needs 14 days of history per data source before computing
            insights. Blocked sources:
          </p>
          <ul style={{ fontSize: 12, marginTop: 4 }}>
            {result.blockedKinds.map((k) => (
              <li key={k} data-testid={`insights-blocked-${k}`}>{KIND_LABEL[k]}</li>
            ))}
          </ul>
        </div>
      )}

      {result?.state === 'unlocked' && (
        <ul data-testid="insights-rows" style={{ listStyle: 'none', padding: 0 }}>
          {result.rows.map((row) => (
            <li key={row.id} data-testid={`insight-card-${row.kind}`} style={cardStyle()}>
              <strong style={{ fontSize: 13 }}>{KIND_LABEL[row.kind]}</strong>
              <ul style={{ marginTop: 4, fontSize: 13 }}>
                {row.sentences.length > 0
                  ? row.sentences.map((s, i) => <li key={i}>{s}</li>)
                  : <li style={{ color: '#6b7280' }}>(no prose generated)</li>}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {result?.state === 'empty-unlocked' && (
        <p data-testid="insights-empty" style={{ fontSize: 13, color: '#6b7280' }}>
          No insights for this week yet — they compute overnight, or you can
          recompute manually below.
        </p>
      )}

      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          data-testid="insights-recompute-btn"
          onClick={() => void onRecompute()}
          disabled={busy}
        >
          {busy ? 'Recomputing…' : 'Recompute now'}
        </button>
        {toast && (
          <span data-testid="insights-recompute-toast" style={{ marginLeft: 8, fontSize: 12 }}>
            {toast}
          </span>
        )}
      </div>
    </section>
  );
}

function lockedBoxStyle(): React.CSSProperties {
  return {
    border: '1px solid #fcd34d',
    background: '#fffbeb',
    padding: 12,
    borderRadius: 6,
    marginTop: 8,
    fontSize: 13,
  };
}

function cardStyle(): React.CSSProperties {
  return {
    border: '1px solid var(--aria-border, #e5e7eb)',
    borderRadius: 6,
    padding: 10,
    marginBottom: 8,
  };
}
