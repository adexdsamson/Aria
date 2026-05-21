/**
 * RecapScreen — list of past weekly recaps.
 *
 * Phase 9 design-ref `app-screen-recap.jsx` parity pass:
 *   - Topbar owns "WEEKLY RECAP / The week in brief" eyebrow+title; this
 *     screen does NOT duplicate them
 *   - H1 "Weekly Recap" + body paragraph explaining the Monday-morning
 *     generation + finalize-becomes-canonical flow
 *   - "Generate last-week recap" ghost button (top-right, with refresh glyph)
 *   - "PAST RECAPS" mono uppercase eyebrow above the list
 *   - List rows: ISO week (mono) | "Week of N–M Month YYYY" (Playfair italic)
 *                with subline · status pill (DRAFT gold / FINALIZED moss) ·
 *                "open →" italic gold link
 *   - Empty state: free-floating italic, no Card wrapper
 *
 * IPC + state + data-testids preserved verbatim.
 */
import { useEffect, useState } from 'react';
import type { RecapRowDto } from '../../../shared/ipc-contract';
import { RecapEditor } from './RecapEditor';

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

/** "Week of 11–17 May 2026" — design-ref row title format. */
function formatWeekRange(weekStartYmd: string): string {
  try {
    const start = new Date(`${weekStartYmd}T12:00:00`);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const startDay = start.getDate();
    const endDay = end.getDate();
    const startMonth = new Intl.DateTimeFormat(undefined, { month: 'short' }).format(start);
    const endMonth = new Intl.DateTimeFormat(undefined, { month: 'short' }).format(end);
    const year = end.getFullYear();
    if (startMonth === endMonth) {
      return `Week of ${startDay}–${endDay} ${startMonth} ${year}`;
    }
    return `Week of ${startDay} ${startMonth} – ${endDay} ${endMonth} ${year}`;
  } catch {
    return `Week of ${weekStartYmd}`;
  }
}

function formatFinalizedAt(iso: string): string {
  try {
    const d = new Date(iso);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `${date} ${time}`;
  } catch {
    return iso;
  }
}

