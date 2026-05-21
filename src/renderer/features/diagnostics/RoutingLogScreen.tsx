/**
 * RoutingLogScreen — full-page editorial routing log per design-ref
 * `app-screen-diagnostics.jsx`.
 *
 * Topbar owns "DIAGNOSTICS / Routing log" eyebrow+title; screen renders:
 *   - H1 "Routing log" + italic subtitle right-aligned
 *   - 4 KPI cards (Calls last 24h / Routed local + % / Routed frontier + % /
 *     Tokens out)
 *   - 3 chip-row filters (Route / Source / Sensitivity)
 *   - Editorial table with mono headers + moss/gold route pills
 *   - Footer caption explaining cache + purge
 *
 * IPC contract preserved — uses `routingLogQuery` (showFilters path) per the
 * existing RoutingLogPanel pattern. Tests for RoutingLogPanel keep working
 * because that file is untouched; this screen no longer mounts it.
 */
import { useEffect, useMemo, useState } from 'react';
import type {
  IpcError,
  Route as RouteType,
  RoutingLogClassifiedRow,
} from '../../../shared/ipc-contract';

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

const ROUTE_OPTIONS: { value: '' | RouteType; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'LOCAL', label: 'Local' },
  { value: 'FRONTIER', label: 'Frontier' },
];

const SOURCE_OPTIONS = ['', 'briefing', 'email.triage', 'drafting', 'rag.ask', 'transcript', 'scheduling'];
const SENSITIVITY_OPTIONS = ['', 'low', 'normal', 'financial', 'legal', 'hr', 'unknown'];

