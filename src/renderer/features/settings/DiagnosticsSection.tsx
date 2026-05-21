/**
 * DiagnosticsSection — Settings → Diagnostics.
 *
 * Phase 9 design-ref `app-screen-diagnostics.jsx` parity pass:
 *   - "SETTING · VIII" gold mono caps eyebrow + H1 "Diagnostics"
 *   - Playfair italic body explainer
 *   - "ASK ARIA · DIAGNOSTICS" eyebrow over the AskAriaBox card
 *   - Italic caption disclosing Phase 1 vs Phase 7 RAG-backed Ask Aria
 *   - "ROUTING LOG · TODAY" eyebrow over an editorial row-list (bypasses
 *     the legacy <RoutingLogPanel /> bare-table so the in-settings view
 *     now matches the design-ref pattern; the full-page /routing-log
 *     screen has its own editorial implementation. Two consumers, two
 *     presentations, one IPC.)
 *
 * IPC + AskAriaBox refresh contract preserved verbatim.
 */
import { useEffect, useState } from 'react';
import type { IpcError, RoutingLogEntry } from '../../../shared/ipc-contract';
import { AskAriaBox } from './AskAriaBox';

function formatHmm(ts: string): string {
  try {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return ts;
  }
}

function within24h(ts: string): boolean {
  try {
    return Date.now() - new Date(ts).getTime() < 86_400_000;
  } catch {
    return false;
  }
}

export function DiagnosticsSection(): JSX.Element {
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [entries, setEntries] = useState<RoutingLogEntry[]>([]);
  const [logError, setLogError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = (await window.aria.diagnosticsRoutingLog({ limit: 100 })) as
          | RoutingLogEntry[]
          | IpcError;
        if (cancelled) return;
        if (Array.isArray(res)) {
          setEntries(res);
          setLogError(null);
        } else {
          setLogError(res.error);
        }
      } catch (e) {
        if (!cancelled) setLogError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const todayEntries = entries.filter((e) => within24h(e.ts));

  return (
    <section
      data-testid="settings-diagnostics"
      style={{
        padding: '32px 40px 80px',
        maxWidth: '64rem',
        margin: '0 auto',
        background: 'var(--paper)',
        color: 'var(--ink)',
        minHeight: '100%',
      }}
    >
      {/* Eyebrow + heading + body */}
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
        Setting · VIII
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
        Diagnostics
      </h2>
      <p
        style={{
          fontFamily: 'var(--f-display)',
          fontStyle: 'italic',
          fontSize: 15,
          color: 'var(--ink-soft)',
          margin: '0 0 32px 0',
          maxWidth: '52em',
          lineHeight: 1.6,
        }}
      >
        A live look at the LLM router. Ask Aria anything — the answer comes back with the route
        taken (LOCAL or FRONTIER) and the reason. Use it to verify that sensitive content actually
        stays on device.
      </p>

      {/* Ask Aria card */}
      <div
        style={{
          marginBottom: 18,
          padding: '20px 24px',
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
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'var(--gold)',
            marginBottom: 14,
          }}
        >
          Ask Aria · Diagnostics
        </div>
        <AskAriaBox onAnswered={() => setRefreshKey((k) => k + 1)} />
      </div>
      <p
        style={{
          fontFamily: 'var(--f-display)',
          fontStyle: 'italic',
          fontSize: 13,
          color: 'var(--gray)',
          margin: '0 0 40px 0',
        }}
      >
        This is the hello-Aria diagnostic from Phase 1. The full RAG-backed Ask Aria ships in
        Phase 7.
      </p>

      {/* Routing log */}
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--gray)',
          marginBottom: 12,
        }}
      >
        Routing log · Today
      </div>

      {logError && (
        <p
          role="alert"
          style={{
            color: 'var(--rose)',
            fontFamily: 'var(--f-mono)',
            fontSize: 12,
            margin: '0 0 12px 0',
            padding: '8px 12px',
            background: 'rgba(184,73,58,0.06)',
            borderLeft: '2px solid var(--rose)',
            borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
          }}
        >
          {logError}
        </p>
      )}

      {todayEntries.length === 0 && !logError && (
        <p
          style={{
            margin: '24px 0',
            fontFamily: 'var(--f-display)',
            fontStyle: 'italic',
            color: 'var(--gray)',
          }}
        >
          No routing decisions yet today.
        </p>
      )}

      {todayEntries.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {todayEntries.slice(0, 20).map((e, i) => (
            <li
              key={e.id}
              data-testid={`diagnostics-routing-row-${e.id}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '60px 1fr auto auto',
                gap: 16,
                alignItems: 'baseline',
                padding: '14px 0',
                borderTop: '1px solid var(--rule)',
                borderBottom: i === todayEntries.slice(0, 20).length - 1 ? '1px solid var(--rule)' : 'none',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 11,
                  color: 'var(--gray)',
                  letterSpacing: '0.04em',
                }}
              >
                {formatHmm(e.ts)}
              </span>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: 'var(--f-display)',
                    fontSize: 14.5,
                    fontWeight: 500,
                    color: 'var(--ink)',
                    lineHeight: 1.35,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={e.source}
                >
                  {e.source}
                </div>
                <div
                  style={{
                    marginTop: 2,
                    fontFamily: 'var(--f-mono)',
                    fontSize: 11,
                    color: 'var(--gray)',
                    fontStyle: 'italic',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={e.reason}
                >
                  {e.reason}
                </div>
              </div>
              <span
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 11,
                  color: 'var(--gray)',
                  whiteSpace: 'nowrap',
                }}
              >
                {e.model}
              </span>
              <RoutePill route={e.route} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RoutePill({ route }: { route: string }): JSX.Element {
  const isLocal = route === 'LOCAL';
  return (
    <span
      data-testid={`route-pill-${route}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 8px',
        borderRadius: 'var(--radius-sm)',
        fontFamily: 'var(--f-mono)',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: isLocal ? 'var(--moss)' : 'var(--gold-deep)',
        background: isLocal ? 'rgba(91,110,58,0.08)' : 'rgba(184,134,11,0.08)',
        border: `1px solid ${isLocal ? 'rgba(91,110,58,0.30)' : 'rgba(184,134,11,0.30)'}`,
        whiteSpace: 'nowrap',
      }}
    >
      [{route}]
    </span>
  );
}
