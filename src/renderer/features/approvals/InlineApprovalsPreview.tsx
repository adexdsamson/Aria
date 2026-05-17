/**
 * Plan 03-01 Task 2 — Inline preview of top-3 pending+ready approvals.
 *
 * Rendered above existing briefing sections; deep-links to /approvals.
 * Hidden when the queue is empty so the briefing remains visually quiet.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ApprovalRowDto } from '../../../shared/ipc-contract';

/**
 * Router-independent deep link: when mounted inside a MemoryRouter (App.tsx),
 * pushing to window.history followed by a popstate dispatch updates the
 * Routes match. In renderer unit tests that render BriefingScreen without a
 * Router (Plan 02 BriefingScreen.spec), this stays a no-op rather than
 * throwing — keeping the prior test suite green.
 */
function navigateToApprovals(): void {
  try {
    window.history.pushState({}, '', '/approvals');
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch {
    /* ignore — non-browser environments */
  }
}

const PREVIEW_LIMIT = 3;
const PREVIEW_STATES = ['pending', 'ready', 'interrupted'] as const;

function isErr(v: unknown): v is { error: string } {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

export function InlineApprovalsPreview(): JSX.Element | null {
  const [rows, setRows] = useState<ApprovalRowDto[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      // window.aria may be unmocked in existing BriefingScreen unit tests
      // (Plan 02). The optional-chain + try keeps that suite green without
      // requiring every test to re-stub approvalsList.
      const fn = (window as { aria?: { approvalsList?: typeof window.aria.approvalsList } }).aria
        ?.approvalsList;
      if (!fn) {
        setLoaded(true);
        return;
      }
      const res = await fn({
        states: PREVIEW_STATES as unknown as ApprovalRowDto['state'][],
        limit: PREVIEW_LIMIT,
      });
      if (!isErr(res) && res && 'rows' in res && Array.isArray(res.rows)) {
        setRows(res.rows.slice(0, PREVIEW_LIMIT));
      }
    } catch {
      /* keep empty preview on failure */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!loaded || rows.length === 0) return null;

  return (
    <section
      data-testid="inline-approvals-preview"
      aria-label="Pending approvals"
      style={{
        border: '1px solid #d1d5db',
        background: '#fffbeb',
        padding: 12,
        borderRadius: 8,
        marginBottom: 16,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <strong style={{ fontSize: 14 }}>Approvals</strong>
        <span
          data-testid="inline-approvals-count"
          style={{
            display: 'inline-block',
            background: '#dc2626',
            color: '#fff',
            borderRadius: 999,
            padding: '0 8px',
            fontSize: 12,
            minWidth: 22,
            textAlign: 'center',
          }}
        >
          {rows.length}
        </span>
        <button
          type="button"
          data-testid="inline-approvals-deeplink"
          onClick={() => navigateToApprovals()}
          style={{
            marginLeft: 'auto',
            background: 'transparent',
            border: 'none',
            color: '#1d4ed8',
            cursor: 'pointer',
            textDecoration: 'underline',
            fontSize: 12,
          }}
        >
          Open queue →
        </button>
      </header>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {rows.map((r) => (
          <li
            key={r.id}
            data-testid={`inline-approvals-row-${r.id}`}
            style={{ fontSize: 13, padding: '4px 0', display: 'flex', gap: 8 }}
          >
            <span style={{ color: '#6b7280' }}>[{r.state}]</span>
            <span style={{ flex: '1 1 auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {r.subject ?? '(no subject)'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
