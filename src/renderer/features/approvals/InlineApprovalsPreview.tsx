/**
 * Plan 03-01 Task 2 — Inline preview of top-3 pending+ready approvals.
 *
 * Rendered above existing briefing sections; deep-links to /approvals.
 * Hidden when the queue is empty so the briefing remains visually quiet.
 *
 * Phase 9 Plan 03 — RE-SKINNED. Gold-tinted banner card with Playfair
 * header, mono state pills, and an editorial "Open queue →" trigger.
 * data-testid + behaviour preserved.
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
        border: '1px solid rgba(184,134,11,0.30)',
        background: 'rgba(184,134,11,0.05)',
        padding: '14px 18px',
        borderRadius: 8,
        marginBottom: 28,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 10,
        }}
      >
        <strong
          style={{
            fontFamily: 'var(--f-display)',
            fontWeight: 500,
            fontSize: 17,
            color: 'var(--ink)',
          }}
        >
          Approvals
        </strong>
        <span
          data-testid="inline-approvals-count"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 22,
            height: 18,
            borderRadius: 999,
            padding: '0 6px',
            background: 'var(--rose)',
            color: '#fff',
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            fontWeight: 600,
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
            cursor: 'pointer',
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--gold-deep)',
            padding: 0,
          }}
        >
          Open queue →
        </button>
      </header>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map((r) => (
          <li
            key={r.id}
            data-testid={`inline-approvals-row-${r.id}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 13,
              color: 'var(--ink-soft)',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 9.5,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                padding: '1px 6px',
                borderRadius: 3,
                background: 'var(--ivory)',
                color: 'var(--gray)',
                border: '1px solid var(--rule)',
                minWidth: 56,
                textAlign: 'center',
              }}
            >
              {r.state}
            </span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.subject ?? '(no subject)'}
            </span>
            <span
              aria-hidden="true"
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 10,
                letterSpacing: '0.08em',
                color: 'var(--gray-soft)',
                whiteSpace: 'nowrap',
                marginLeft: 'auto',
              }}
            >
              {r.kind.replace('_', ' ')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
