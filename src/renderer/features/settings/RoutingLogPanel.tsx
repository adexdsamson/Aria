/**
 * RoutingLogPanel — read-only last-N routing decisions (Plan 04 Task 3).
 *
 * On mount and on every `refreshKey` change, calls
 * `window.aria.diagnosticsRoutingLog({ limit: 100 })` and renders a 7-column
 * table (ts, route, source, reason, model, latency_ms, ok).
 */
import { useEffect, useState } from 'react';
import type { RoutingLogEntry, IpcError } from '../../../shared/ipc-contract';

export interface RoutingLogPanelProps {
  /** Bumping this triggers a re-fetch (parent passes a counter). */
  refreshKey?: number;
}

export function RoutingLogPanel({ refreshKey = 0 }: RoutingLogPanelProps): JSX.Element {
  const [entries, setEntries] = useState<RoutingLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = (await window.aria.diagnosticsRoutingLog({ limit: 100 })) as
          | RoutingLogEntry[]
          | IpcError;
        if (cancelled) return;
        if (Array.isArray(res)) {
          setEntries(res);
          setError(null);
        } else {
          setError(res.error);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return (
    <section data-testid="routing-log-panel">
      <h3 style={{ fontSize: 'var(--aria-type-lg)', marginTop: 0 }}>
        Routing log (last 100)
      </h3>
      {error && (
        <p role="alert" style={{ color: 'var(--aria-danger)' }}>
          Error: {error}
        </p>
      )}
      {!error && entries.length === 0 && (
        <p style={{ color: 'var(--aria-fg-muted)' }}>No routing decisions yet.</p>
      )}
      {entries.length > 0 && (
        <table
          data-testid="routing-log-table"
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 'var(--aria-type-sm)',
          }}
        >
          <colgroup>
            <col />
            <col />
            <col />
            <col />
            <col />
            <col />
            <col />
          </colgroup>
          <thead className="routing-log-thead">
            <tr>
              <th>ts</th>
              <th>route</th>
              <th>source</th>
              <th>reason</th>
              <th>model</th>
              <th>latency_ms</th>
              <th>ok</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} data-testid={`routing-log-row-${e.id}`}>
                <td style={td()}>{e.ts}</td>
                <td style={td()}>
                  <strong>{e.route}</strong>
                </td>
                <td style={td()}>{e.source}</td>
                <td style={td()}>
                  <code>{e.reason}</code>
                </td>
                <td style={td()}>{e.model}</td>
                <td style={td()}>{e.latency_ms}</td>
                <td style={td()}>{e.ok}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function td(): React.CSSProperties {
  return {
    padding: '6px 8px',
    borderBottom: '1px solid var(--aria-border)',
    verticalAlign: 'top',
  };
}
