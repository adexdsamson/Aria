/**
 * Plan 08-02 Task 7 — RecapScreen.
 *
 * Lists past recaps (most recent first); clicking opens RecapEditor inline.
 * Reached via the `/recap` route (registered in `src/renderer/app/routes.tsx`).
 * SideNav entry "Weekly Recap" links here.
 */
import { useEffect, useState } from 'react';
import type { RecapRowDto } from '../../../shared/ipc-contract';
import { RecapEditor } from './RecapEditor';

export function RecapScreen(): JSX.Element {
  const [rows, setRows] = useState<RecapRowDto[]>([]);
  const [selected, setSelected] = useState<RecapRowDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    setError(null);
    const res = await window.aria.recapList({ limit: 26 });
    if ('error' in res) { setError(res.error); return; }
    setRows(res.rows);
  }

  useEffect(() => { void refresh(); }, []);

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
        setError(('error' in res && typeof res.error === 'string') ? res.error : 'regenerate-failed');
      }
      await refresh();
    } finally { setBusy(false); }
  }

  if (selected) {
    return (
      <div>
        <button data-testid="recap-back" onClick={() => setSelected(null)} style={{ margin: 16 }}>← Back to list</button>
        <RecapEditor recap={selected} onSaved={() => void refresh()} onFinalized={() => { void refresh(); setSelected(null); }} />
      </div>
    );
  }

  return (
    <div data-testid="recap-screen" style={{ padding: 24, maxWidth: 880, margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>Weekly Recap</h1>
        <button data-testid="recap-regenerate" disabled={busy} onClick={() => void regenerateThisWeek()}>
          {busy ? 'Generating…' : 'Generate last-week recap'}
        </button>
      </header>
      {error && <p role="alert" style={{ color: '#a00' }}>{error}</p>}
      {rows.length === 0 ? (
        <p data-testid="recap-empty">No recaps yet — Aria generates one Monday morning. Or click "Generate last-week recap" above.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {rows.map((r) => (
            <li key={r.id} style={{ borderBottom: '1px solid #eee', padding: 12 }}>
              <button
                data-testid={`recap-open-${r.isoWeek}`}
                onClick={() => setSelected(r)}
                style={{ background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', width: '100%' }}
              >
                <strong>{r.isoWeek}</strong> · week of {r.weekStartYmd}
                {r.finalizedAt && <span style={{ marginLeft: 8, fontSize: 12, color: '#080' }}>finalized</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
