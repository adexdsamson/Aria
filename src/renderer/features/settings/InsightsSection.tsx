/**
 * InsightsSection — Settings → Insights.
 *
 * Phase 9 design-ref `app-screen-settings.jsx > Insights` parity pass:
 *   - "SETTING · IX" gold mono eyebrow + h1 "Patterns from your data"
 *   - Playfair italic body explaining trust posture (aggregates-only, raw stays)
 *   - LOCKED state: editorial gold-tinted card with "Insights unlock in N days"
 *     headline + numbered list of blocked kinds
 *   - UNLOCKED state: 2×2 card grid (CALENDAR LOAD / RESPONSE TIME / RECURRING
 *     THEMES / DRAFT EDIT PATTERN) with gold mono headers + body sentences
 *   - Footer: "Recompute now" ghost button + mono "LAST COMPUTED · ROUTED LOCAL"
 *
 * IPC + state + data-testids preserved verbatim.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  InsightKindDto,
  InsightsLatestResult,
} from '../../../shared/ipc-contract';

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

function hasError(v: unknown): v is { error: string } {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

const KIND_LABEL: Record<InsightKindDto, string> = {
  calendar_load: 'Calendar load',
  response_time: 'Response time',
  recurring_themes: 'Recurring themes',
  approval_edits: 'Draft edit pattern',
};

const ALL_KINDS: ReadonlyArray<InsightKindDto> = [
  'calendar_load',
  'response_time',
  'recurring_themes',
  'approval_edits',
];

export function InsightsSection(): JSX.Element {
  const [result, setResult] = useState<InsightsLatestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [lastComputedAt, setLastComputedAt] = useState<Date | null>(null);

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
          setLastComputedAt(new Date());
          await load();
        }
      }
    } finally {
      setBusy(false);
    }
  }, [load]);

  return (
    <section
      data-testid="settings-insights"
      style={{
        padding: '32px 40px 80px',
        maxWidth: '64rem',
        margin: '0 auto',
        background: 'var(--paper)',
        color: 'var(--ink)',
        minHeight: '100%',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--gold)',
          marginBottom: 8,
        }}
      >
        Setting · IX
      </div>
      <h2
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 30,
          fontWeight: 500,
          letterSpacing: '-0.02em',
          color: 'var(--ink)',
          margin: 0,
          marginBottom: 14,
          lineHeight: 1.05,
        }}
      >
        Patterns from your data
      </h2>
      <p
        style={{
          fontFamily: 'var(--f-display)',
          fontStyle: 'italic',
          fontSize: 15,
          color: 'var(--ink-soft)',
          margin: '0 0 36px 0',
          maxWidth: '54em',
          lineHeight: 1.6,
        }}
      >
        Aria derives weekly insights from your own data only — numeric aggregates only ever
        leave your machine; raw content does not.
      </p>

      {error && (
        <p
          role="alert"
          data-testid="insights-error"
          style={{
            margin: '0 0 18px 0',
            padding: '8px 12px',
            fontFamily: 'var(--f-mono)',
            fontSize: 12,
            color: 'var(--rose)',
            background: 'rgba(184,73,58,0.06)',
            borderLeft: '2px solid var(--rose)',
            borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
          }}
        >
          Could not load insights: {error}
        </p>
      )}

      {/* LOCKED state — editorial gold-tinted card */}
      {result?.state === 'locked' && (
        <div
          data-testid="insights-locked"
          style={{
            padding: '22px 26px',
            background: 'var(--ivory-deep)',
            border: '1px solid rgba(184,134,11,0.30)',
            borderLeft: '3px solid var(--gold)',
            borderRadius: 'var(--radius-lg)',
            marginBottom: 18,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 19,
              fontWeight: 500,
              color: 'var(--ink)',
              marginBottom: 8,
            }}
          >
            Insights unlock in {result.daysRemaining} day{result.daysRemaining === 1 ? '' : 's'}.
          </div>
          <p
            style={{
              margin: '0 0 12px 0',
              fontSize: 14,
              color: 'var(--ink-soft)',
              lineHeight: 1.55,
              maxWidth: '50em',
            }}
          >
            Aria needs 14 days of history per data source before computing insights. Blocked
            sources:
          </p>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {result.blockedKinds.map((k) => (
              <li
                key={k}
                data-testid={`insights-blocked-${k}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontFamily: 'var(--f-mono)',
                  fontSize: 12,
                  color: 'var(--gray)',
                  letterSpacing: '0.04em',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 50,
                    background: 'var(--gold-light)',
                  }}
                />
                {KIND_LABEL[k]}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* UNLOCKED state — 2×2 card grid */}
      {result?.state === 'unlocked' && (
        <ul
          data-testid="insights-rows"
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 14,
          }}
        >
          {result.rows.map((row) => (
            <li
              key={row.id}
              data-testid={`insight-card-${row.kind}`}
              style={{
                padding: '18px 22px',
                background: 'var(--paper)',
                border: '1px solid var(--rule)',
                borderRadius: 'var(--radius-lg)',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 10,
                  fontWeight: 500,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: 'var(--gold)',
                  marginBottom: 12,
                }}
              >
                {KIND_LABEL[row.kind]}
              </div>
              {row.sentences.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {row.sentences.map((s, i) => (
                    <p
                      key={i}
                      style={{
                        margin: 0,
                        fontFamily: 'var(--f-display)',
                        fontSize: 14.5,
                        color: 'var(--ink)',
                        lineHeight: 1.55,
                      }}
                    >
                      {s}
                    </p>
                  ))}
                </div>
              ) : (
                <p
                  style={{
                    margin: 0,
                    fontFamily: 'var(--f-display)',
                    fontStyle: 'italic',
                    fontSize: 14,
                    color: 'var(--gray)',
                  }}
                >
                  (no prose generated this week)
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* EMPTY-UNLOCKED state */}
      {result?.state === 'empty-unlocked' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 14,
          }}
        >
          {ALL_KINDS.map((k) => (
            <div
              key={k}
              style={{
                padding: '18px 22px',
                background: 'var(--paper)',
                border: '1px dashed var(--rule-strong)',
                borderRadius: 'var(--radius-lg)',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 10,
                  fontWeight: 500,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: 'var(--gray)',
                  marginBottom: 12,
                }}
              >
                {KIND_LABEL[k]}
              </div>
              <p
                style={{
                  margin: 0,
                  fontFamily: 'var(--f-display)',
                  fontStyle: 'italic',
                  fontSize: 13.5,
                  color: 'var(--gray)',
                }}
              >
                Pending compute — runs overnight, or recompute below.
              </p>
            </div>
          ))}
          <span data-testid="insights-empty" style={{ display: 'none' }} />
        </div>
      )}

      {/* Footer: Recompute + last-computed caption */}
      <div
        style={{
          marginTop: 22,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          data-testid="insights-recompute-btn"
          onClick={() => void onRecompute()}
          disabled={busy}
          style={{
            padding: '8px 16px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontFamily: 'var(--f-body)',
            fontSize: 13,
            color: busy ? 'var(--gray)' : 'var(--ink-soft)',
            background: 'var(--paper)',
            border: '1px solid var(--rule-strong)',
            borderRadius: 'var(--radius)',
            cursor: busy ? 'not-allowed' : 'pointer',
            transition: `border-color 180ms ease, color 180ms ease, transform 140ms ${EASE_OUT}`,
          }}
          onMouseEnter={(e) => {
            if (!busy) {
              e.currentTarget.style.borderColor = 'var(--gold-light)';
              e.currentTarget.style.color = 'var(--gold-deep)';
            }
          }}
          onMouseLeave={(e) => {
            if (!busy) {
              e.currentTarget.style.borderColor = 'var(--rule-strong)';
              e.currentTarget.style.color = 'var(--ink-soft)';
            }
          }}
          onMouseDown={(e) => {
            if (!busy) e.currentTarget.style.transform = 'scale(0.97)';
          }}
          onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <polyline points="21 4 21 10 15 10" />
          </svg>
          {busy ? 'Recomputing…' : 'Recompute now'}
        </button>
        <span
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--gray-soft)',
          }}
        >
          {lastComputedAt
            ? `Last computed · ${lastComputedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · routed local`
            : 'Routed local'}
        </span>
        {toast && (
          <span
            data-testid="insights-recompute-toast"
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 11,
              letterSpacing: '0.08em',
              color: toast.startsWith('Failed') ? 'var(--rose)' : 'var(--moss)',
            }}
          >
            {toast}
          </span>
        )}
      </div>
    </section>
  );
}
