/**
 * Phase 7 Gap 10 — Confirm dialog gating destructive account disconnects.
 * Phase 9 Plan 05 — re-skin with editorial Modal primitive (D-12).
 *
 * Disconnecting any integration is irreversible AND triggers a RAG-data wipe
 * for that (provider, account) pair (see Plan 07-03 Task 8). CLAUDE.md's
 * approval-gating principle requires explicit user consent for destructive
 * actions. This dialog is the single consent surface for all provider
 * disconnects (Gmail, Calendar, Outlook, Todoist, and the generic multi-
 * account row).
 *
 * The dialog copy is intentionally explicit about the wipe consequence so
 * the user can't claim they didn't know. The confirm button uses the
 * editorial rose tint to signal destruction.
 *
 * D-12 invariant: every assertion against this dialog (role="dialog",
 * aria-modal, the disconnect-confirm-{kind} testid, the cancel/ok testids,
 * and the wipe-copy text) is preserved verbatim. Re-skin is visual only.
 */

import { useEffect } from 'react';
import { Button } from './editorial';

export interface DisconnectConfirmDialogProps {
  /** Provider display name, e.g. "Gmail", "Google Calendar", "Outlook", "Todoist". */
  provider: string;
  /** Account email or label. Optional — Todoist single-tenant has no email. */
  account?: string | null;
  /** Whether this provider indexes RAG data. Drives copy. Defaults to true. */
  wipesRagData?: boolean;
  /** Stable test id suffix, e.g. "gmail". */
  testIdSuffix: string;
  /** Async confirm — IPC call runs inside. Dialog stays open until it resolves. */
  onConfirm(): void | Promise<void>;
  onCancel(): void;
  /** Disables both buttons while the disconnect IPC is in-flight. */
  busy?: boolean;
}

export function DisconnectConfirmDialog(props: DisconnectConfirmDialogProps): JSX.Element {
  const { provider, account, wipesRagData = true, testIdSuffix, onConfirm, onCancel, busy } = props;

  // Escape closes the dialog (treated as Cancel). Defensive against modal-stuck
  // states during dev hot-reload.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const heading = account
    ? `Disconnect ${provider} (${account})?`
    : `Disconnect ${provider}?`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid={`disconnect-confirm-${testIdSuffix}`}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(26,26,26,0.45)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
        zIndex: 9999,
        fontFamily: 'var(--f-body)',
      }}
    >
      <div
        style={{
          background: 'var(--paper)',
          border: '1px solid var(--rule-strong)',
          borderTop: '2px solid var(--rose)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 30px 80px rgba(26,26,26,0.22)',
          width: 'min(480px, 92vw)',
          overflow: 'hidden',
          color: 'var(--ink)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: '14px 22px',
            background: 'var(--ivory-deep)',
            borderBottom: '1px solid var(--rule)',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'var(--rose)',
              marginBottom: 4,
            }}
          >
            Destructive action
          </div>
          <h3
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 20,
              fontWeight: 500,
              letterSpacing: '-0.01em',
              color: 'var(--ink)',
              lineHeight: 1.2,
              margin: 0,
            }}
          >
            {heading}
          </h3>
        </div>
        <div style={{ padding: '18px 22px' }}>
          {wipesRagData ? (
            <p style={{ margin: 0, marginBottom: 12, fontFamily: 'var(--f-body)', fontSize: 14, lineHeight: 1.55, color: 'var(--ink)' }}>
              All search-index data from this account will be permanently removed.
              Aria will stop syncing from {provider} and you&apos;ll need to reconnect to
              resume. This cannot be undone.
            </p>
          ) : (
            <p style={{ margin: 0, marginBottom: 12, fontFamily: 'var(--f-body)', fontSize: 14, lineHeight: 1.55, color: 'var(--ink)' }}>
              Aria will stop syncing from {provider} and you&apos;ll need to reconnect to
              resume. This cannot be undone.
            </p>
          )}
        </div>
        <div
          style={{
            padding: '12px 22px 16px',
            borderTop: '1px solid var(--rule)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
          }}
        >
          <Button
            variant="ghost"
            data-testid={`disconnect-confirm-cancel-${testIdSuffix}`}
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            data-testid={`disconnect-confirm-ok-${testIdSuffix}`}
            onClick={() => void onConfirm()}
            disabled={busy}
            style={{ background: 'var(--rose)', borderColor: 'var(--rose)', color: '#fff' }}
          >
            {wipesRagData ? 'Disconnect and wipe data' : 'Disconnect'}
          </Button>
        </div>
      </div>
    </div>
  );
}
