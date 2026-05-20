/**
 * Plan 08-03 Task 5 — Settings → Learned Preferences.
 *
 * Tree-view of typed preferences with per-field reset + global reset, plus a
 * read-only paginated signal log sub-page. Reset operations are gated by the
 * DisconnectConfirmDialog primitive (3-assertion test pattern; MEMORY
 * `feedback-destructive-actions-require-consent`).
 *
 * Reachable via SettingsScreen.tsx (L-04-04 invariant); see the reachability
 * grep test in LearnedPreferencesSection.test.tsx.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DisconnectConfirmDialog } from '../../components/DisconnectConfirmDialog';
import type { LearnedPreferencesDto, LearningSignalDto } from '../../../shared/ipc-contract';

interface PrefsRow {
  preferences: LearnedPreferencesDto;
  signalsCount: number;
  lastUpdatedAt: string | null;
}

const FIELDS: Array<{ path: string; label: string }> = [
  { path: 'voice.terseness', label: 'Voice — terseness' },
  { path: 'voice.formality', label: 'Voice — formality' },
  { path: 'briefing.sectionOrder', label: 'Briefing — section order' },
  { path: 'scheduling.preferredMeetingLength', label: 'Scheduling — preferred meeting length' },
  { path: 'triage.vipDomains', label: 'Triage — VIP domains' },
];

function pickValue(prefs: LearnedPreferencesDto, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = prefs;
  for (const p of parts) {
    if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[p];
    else return undefined;
  }
  return cur;
}

export function LearnedPreferencesSection(): JSX.Element {
  const [row, setRow] = useState<PrefsRow | null>(null);
  const [pendingField, setPendingField] = useState<string | null>(null);
  const [resetAllConfirm, setResetAllConfirm] = useState(false);
  const [view, setView] = useState<'prefs' | 'signal-log'>('prefs');

  const reload = useCallback(async () => {
    const r = await window.aria.learnGetPrefs();
    if (r && typeof r === 'object' && 'preferences' in r) {
      setRow(r as PrefsRow);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onResetField = useCallback(
    async (fieldPath: string) => {
      await window.aria.learnResetField({ fieldPath });
      setPendingField(null);
      await reload();
    },
    [reload],
  );

  const onResetAll = useCallback(async () => {
    await window.aria.learnResetAll();
    setResetAllConfirm(false);
    await reload();
  }, [reload]);

  if (!row) {
    return (
      <section data-testid="settings-learned-preferences" style={{ padding: 'var(--aria-space-xl)' }}>
        <p>Loading…</p>
      </section>
    );
  }

  return (
    <section data-testid="settings-learned-preferences" style={{ padding: 'var(--aria-space-xl)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Learned Preferences</h2>
        <span style={{ fontSize: 13, color: '#6b7280' }}>
          Last updated: {row.lastUpdatedAt ?? 'never'} · signals seen: {row.signalsCount}
        </span>
        <button
          type="button"
          data-testid="learn-view-toggle"
          onClick={() => setView((v) => (v === 'prefs' ? 'signal-log' : 'prefs'))}
          style={{ marginLeft: 'auto' }}
        >
          {view === 'prefs' ? 'View signal log' : 'Back to preferences'}
        </button>
      </header>

      {view === 'prefs' ? (
        <div>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {FIELDS.map((f) => {
              const v = pickValue(row.preferences, f.path);
              return (
                <li
                  key={f.path}
                  data-testid={`learn-field-${f.path}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '8px 0',
                    borderBottom: '1px solid #e5e7eb',
                  }}
                >
                  <span style={{ flex: 1 }}>
                    <strong>{f.label}</strong>:{' '}
                    <code style={{ fontSize: 12, color: '#4b5563' }}>
                      {JSON.stringify(v)}
                    </code>
                  </span>
                  <button
                    type="button"
                    data-testid={`learn-reset-${f.path}`}
                    onClick={() => setPendingField(f.path)}
                  >
                    Reset
                  </button>
                </li>
              );
            })}
          </ul>
          <div style={{ marginTop: 16 }}>
            <button
              type="button"
              data-testid="learn-reset-all"
              onClick={() => setResetAllConfirm(true)}
              style={{ background: '#dc2626', color: '#fff', padding: '6px 12px', borderRadius: 4 }}
            >
              Reset all preferences
            </button>
          </div>
        </div>
      ) : (
        <SignalLogPanel />
      )}

      {pendingField && (
        <DisconnectConfirmDialog
          provider={`learned preference "${pendingField}"`}
          wipesRagData={false}
          testIdSuffix={`learn-field-${pendingField}`}
          onConfirm={() => onResetField(pendingField)}
          onCancel={() => setPendingField(null)}
        />
      )}
      {resetAllConfirm && (
        <DisconnectConfirmDialog
          provider="ALL learned preferences"
          wipesRagData={false}
          testIdSuffix="learn-reset-all"
          onConfirm={onResetAll}
          onCancel={() => setResetAllConfirm(false)}
        />
      )}
    </section>
  );
}

function SignalLogPanel(): JSX.Element {
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<LearningSignalDto[]>([]);
  const limit = 25;

  useEffect(() => {
    void (async () => {
      const res = await window.aria.learnListSignals({ limit, offset: page * limit });
      if (res && typeof res === 'object' && 'rows' in res) {
        setRows((res as { rows: LearningSignalDto[] }).rows);
      }
    })();
  }, [page]);

  return (
    <div data-testid="learn-signal-log">
      <p style={{ fontSize: 12, color: '#6b7280' }}>
        Read-only. Signals never leave your device.
      </p>
      <table style={{ width: '100%', fontSize: 13 }}>
        <thead>
          <tr>
            <th align="left">When</th>
            <th align="left">Source</th>
            <th align="left">Kind</th>
            <th align="left">Payload (redacted)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-testid={`signal-row-${r.id}`}>
              <td>{r.occurredAt}</td>
              <td>{r.source}</td>
              <td>{r.kind}</td>
              <td><code style={{ fontSize: 11 }}>{JSON.stringify(r.payload)}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
          Prev
        </button>
        <button type="button" disabled={rows.length < limit} onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
