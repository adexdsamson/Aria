/**
 * Plan 08-02 Task 7 + Phase 9 re-skin — RecapScreen.
 *
 * Lists past recaps (most recent first); clicking opens RecapEditor inline.
 * Reached via the `/recap` route (registered in `src/renderer/app/routes.tsx`).
 * SideNav entry "Weekly Recap" links here.
 *
 * IPC contract preserved: recapList, recapRegenerate. Test-ids preserved.
 */
import { useEffect, useState } from 'react';
import type { RecapRowDto } from '../../../shared/ipc-contract';
import { Button, Card } from '../../components/editorial';
import { RecapEditor } from './RecapEditor';

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

  async function regenerateThisWeek(): Promise<void> {
    setBusy(true);
    try {
      const today = new Date();
      const dow = (today.getUTCDay() + 6) % 7; // Mon=0..Sun=6
      const mon = new Date(today);
      mon.setUTCDate(today.getUTCDate() - dow - 7); // Prior Monday.
      const weekStartYmd = `${mon.getUTCFullYear()}-${String(mon.getUTCMonth() + 1).padStart(2, '0')}-${String(mon.getUTCDate()).padStart(2, '0')}`;
      // ISO week label
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

  if (selected) {
    return (
      <div
        style={{
          padding: '1.5rem 2rem 0',
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
            color: 'var(--gray)',
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

  return (
    <div
      data-testid="recap-screen"
      style={{
        padding: '2.5rem 2rem 4rem',
        maxWidth: 'var(--container-wide)',
        margin: '0 auto',
        background: 'var(--ivory)',
        color: 'var(--ink)',
        minHeight: '100%',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          marginBottom: 24,
          borderBottom: '1px solid var(--rule)',
          paddingBottom: 18,
        }}
      >
        <div>
          <div className="smallcaps" style={{ color: 'var(--gray-soft)', marginBottom: 8 }}>
            Friday close · trust anchor
          </div>
          <h1
            style={{
              margin: 0,
              fontFamily: 'var(--f-display)',
              fontWeight: 500,
              fontSize: '2rem',
              letterSpacing: '-0.01em',
            }}
          >
            Weekly recap
          </h1>
        </div>
        <Button
          data-testid="recap-regenerate"
          disabled={busy}
          onClick={() => void regenerateThisWeek()}
          variant="outline"
        >
          {busy ? 'Generating…' : 'Generate last-week recap'}
        </Button>
      </header>

      {error && (
        <p
          role="alert"
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 12,
            letterSpacing: '0.08em',
            color: 'var(--rose)',
          }}
        >
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <Card>
          <p
            data-testid="recap-empty"
            style={{
              margin: 0,
              fontFamily: 'var(--f-display)',
              fontStyle: 'italic',
              fontSize: '1.125rem',
              color: 'var(--gray)',
              textAlign: 'center',
              lineHeight: 1.6,
            }}
          >
            No recaps yet — Aria generates one Monday morning. Or click "Generate last-week recap"
            above.
          </p>
        </Card>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((r) => {
            const finalized = Boolean(r.finalizedAt);
            return (
              <li key={r.id}>
                <button
                  data-testid={`recap-open-${r.isoWeek}`}
                  onClick={() => setSelected(r)}
                  className="card card-hover"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                    padding: '14px 20px',
                    border: '1px solid var(--rule)',
                    background: 'var(--paper)',
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontFamily: 'var(--f-display)',
                        fontWeight: 500,
                        fontSize: '1.0625rem',
                        color: 'var(--ink)',
                      }}
                    >
                      {r.isoWeek}
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--f-mono)',
                        fontSize: 10,
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase',
                        color: 'var(--gray)',
                        marginTop: 4,
                      }}
                    >
                      Week of {r.weekStartYmd}
                    </div>
                  </div>
                  <span style={statusPillStyle(finalized)}>{finalized ? 'Finalized' : 'Draft'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function statusPillStyle(finalized: boolean): React.CSSProperties {
  return {
    fontFamily: 'var(--f-mono)',
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    padding: '3px 10px',
    borderRadius: 999,
    border: `1px solid ${finalized ? 'var(--moss)' : 'var(--rule-strong)'}`,
    background: finalized ? 'rgba(91,110,58,0.10)' : 'var(--ivory-deep)',
    color: finalized ? 'var(--moss)' : 'var(--gray)',
  };
}
