/**
 * Plan 07-03 Task 8 — Disconnected-account RAG cleanup row (RESEARCH §11).
 *
 * For each provider account currently with `status='disconnected'` AND still
 * having chunks in `rag_chunk` for that (provider_key, account_id), surface:
 *   - a "RAG data: N chunks" subline
 *   - a "Wipe RAG data" button, gated on a confirmation dialog
 *
 * Connected accounts are unchanged. Disconnected-but-not-wiped accounts also
 * continue to surface in /ask citation cards with the `disconnected: true`
 * chip variant — that wiring lives in CitationList (Task 7).
 */
import { useCallback, useEffect, useState } from 'react';
import type { ProviderAccountDto } from '../../../shared/ipc-contract';

function isErr(v: unknown): v is { error: string } {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

interface ChunkCountRow {
  providerKey: string;
  accountId: string;
  count: number;
}

export function RagDisconnectedSection(): JSX.Element {
  const [counts, setCounts] = useState<ChunkCountRow[]>([]);
  const [accounts, setAccounts] = useState<ProviderAccountDto[]>([]);
  const [confirmFor, setConfirmFor] = useState<ChunkCountRow | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [countsRes, accountsRes] = await Promise.all([
      window.aria.ragAccountChunkCounts(),
      window.aria.providerAccountsList(),
    ]);
    if (!isErr(countsRes)) setCounts(countsRes.rows);
    if (!isErr(accountsRes)) setAccounts(accountsRes.rows);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const disconnectedRows = counts
    .map((row) => {
      const a = accounts.find(
        (x) => x.providerKey === row.providerKey && x.accountId === row.accountId,
      );
      return { row, account: a };
    })
    .filter((r) => r.account?.status === 'disconnected' || !r.account);

  const onWipe = useCallback(
    async (row: ChunkCountRow) => {
      setBusy(true);
      await window.aria.ragWipeAccount({
        providerKey: row.providerKey,
        accountId: row.accountId,
      });
      setBusy(false);
      setConfirmFor(null);
      await refresh();
    },
    [refresh],
  );

  if (disconnectedRows.length === 0) return <></>;

  return (
    <section
      data-testid="rag-disconnected-section"
      style={{ padding: 'var(--aria-space-lg, 16px)', borderTop: '1px solid #e5e7eb' }}
    >
      <h3 style={{ marginTop: 0 }}>Disconnected accounts — indexed data</h3>
      <p style={{ color: 'var(--aria-muted, #64748b)', fontSize: 13 }}>
        These accounts are disconnected but still have RAG-indexed content. Citations
        from this data will continue to appear marked <em>disconnected</em>.
      </p>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {disconnectedRows.map(({ row, account }) => {
          const email = account?.displayEmail ?? row.accountId;
          return (
            <li
              key={`${row.providerKey}:${row.accountId}`}
              data-testid={`rag-disc-row-${row.providerKey}-${row.accountId}`}
              style={{
                padding: 8,
                marginBottom: 6,
                border: '1px solid #e5e7eb',
                borderRadius: 6,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <strong>
                  {row.providerKey === 'microsoft' ? 'Outlook' : 'Gmail'} — {email}
                </strong>
                <div style={{ color: 'var(--aria-muted, #64748b)', fontSize: 12 }}>
                  RAG data: {row.count} chunks
                </div>
              </div>
              <button
                type="button"
                data-testid={`rag-wipe-${row.providerKey}-${row.accountId}`}
                onClick={() => setConfirmFor(row)}
                disabled={busy}
              >
                Wipe RAG data
              </button>
            </li>
          );
        })}
      </ul>
      {confirmFor && (
        <div
          data-testid="rag-wipe-confirm"
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: '#fff',
              padding: 16,
              borderRadius: 8,
              width: 'min(480px, 90vw)',
            }}
          >
            <p>
              This permanently removes {confirmFor.count} indexed items from
              disconnected account{' '}
              {accounts.find(
                (a) =>
                  a.providerKey === confirmFor.providerKey &&
                  a.accountId === confirmFor.accountId,
              )?.displayEmail ?? confirmFor.accountId}
              .
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                data-testid="rag-wipe-cancel"
                onClick={() => setConfirmFor(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="rag-wipe-confirm-button"
                onClick={() => void onWipe(confirmFor)}
                disabled={busy}
                style={{ background: '#dc2626', color: '#fff' }}
              >
                Wipe
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
