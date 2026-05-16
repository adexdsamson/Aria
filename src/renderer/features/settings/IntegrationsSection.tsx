/**
 * Plan 02-01 Task 3 — Settings → Integrations.
 *
 * Renders one row per third-party integration. Phase 2 only ships Gmail; Plan
 * 02-02 will add Calendar to this same component.
 *
 * Gmail row states:
 *   - disconnected:        "Connect Gmail" button
 *   - connected (ok):      email + "Sync now" + "Disconnect"
 *   - connected (expired): EMAIL-07 banner (locked copy) + "Reconnect"
 *   - connected (revoked): EMAIL-07 banner (revoked variant) + "Reconnect"
 *
 * Pre-OAuth disclosure modal renders before the BrowserWindow opens (CASA
 * unverified-app UX), with the exact copy locked in 02-RESEARCH.md §"CASA /
 * Unverified-App UX".
 */
import { useCallback, useEffect, useState } from 'react';
import type { GmailIntegrationStatus, IpcError } from '../../../shared/ipc-contract';

const POLL_MS = 10_000;

export const EMAIL_07_EXPIRED_COPY =
  "Aria's access to Gmail has expired. Re-connect to resume syncing. Calendar and other integrations are unaffected.";
export const EMAIL_07_REVOKED_COPY =
  "Aria's access to Gmail was revoked. Re-connect to resume syncing. Calendar and other integrations are unaffected.";
export const PRE_OAUTH_DISCLOSURE =
  "Google will show a warning that Aria hasn't been verified. This is expected while Aria is in private testing — your data stays on your machine. Continue?";

function isErr(v: unknown): v is IpcError {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

interface IntegrationsSectionProps {
  /** Hook for tests to start with the pre-OAuth modal already open. */
  initialModalOpen?: boolean;
}

export function IntegrationsSection({ initialModalOpen }: IntegrationsSectionProps = {}): JSX.Element {
  const [status, setStatus] = useState<GmailIntegrationStatus | null>(null);
  const [modalOpen, setModalOpen] = useState<boolean>(initialModalOpen ?? false);
  const [busy, setBusy] = useState<boolean>(false);

  const refresh = useCallback(async () => {
    const next = await window.aria.gmailStatus();
    if (!isErr(next)) setStatus(next);
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const onConnectClick = useCallback(() => {
    setModalOpen(true);
  }, []);

  const onModalContinue = useCallback(async () => {
    setModalOpen(false);
    setBusy(true);
    try {
      await window.aria.gmailConnect();
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const onModalCancel = useCallback(() => {
    setModalOpen(false);
  }, []);

  const onDisconnect = useCallback(async () => {
    setBusy(true);
    try {
      await window.aria.gmailDisconnect();
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const onForceSync = useCallback(async () => {
    setBusy(true);
    try {
      await window.aria.gmailForceSync();
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return (
    <section data-testid="settings-integrations" style={{ padding: 'var(--aria-space-lg)' }}>
      <h2 style={{ fontSize: 'var(--aria-type-xl)', marginTop: 0 }}>Integrations</h2>

      <article data-testid="integration-row-gmail" style={rowStyle()}>
        <header style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h3 style={{ margin: 0, fontSize: 'var(--aria-type-lg)' }}>Gmail</h3>
          {status?.connected && status.email && (
            <span data-testid="gmail-email" style={{ color: 'var(--aria-fg-muted)' }}>
              {status.email}
            </span>
          )}
        </header>

        {/* EMAIL-07 banner — expired */}
        {status?.connected && status.tokenStatus === 'expired' && (
          <div role="alert" data-testid="email07-banner-expired" style={bannerStyle()}>
            <p style={{ margin: 0 }}>{EMAIL_07_EXPIRED_COPY}</p>
            <button type="button" onClick={onConnectClick} disabled={busy}>
              Reconnect
            </button>
          </div>
        )}

        {/* EMAIL-07 banner — revoked variant */}
        {status?.connected && status.tokenStatus === 'revoked' && (
          <div role="alert" data-testid="email07-banner-revoked" style={bannerStyle()}>
            <p style={{ margin: 0 }}>{EMAIL_07_REVOKED_COPY}</p>
            <button type="button" onClick={onConnectClick} disabled={busy}>
              Reconnect
            </button>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ marginTop: 'var(--aria-space-sm)', display: 'flex', gap: 8 }}>
          {!status?.connected && (
            <button type="button" onClick={onConnectClick} disabled={busy} data-testid="gmail-connect-btn">
              Connect Gmail
            </button>
          )}
          {status?.connected && status.tokenStatus === 'ok' && (
            <>
              <button type="button" onClick={onForceSync} disabled={busy} data-testid="gmail-sync-now-btn">
                Sync now
              </button>
              <button type="button" onClick={onDisconnect} disabled={busy} data-testid="gmail-disconnect-btn">
                Disconnect
              </button>
            </>
          )}
        </div>
      </article>

      {/* Pre-OAuth disclosure modal */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="pre-oauth-modal"
          style={modalBackdropStyle()}
        >
          <div style={modalStyle()}>
            <h3 style={{ marginTop: 0 }}>Connect Gmail</h3>
            <p>{PRE_OAUTH_DISCLOSURE}</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={onModalCancel} data-testid="pre-oauth-cancel">
                Cancel
              </button>
              <button type="button" onClick={onModalContinue} data-testid="pre-oauth-continue">
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function rowStyle(): React.CSSProperties {
  return {
    padding: 'var(--aria-space-md)',
    border: '1px solid var(--aria-border)',
    borderRadius: 6,
    marginBottom: 'var(--aria-space-md)',
  };
}

function bannerStyle(): React.CSSProperties {
  return {
    marginTop: 'var(--aria-space-sm)',
    padding: 'var(--aria-space-sm)',
    border: '1px solid var(--aria-warn-border, #b34)',
    borderRadius: 4,
    background: 'var(--aria-warn-bg, #fff3f3)',
  };
}

function modalBackdropStyle(): React.CSSProperties {
  return {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  };
}

function modalStyle(): React.CSSProperties {
  return {
    width: 480,
    maxWidth: '90vw',
    background: 'var(--aria-bg, #fff)',
    padding: 'var(--aria-space-lg)',
    borderRadius: 8,
  };
}
