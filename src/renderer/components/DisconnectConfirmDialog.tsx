/**
 * Phase 7 Gap 10 — Confirm dialog gating destructive account disconnects.
 *
 * Disconnecting any integration is irreversible AND triggers a RAG-data wipe
 * for that (provider, account) pair (see Plan 07-03 Task 8). CLAUDE.md's
 * approval-gating principle requires explicit user consent for destructive
 * actions. This dialog is the single consent surface for all provider
 * disconnects (Gmail, Calendar, Outlook, Todoist, and the generic multi-
 * account row).
 *
 * The dialog copy is intentionally explicit about the wipe consequence so
 * the user can't claim they didn't know. The confirm button uses destructive
 * styling (red).
 */

import { useEffect } from 'react';

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
        background: 'rgba(15,23,42,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      <div
        style={{
          background: 'var(--aria-bg, #fff)',
          padding: 20,
          borderRadius: 8,
          width: 'min(480px, 90vw)',
        }}
      >
        <h3 style={{ marginTop: 0 }}>{heading}</h3>
        {wipesRagData ? (
          <p style={{ margin: '0 0 12px 0' }}>
            All search-index data from this account will be permanently removed.
            Aria will stop syncing from {provider} and you'll need to reconnect to
            resume. This cannot be undone.
          </p>
        ) : (
          <p style={{ margin: '0 0 12px 0' }}>
            Aria will stop syncing from {provider} and you'll need to reconnect to
            resume. This cannot be undone.
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            data-testid={`disconnect-confirm-cancel-${testIdSuffix}`}
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid={`disconnect-confirm-ok-${testIdSuffix}`}
            onClick={() => void onConfirm()}
            disabled={busy}
            style={{ background: '#dc2626', color: '#fff' }}
          >
            {wipesRagData ? 'Disconnect and wipe data' : 'Disconnect'}
          </button>
        </div>
      </div>
    </div>
  );
}
