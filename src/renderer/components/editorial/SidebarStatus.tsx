/**
 * Phase 9 Plan 02 — editorial sidebar footer status block.
 *
 * Mirrors design-ref/project/app-shell.jsx lines 210-228 visually but binds to
 * real provider state via providerAccountsList (same IPC as ProviderStatusTray).
 *
 * 4 rows: Ollama, Frontier, Gmail, Calendar — each is a StatusDot + mono
 * uppercase 56px-wide label + mono value text. No header, no actions — it is
 * a passive footer affordance. Live providers update via the same poll cadence
 * users see in StatusPanel.
 *
 * Not in components/editorial/index.ts because it's data-bound (the index is
 * reserved for pure leaf primitives that never import from features/* / IPC).
 */
import { useEffect, useState } from 'react';
import type { ProviderId, ProviderAccountDto } from '../../../shared/ipc-contract';
import { FRONTIER_LABELS, DEFAULT_FRONTIER_PROVIDER } from '../../../shared/frontier-labels';
import { useFrontierProvider } from '../../lib/useFrontierProvider';
import { StatusDot } from './StatusDot';
import type { StatusDotKind } from './StatusDot';

interface Row {
  label: string;
  value: string;
  kind: StatusDotKind;
}

function rowsFor(rows: ProviderAccountDto[], loading: boolean, provider: ProviderId | null): Row[] {
  const ollama: Row = { label: 'Ollama', value: loading ? 'checking…' : 'localhost · ready', kind: 'ok' };
  const lbl = FRONTIER_LABELS[provider ?? DEFAULT_FRONTIER_PROVIDER];
  const frontier: Row = {
    label: 'Frontier',
    value: provider ? `${lbl.vendor} · configured` : 'not configured',
    kind: provider ? 'ok' : 'idle',
  };

  const gmailAccounts = rows.filter((r) => r.providerKey === 'google');
  const calAccounts = rows.filter(
    (r) => r.providerKey === 'google' || r.providerKey === 'microsoft',
  );

  function summarize(accs: ProviderAccountDto[], idleLabel: string): Row {
    if (loading) return { label: '', value: 'checking…', kind: 'idle' };
    if (accs.length === 0) return { label: '', value: 'not connected', kind: 'idle' };
    const needs = accs.filter((r) => r.status === 'needs-auth' || r.status === 'disconnected');
    if (needs.length > 0) {
      return {
        label: '',
        value: `${needs.length} need${needs.length === 1 ? 's' : ''} auth`,
        kind: 'err',
      };
    }
    const degraded = accs.filter((r) => r.status === 'degraded');
    if (degraded.length > 0) {
      return { label: '', value: `${degraded.length} degraded`, kind: 'warn' };
    }
    return {
      label: '',
      value: `${accs.length} ${idleLabel}`,
      kind: 'ok',
    };
  }

  const gmail = summarize(gmailAccounts, gmailAccounts.length === 1 ? 'account · live' : 'accounts · live');
  gmail.label = 'Gmail';
  const cal = summarize(calAccounts, calAccounts.length === 1 ? 'account · live' : 'accounts · live');
  cal.label = 'Calendar';

  return [ollama, frontier, gmail, cal];
}

export function SidebarStatus(): JSX.Element {
  const [rows, setRows] = useState<ProviderAccountDto[]>([]);
  const [loading, setLoading] = useState(true);
  const provider = useFrontierProvider();

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const res = await window.aria.providerAccountsList();
        if (cancelled) return;
        if (!('error' in res)) setRows(res.rows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = rowsFor(rows, loading, provider);

  return (
    <div
      data-testid="sidebar-status"
      style={{ display: 'flex', flexDirection: 'column', gap: 5 }}
    >
      {summary.map((r) => (
        <div
          key={r.label}
          data-testid={`sidebar-status-${r.label.toLowerCase()}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 11,
            color: 'var(--gray)',
          }}
        >
          <StatusDot kind={r.kind} />
          <span
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 9.5,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--gray-soft)',
              width: 56,
            }}
          >
            {r.label}
          </span>
          <span
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              color: 'var(--gray)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}
          >
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}
