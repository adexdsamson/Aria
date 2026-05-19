import { useEffect, useMemo, useState } from 'react';
import type { ProviderAccountDto } from '../../shared/ipc-contract';
import { AccountChip } from './AccountChip';

export function ProviderStatusTray(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ProviderAccountDto[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh(): Promise<void> {
    setLoading(true);
    try {
      const res = await window.aria.providerAccountsList();
      if (!('error' in res)) setRows(res.rows);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const summary = useMemo(() => summarize(rows, loading), [loading, rows]);

  return (
    <div data-testid="provider-status-tray" style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        data-testid="provider-status-tray-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={{
          border: `1px solid ${summary.tone === 'ok' ? '#bbf7d0' : '#fde68a'}`,
          background: summary.tone === 'ok' ? '#f0fdf4' : '#fffbeb',
          color: summary.tone === 'ok' ? '#166534' : '#92400e',
          borderRadius: 999,
          padding: '4px 10px',
          fontSize: 12,
        }}
      >
        {summary.label}
      </button>
      {open && (
        <div
          data-testid="provider-status-tray-popover"
          style={{
            position: 'absolute',
            right: 0,
            zIndex: 10,
            minWidth: 280,
            marginTop: 8,
            padding: 12,
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            background: '#fff',
            boxShadow: '0 12px 28px rgba(15, 23, 42, 0.14)',
          }}
        >
          {rows.length === 0 && <p style={{ margin: 0, color: '#64748b' }}>No accounts connected.</p>}
          {rows.map((row) => (
            <div
              key={`${row.providerKey}:${row.accountId}`}
              data-testid={`provider-status-row-${row.providerKey}-${row.accountId}`}
              style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}
            >
              <AccountChip account={row} compact />
              <span style={{ flex: '1 1 auto', fontSize: 12, color: row.status === 'ok' ? '#166534' : '#92400e' }}>
                {row.status}
              </span>
              {row.status !== 'ok' && row.status !== 'degraded' && (
                <button
                  type="button"
                  data-testid={`provider-reconnect-${row.providerKey}-${row.accountId}`}
                  onClick={async () => {
                    if (row.providerKey === 'microsoft') {
                      await window.aria.microsoftConnect();
                    } else {
                      await window.aria.gmailConnect();
                    }
                    await refresh();
                  }}
                >
                  Reconnect
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function summarize(rows: ProviderAccountDto[], loading: boolean): { tone: 'ok' | 'warn'; label: string } {
  if (loading) return { tone: 'ok', label: 'Checking accounts' };
  if (rows.length === 0) return { tone: 'warn', label: 'No accounts' };
  const needsAttention = rows.filter((row) => row.status === 'needs-auth' || row.status === 'disconnected');
  if (needsAttention.length > 0) {
    return { tone: 'warn', label: `${needsAttention.length} account${needsAttention.length === 1 ? '' : 's'} need attention` };
  }
  const degraded = rows.filter((row) => row.status === 'degraded');
  if (degraded.length > 0) {
    return { tone: 'warn', label: `${degraded.length} account${degraded.length === 1 ? '' : 's'} degraded` };
  }
  return { tone: 'ok', label: 'All accounts ok' };
}