function formatTs(ts: string): string {
  try {
    const d = new Date(ts);
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
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

export function RoutingLogScreen(): JSX.Element {
  const [rows, setRows] = useState<RoutingLogClassifiedRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<'' | RouteType>('');
  const [source, setSource] = useState<string>('');
  const [sensitivity, setSensitivity] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = (await window.aria.routingLogQuery({
          route: (route || undefined) as RouteType | undefined,
          source: source || undefined,
          category: sensitivity || undefined,
          limit: 200,
        })) as { rows: RoutingLogClassifiedRow[] } | IpcError;
        if (cancelled) return;
        if ('rows' in res) {
          setRows(res.rows);
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
  }, [route, source, sensitivity]);

  // KPI stats — computed over the rows we have (server returns up to 200).
  const stats = useMemo(() => {
    const recent = rows.filter((r) => within24h(r.ts));
    const local = recent.filter((r) => r.route === 'LOCAL').length;
    const frontier = recent.filter((r) => r.route === 'FRONTIER').length;
    const total = recent.length;
    const tokens = recent.reduce((sum, r) => {
      const t = (r as unknown as { tokens_out?: number }).tokens_out;
      return sum + (typeof t === 'number' ? t : 0);
    }, 0);
    return {
      total,
      local,
      frontier,
      localPct: total > 0 ? Math.round((local / total) * 100) : 0,
      frontierPct: total > 0 ? Math.round((frontier / total) * 100) : 0,
      tokens,
    };
  }, [rows]);

  return (
    <main
      data-testid="routing-log-screen"
      style={{
        padding: '32px 40px 80px',
        maxWidth: 'var(--container, 1120px)',
        margin: '0 auto',
        background: 'var(--ivory)',
        color: 'var(--ink)',
        minHeight: '100%',
      }}
    >
      {/* Heading row — h1 left, italic subtitle right */}
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 24,
          marginBottom: 32,
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
          Routing log
        </h1>
        <span
          style={{
            fontFamily: 'var(--f-display)',
            fontStyle: 'italic',
            color: 'var(--gray)',
            fontSize: 14,
            maxWidth: '32em',
          }}
        >
          Every LLM call Aria has made, with the verbatim reason.
        </span>
      </header>

      {/* KPI cards strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 14,
          marginBottom: 36,
        }}
      >
        <KpiCard label="Calls (last 24h)" value={String(stats.total)} />
        <KpiCard
          label="Routed local"
          value={String(stats.local)}
          sub={stats.total > 0 ? `${stats.localPct}% of calls` : undefined}
          accent="moss"
        />
        <KpiCard
          label="Routed frontier"
          value={String(stats.frontier)}
          sub={stats.total > 0 ? `${stats.frontierPct}% of calls` : undefined}
          accent="gold"
        />
        <KpiCard
          label="Tokens out"
          value={stats.tokens > 0 ? stats.tokens.toLocaleString() : '—'}
          sub={stats.tokens > 0 ? `${stats.tokens.toLocaleString()} in 24h` : undefined}
        />
      </div>

      {/* Filter chips — three rows */}
      <ChipRow
        label="Route"
        options={ROUTE_OPTIONS}
        value={route}
        onChange={setRoute as (v: string) => void}
      />
      <ChipRow
        label="Source"
        options={SOURCE_OPTIONS.map((s) => ({ value: s, label: s || 'All' }))}
        value={source}
        onChange={setSource}
      />
      <ChipRow
        label="Sensitivity"
        options={SENSITIVITY_OPTIONS.map((s) => ({ value: s, label: s || 'All' }))}
        value={sensitivity}
        onChange={setSensitivity}
      />

      {error && (
        <p
          role="alert"
          style={{
            color: 'var(--rose)',
            fontFamily: 'var(--f-mono)',
            fontSize: 12,
            letterSpacing: '0.08em',
            margin: '16px 0',
            padding: '8px 12px',
            background: 'rgba(184,73,58,0.06)',
            borderLeft: '2px solid var(--rose)',
            borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
          }}
        >
          {error}
        </p>
      )}

      {/* Table */}
      <div
        data-testid="routing-log-panel"
        style={{
          marginTop: 28,
          background: 'var(--paper)',
          border: '1px solid var(--rule)',
          borderRadius: 'var(--radius)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '140px 110px minmax(0, 1.4fr) 120px 90px minmax(0, 2fr)',
            gap: 0,
            padding: '12px 16px',
            background: 'var(--ivory)',
            borderBottom: '1px solid var(--rule)',
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--gray)',
          }}
        >
          <span>Timestamp</span>
          <span>Route</span>
          <span>Source · model</span>
          <span>Sensitivity</span>
          <span style={{ textAlign: 'right' }}>Tokens</span>
          <span>Reason</span>
        </div>

        {rows.length === 0 && !error && (
          <p
            style={{
              margin: 0,
              padding: '32px 16px',
              textAlign: 'center',
              fontFamily: 'var(--f-display)',
              fontStyle: 'italic',
              color: 'var(--gray)',
            }}
          >
            No routing decisions match these filters.
          </p>
        )}

        {rows.map((r) => {
          const sev = (r as unknown as { severity?: string }).severity ?? '';
          const tokensOut = (r as unknown as { tokens_out?: number }).tokens_out;
          return (
            <div
              key={r.id}
              data-testid={`routing-log-row-${r.id}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '140px 110px minmax(0, 1.4fr) 120px 90px minmax(0, 2fr)',
                gap: 0,
                padding: '14px 16px',
                borderBottom: '1px solid var(--rule)',
                alignItems: 'baseline',
                fontFamily: 'var(--f-mono)',
                fontSize: 12,
                color: 'var(--ink-soft)',
                transition: 'background 160ms ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(184,134,11,0.025)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ color: 'var(--gray)' }}>{formatTs(r.ts)}</span>
              <span>
                <RoutePill route={r.route} />
              </span>
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  paddingRight: 8,
                }}
              >
                {r.source}
                {r.model ? <span style={{ color: 'var(--gray-soft)' }}> · {r.model}</span> : null}
              </span>
              <span style={{ color: 'var(--gray)' }}>{sev || '—'}</span>
              <span style={{ textAlign: 'right', color: 'var(--gray)' }}>
                {tokensOut != null ? tokensOut.toLocaleString() : '—'}
              </span>
              <span
                style={{
                  color: 'var(--ink)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={r.reason}
              >
                <span style={{ color: 'var(--gold)' }}>/</span>{' '}
                <span style={{ fontStyle: 'italic' }}>{r.reason}</span>
              </span>
            </div>
          );
        })}
      </div>

      <p
        style={{
          marginTop: 18,
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--gray-soft)',
        }}
      >
        Click a row to expand · Last 200 calls cached locally · Older logs purged after 30 days
      </p>
    </main>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'moss' | 'gold';
}): JSX.Element {
  const accentColor =
    accent === 'moss' ? 'var(--moss)' : accent === 'gold' ? 'var(--gold-deep)' : 'var(--ink)';
  return (
    <div
      style={{
        padding: '16px 18px',
        background: 'var(--paper)',
        border: '1px solid var(--rule)',
        borderRadius: 'var(--radius)',
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
          marginBottom: 10,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 30,
          fontWeight: 500,
          lineHeight: 1,
          color: accentColor,
          letterSpacing: '-0.02em',
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            marginTop: 8,
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--gray-soft)',
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function ChipRow<V extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        marginBottom: 12,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--gray)',
          marginRight: 8,
          minWidth: 90,
        }}
      >
        {label}
      </span>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value) || '__all__'}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            style={{
              padding: '5px 12px',
              fontFamily: active ? 'var(--f-body)' : 'var(--f-mono)',
              fontSize: active ? 12.5 : 11,
              fontWeight: active ? 600 : 500,
              letterSpacing: active ? '0.01em' : '0.04em',
              color: active ? 'var(--paper)' : 'var(--ink-soft)',
              background: active ? 'var(--ink)' : 'var(--paper)',
              border: `1px solid ${active ? 'var(--ink)' : 'var(--rule-strong)'}`,
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              transition: `background 180ms ease, color 180ms ease, transform 140ms ${EASE_OUT}`,
            }}
            onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
            onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function RoutePill({ route }: { route: string }): JSX.Element {
  const isLocal = route === 'LOCAL';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 8px',
        borderRadius: 999,
        fontFamily: 'var(--f-mono)',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: isLocal ? 'var(--moss)' : 'var(--gold-deep)',
        background: isLocal ? 'rgba(91,110,58,0.08)' : 'rgba(184,134,11,0.08)',
        border: `1px solid ${isLocal ? 'rgba(91,110,58,0.30)' : 'rgba(184,134,11,0.30)'}`,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 5,
          height: 5,
          borderRadius: 50,
          background: isLocal ? 'var(--moss)' : 'var(--gold)',
        }}
      />
      {route}
    </span>
  );
}
