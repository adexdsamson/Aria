/**
 * RoutingLogPanel — read-only routing decisions view.
 *
 * Plan 04 Task 3 (initial): rendered "last 100" with no filters; used from
 *   Settings → Diagnostics.
 *
 * Plan 03-02 (upgrade-in-place per RESEARCH §OQ-4): adds optional filter
 *   inputs (date range, route select, source text, category multi-select)
 *   above the existing table. When `showFilters` is false the panel renders
 *   the legacy "last 100" view (Settings → Diagnostics keeps its original
 *   shape). When true, the panel calls `routingLogQuery` instead of
 *   `diagnosticsRoutingLog` and renders the filter row.
 */
import { useEffect, useMemo, useState } from 'react';
import type {
  RoutingLogClassifiedRow,
  RoutingLogEntry,
  IpcError,
  Route,
} from '../../../shared/ipc-contract';

export interface RoutingLogPanelProps {
  /** Bumping this triggers a re-fetch (parent passes a counter). */
  refreshKey?: number;
  /** Render filter inputs + use routingLogQuery instead of legacy lastN. */
  showFilters?: boolean;
}

const ALL_CATEGORIES: Array<string> = ['financial', 'legal', 'hr', 'pii', 'urgent'];

type AnyRow = RoutingLogEntry | RoutingLogClassifiedRow;

export function RoutingLogPanel({
  refreshKey = 0,
  showFilters = false,
}: RoutingLogPanelProps): JSX.Element {
  const [entries, setEntries] = useState<AnyRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Filter state (only used when showFilters=true).
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [route, setRoute] = useState<'' | Route>('');
  const [source, setSource] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const [filterTick, setFilterTick] = useState<number>(0);

  const fetchKey = useMemo(
    () => `${refreshKey}|${filterTick}|${showFilters ? 'q' : 'last'}`,
    [refreshKey, filterTick, showFilters],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (showFilters) {
          const res = (await window.aria.routingLogQuery({
            from: from || undefined,
            to: to || undefined,
            route: (route || undefined) as Route | undefined,
            source: source || undefined,
            category: category || undefined,
            limit: 200,
          })) as { rows: RoutingLogClassifiedRow[] } | IpcError;
          if (cancelled) return;
          if ('rows' in res) {
            setEntries(res.rows);
            setError(null);
          } else {
            setError(res.error);
          }
        } else {
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
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchKey, from, to, route, source, category, showFilters]);

  return (
    <section data-testid="routing-log-panel">
      <h3 style={{ fontFamily: 'var(--f-display)', fontSize: 22, fontWeight: 500, color: 'var(--ink)', marginTop: 0, borderBottom: '1px solid var(--rule)', paddingBottom: 8 }}>
        {showFilters ? 'Routing log' : 'Routing log (last 100)'}
      </h3>

      {showFilters && (
        <div
          data-testid="routing-log-filters"
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            alignItems: 'center',
            marginBottom: 12,
            fontSize: 'var(--aria-type-sm)',
          }}
        >
          <label>
            From{' '}
            <input
              type="datetime-local"
              data-testid="routing-log-filter-from"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            To{' '}
            <input
              type="datetime-local"
              data-testid="routing-log-filter-to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label>
            Route{' '}
            <select
              data-testid="routing-log-filter-route"
              value={route}
              onChange={(e) => setRoute(e.target.value as '' | Route)}
            >
              <option value="">any</option>
              <option value="LOCAL">LOCAL</option>
              <option value="FRONTIER">FRONTIER</option>
            </select>
          </label>
          <label>
            Source{' '}
            <input
              type="text"
              data-testid="routing-log-filter-source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="generic / user-email / ..."
            />
          </label>
          <label>
            Category{' '}
            <select
              data-testid="routing-log-filter-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">any</option>
              {ALL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            data-testid="routing-log-filter-apply"
            onClick={() => setFilterTick((t) => t + 1)}
          >
            Apply
          </button>
        </div>
      )}

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
          <thead className="routing-log-thead">
            <tr>
              <th>ts</th>
              <th>route</th>
              <th>source</th>
              <th>reason</th>
              <th>model</th>
              <th>latency_ms</th>
              <th>ok</th>
              {showFilters && <th>severity</th>}
              {showFilters && <th>categories</th>}
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const ext = e as Partial<RoutingLogClassifiedRow>;
              return (
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
                  {showFilters && <td style={td()}>{ext.severity ?? ''}</td>}
                  {showFilters && <td style={td()}>{ext.categories_json ?? ''}</td>}
                </tr>
              );
            })}
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