export function RecapScreen(): JSX.Element {
  const [rows, setRows] = useState<RecapRowDto[]>([]);
  const [selected, setSelected] = useState<RecapRowDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    setError(null);
    const res = await window.aria.recapList({ limit: 26 });
    if ('error' in res) {
      setError(res.error);
      return;
    }
    setRows(res.rows);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function regenerateLastWeek(): Promise<void> {
    setBusy(true);
    try {
      const today = new Date();
      const dow = (today.getUTCDay() + 6) % 7;
      const mon = new Date(today);
      mon.setUTCDate(today.getUTCDate() - dow - 7);
      const weekStartYmd = `${mon.getUTCFullYear()}-${String(mon.getUTCMonth() + 1).padStart(2, '0')}-${String(mon.getUTCDate()).padStart(2, '0')}`;
      const thursday = new Date(mon);
      thursday.setUTCDate(mon.getUTCDate() + 3);
      const isoYear = thursday.getUTCFullYear();
      const firstThu = new Date(Date.UTC(isoYear, 0, 4));
      const firstThuDayNr = (firstThu.getUTCDay() + 6) % 7;
      firstThu.setUTCDate(firstThu.getUTCDate() - firstThuDayNr + 3);
      const week = 1 + Math.round((thursday.getTime() - firstThu.getTime()) / (7 * 86400000));
      const isoWeek = `${isoYear}-W${String(week).padStart(2, '0')}`;
      const res = await window.aria.recapRegenerate({ isoWeek, weekStartYmd });
      if ('error' in res || ('ok' in res && res.ok === false)) {
        setError(
          'error' in res && typeof res.error === 'string' ? res.error : 'regenerate-failed',
        );
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  // ── Inline editor view (when a recap row is selected) ─────────────────
  if (selected) {
    return (
      <div
        style={{
          padding: '24px 32px 0',
          background: 'var(--ivory)',
          minHeight: '100%',
          color: 'var(--ink)',
        }}
      >
        <button
          data-testid="recap-back"
          onClick={() => setSelected(null)}
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--gold-deep)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            marginBottom: 12,
          }}
        >
          ← Back to list
        </button>
        <RecapEditor
          recap={selected}
          onSaved={() => void refresh()}
          onFinalized={() => {
            void refresh();
            setSelected(null);
          }}
        />
      </div>
    );
  }

  // ── List view ──────────────────────────────────────────────────────────
  return (
    <div
      data-testid="recap-screen"
      style={{
        padding: '32px 40px 80px',
        maxWidth: 'var(--container, 1120px)',
        margin: '0 auto',
        background: 'var(--ivory)',
        color: 'var(--ink)',
        minHeight: '100%',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 24,
          marginBottom: 18,
          flexWrap: 'wrap',
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--f-display)',
            fontWeight: 500,
            fontSize: 'clamp(2rem, 4vw, 2.5rem)',
            letterSpacing: '-0.02em',
            lineHeight: 1.05,
          }}
        >
          Weekly Recap
        </h1>

        <button
          type="button"
          data-testid="recap-regenerate"
          disabled={busy}
          onClick={() => void regenerateLastWeek()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '9px 16px',
            background: 'var(--paper)',
            border: '1px solid var(--rule-strong)',
            borderRadius: 'var(--radius)',
            fontFamily: 'var(--f-body)',
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--ink-soft)',
            cursor: busy ? 'not-allowed' : 'pointer',
            transition: `background 180ms ease, border-color 180ms ease, transform 140ms ${EASE_OUT}`,
          }}
          onMouseEnter={(e) => {
            if (!busy) {
              e.currentTarget.style.background = 'rgba(184,134,11,0.04)';
              e.currentTarget.style.borderColor = 'var(--gold-light)';
            }
          }}
          onMouseLeave={(e) => {
            if (!busy) {
              e.currentTarget.style.background = 'var(--paper)';
              e.currentTarget.style.borderColor = 'var(--rule-strong)';
            }
          }}
          onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
          onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <polyline points="21 4 21 10 15 10" />
          </svg>
          {busy ? 'Generating…' : 'Generate last-week recap'}
        </button>
      </header>

      <p
        style={{
          margin: '0 0 36px 0',
          fontSize: 15,
          color: 'var(--ink-soft)',
          lineHeight: 1.65,
          maxWidth: '54em',
          textWrap: 'pretty' as const,
        }}
      >
        Aria writes you a recap every Monday morning. Edits stick; once you finalize a week it
        becomes the canonical record and can be exported to DOCX or PDF.
      </p>

      {error && (
        <p
          role="alert"
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 12,
            letterSpacing: '0.08em',
            color: 'var(--rose)',
            margin: '0 0 16px 0',
            padding: '8px 12px',
            background: 'rgba(184,73,58,0.06)',
            borderLeft: '2px solid var(--rose)',
            borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
          }}
        >
          {error}
        </p>
      )}

      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--gray)',
          marginBottom: 4,
        }}
      >
        Past recaps
      </div>

      {rows.length === 0 ? (
        <p
          data-testid="recap-empty"
          style={{
            margin: '32px 0 0 0',
            fontFamily: 'var(--f-display)',
            fontStyle: 'italic',
            fontSize: '1.0625rem',
            color: 'var(--gray)',
            lineHeight: 1.55,
            textWrap: 'pretty' as const,
          }}
        >
          No recaps yet — Aria generates one Monday morning. Or click "Generate last-week recap"
          above.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {rows.map((r, i) => {
            const finalized = Boolean(r.finalizedAt);
            return (
              <li
                key={r.id}
                style={{
                  borderTop: '1px solid var(--rule)',
                  borderBottom: i === rows.length - 1 ? '1px solid var(--rule)' : 'none',
                }}
              >
                <button
                  data-testid={`recap-open-${r.isoWeek}`}
                  onClick={() => setSelected(r)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    cursor: 'pointer',
                    background: 'transparent',
                    border: 'none',
                    padding: '20px 8px',
                    display: 'grid',
                    gridTemplateColumns: '120px 1fr auto auto',
                    alignItems: 'center',
                    gap: 18,
                    transition: 'background 180ms ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(184,134,11,0.03)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <span
                    style={{
                      fontFamily: 'var(--f-mono)',
                      fontSize: 11,
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      color: 'var(--gray)',
                    }}
                  >
                    {r.isoWeek}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span
                      style={{
                        display: 'block',
                        fontFamily: 'var(--f-display)',
                        fontWeight: 500,
                        fontSize: '1.125rem',
                        color: 'var(--ink)',
                        lineHeight: 1.3,
                      }}
                    >
                      {formatWeekRange(r.weekStartYmd)}
                    </span>
                    <span
                      style={{
                        display: 'block',
                        marginTop: 4,
                        fontFamily: 'var(--f-mono)',
                        fontSize: 11,
                        letterSpacing: '0.08em',
                        color: 'var(--gray)',
                      }}
                    >
                      {finalized
                        ? `Finalized ${formatFinalizedAt(r.finalizedAt!)}`
                        : 'Draft · ready for review'}
                    </span>
                  </span>
                  <span
                    aria-label={finalized ? 'Finalized' : 'Draft'}
                    style={{
                      fontFamily: 'var(--f-mono)',
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: '0.16em',
                      textTransform: 'uppercase',
                      padding: '4px 10px',
                      borderRadius: 'var(--radius-sm)',
                      color: finalized ? 'var(--moss)' : 'var(--gold-deep)',
                      background: finalized
                        ? 'rgba(91,110,58,0.08)'
                        : 'rgba(184,134,11,0.08)',
                      border: `1px solid ${finalized ? 'rgba(91,110,58,0.30)' : 'rgba(184,134,11,0.30)'}`,
                    }}
                  >
                    {finalized ? 'Finalized' : 'Draft'}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--f-display)',
                      fontStyle: 'italic',
                      fontSize: 14,
                      color: 'var(--gold-deep)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    open →
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
