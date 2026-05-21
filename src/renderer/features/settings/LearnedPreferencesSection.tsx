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
import { useCallback, useEffect, useState } from 'react';
import { DisconnectConfirmDialog } from '../../components/DisconnectConfirmDialog';
import type { LearnedPreferencesDto, LearningSignalDto } from '../../../shared/ipc-contract';
import { SkeletonRoot, SkeletonLine } from '../../components/Skeleton';

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
      <section
        data-testid="settings-learned-preferences"
        style={{ padding: '32px 40px', maxWidth: '52rem' }}
      >
        <SkeletonRoot style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <SkeletonLine width={140} height={10} style={{ marginBottom: 12 }} />
          <SkeletonLine width="55%" height={30} style={{ marginBottom: 18, borderRadius: 5 }} />
          <SkeletonLine width="70%" height={13} style={{ marginBottom: 32 }} />
          {FIELDS.map((f, i) => (
            <div
              key={f.path}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 14,
                alignItems: 'center',
                padding: '16px 8px',
                borderTop: '1px solid var(--rule)',
                borderBottom: i === FIELDS.length - 1 ? '1px solid var(--rule)' : 'none',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <SkeletonLine width={`${40 + (i % 3) * 12}%`} height={13} />
                <SkeletonLine width={`${25 + (i % 2) * 15}%`} height={10} />
              </div>
              <SkeletonLine width={44} height={24} style={{ borderRadius: 4 }} />
            </div>
          ))}
        </SkeletonRoot>
      </section>
    );
  }

  return (
    <section
      data-testid="settings-learned-preferences"
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
        SETTINGS · LEARNING
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
        What Aria has learned
      </h2>
      <p
        style={{
          fontFamily: 'var(--f-display)',
          fontStyle: 'italic',
          fontSize: 15,
          color: 'var(--ink-soft)',
          margin: '0 0 30px 0',
          maxWidth: '54em',
          lineHeight: 1.6,
        }}
      >
        Last updated {row.lastUpdatedAt ?? 'never'} · {row.signalsCount} signals seen · nothing
        leaves this device.
      </p>

      {/* Tabs + reset-all */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 18,
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          data-testid="learn-view-toggle"
          onClick={() => setView('prefs')}
          aria-pressed={view === 'prefs'}
          style={tabPill(view === 'prefs')}
        >
          PREFERENCES
        </button>
        <button
          type="button"
          onClick={() => setView('signal-log')}
          aria-pressed={view === 'signal-log'}
          style={tabPill(view === 'signal-log')}
        >
          SIGNAL LOG
        </button>
        <span style={{ flex: 1 }} />
        {view === 'prefs' && (
          <button
            type="button"
            data-testid="learn-reset-all"
            onClick={() => setResetAllConfirm(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'var(--f-mono)',
              fontSize: 11,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--gray)',
              transition: 'color 180ms ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--rose)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--gray)')}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
            </svg>
            Reset all
          </button>
        )}
      </div>

      {view === 'prefs' ? (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {FIELDS.map((f, i) => {
            const v = pickValue(row.preferences, f.path);
            const formatted = JSON.stringify(v);
            const isLong = formatted.length > 60;
            return (
              <li
                key={f.path}
                data-testid={`learn-field-${f.path}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 14,
                  alignItems: 'center',
                  padding: '16px 8px',
                  borderTop: '1px solid var(--rule)',
                  borderBottom: i === FIELDS.length - 1 ? '1px solid var(--rule)' : 'none',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: 'var(--f-body)',
                      fontSize: 14,
                      fontWeight: 600,
                      color: 'var(--ink)',
                      lineHeight: 1.3,
                      marginBottom: 4,
                    }}
                  >
                    {f.label}
                  </div>
                  <code
                    style={{
                      display: isLong ? 'block' : 'inline-block',
                      fontFamily: 'var(--f-mono)',
                      fontSize: 12,
                      color: 'var(--gray)',
                      letterSpacing: '0.02em',
                      lineHeight: 1.5,
                      wordBreak: 'break-word',
                    }}
                  >
                    {formatted}
                  </code>
                </div>
                <button
                  type="button"
                  data-testid={`learn-reset-${f.path}`}
                  onClick={() => setPendingField(f.path)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: '4px 8px',
                    cursor: 'pointer',
                    fontFamily: 'var(--f-mono)',
                    fontSize: 11,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--gray)',
                    transition: 'color 180ms ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--rose)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--gray)')}
                >
                  Reset
                </button>
              </li>
            );
          })}
        </ul>
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

const TH_STYLE: React.CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'var(--ink-soft)',
  padding: '0 16px 10px 0',
  borderBottom: '1px solid var(--rule)',
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const TD_STYLE: React.CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 12,
  color: 'var(--ink)',
  padding: '12px 16px 12px 0',
  borderBottom: '1px solid var(--rule)',
  verticalAlign: 'middle',
};

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
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={TH_STYLE}>WHEN</th>
            <th style={TH_STYLE}>SOURCE</th>
            <th style={TH_STYLE}>KIND</th>
            <th style={TH_STYLE}>PAYLOAD</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-testid={`signal-row-${r.id}`}>
              <td style={{ ...TD_STYLE, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{r.occurredAt}</td>
              <td style={TD_STYLE}>{r.source}</td>
              <td style={TD_STYLE}>
                <span style={{ color: 'var(--gold)', fontWeight: 600 }}>{r.kind}</span>
              </td>
              <td style={{ ...TD_STYLE, color: 'var(--ink-soft)' }}>
                <code style={{ fontSize: 11, letterSpacing: '0.01em' }}>{JSON.stringify(r.payload)}</code>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} style={{ ...TD_STYLE, color: 'var(--ink-soft)', fontStyle: 'italic', paddingTop: 24 }}>
                No signals recorded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button
          type="button"
          disabled={page === 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          style={paginationPill(page === 0)}
        >
          ← Prev
        </button>
        <button
          type="button"
          disabled={rows.length < limit}
          onClick={() => setPage((p) => p + 1)}
          style={paginationPill(rows.length < limit)}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

function paginationPill(disabled: boolean): React.CSSProperties {
  return {
    padding: '5px 12px',
    fontFamily: 'var(--f-mono)',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: disabled ? 'var(--ink-soft)' : 'var(--ink)',
    background: 'transparent',
    border: `1px solid ${disabled ? 'var(--rule)' : 'var(--rule-strong)'}`,
    borderRadius: 'var(--radius-sm)',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    transition: 'opacity 180ms ease',
  };
}

function tabPill(active: boolean): React.CSSProperties {
  return {
    padding: '6px 14px',
    fontFamily: 'var(--f-mono)',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: active ? 'var(--paper)' : 'var(--ink-soft)',
    background: active ? 'var(--ink)' : 'var(--paper)',
    border: `1px solid ${active ? 'var(--ink)' : 'var(--rule-strong)'}`,
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    transition:
      'background 180ms ease, color 180ms ease, transform 140ms cubic-bezier(0.23, 1, 0.32, 1)',
  };
}
