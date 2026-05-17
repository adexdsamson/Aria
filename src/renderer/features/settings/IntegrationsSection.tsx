/**
 * Plan 02-02 Task 3 — Settings → Integrations.
 *
 * Renders one row per third-party integration. Plan 02-01 shipped Gmail; this
 * plan adds Calendar as a sibling row. Each row owns INDEPENDENT React state
 * (no shared store) so disconnecting one does NOT visually reset the other —
 * the SC3 mechanic.
 *
 * Row states (Gmail + Calendar share the vocabulary):
 *   - disconnected:        "Connect <Kind>" button
 *   - connected (ok):      email + "Sync now" + "Disconnect"
 *   - connected (expired): EMAIL-07 banner (locked copy) + "Reconnect"
 *   - connected (revoked): EMAIL-07 banner (revoked variant) + "Reconnect"
 *
 * Locked banner copy is exported for spec assertions and contains the
 * "other integrations are unaffected" phrasing that proves SC3 at the
 * renderer level (Plan 02-01 Gmail half + Plan 02-02 Calendar half).
 *
 * Pre-OAuth disclosure modal is per-kind:
 *   - Gmail:    CASA unverified-app copy.
 *   - Calendar: read-only scope disclosure ("Aria will read your calendar
 *               only — never create, modify, or send events. Calendar write
 *               capability arrives in a later release.")
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  CalendarIntegrationStatus,
  GmailIntegrationStatus,
  IpcError,
} from '../../../shared/ipc-contract';

const POLL_MS = 10_000;

// Gmail banner copy (Plan 02-01). The "Calendar and other integrations are
// unaffected" phrasing was locked in 02-01 and MUST remain stable.
export const EMAIL_07_EXPIRED_COPY =
  "Aria's access to Gmail has expired. Re-connect to resume syncing. Calendar and other integrations are unaffected.";
export const EMAIL_07_REVOKED_COPY =
  "Aria's access to Gmail was revoked. Re-connect to resume syncing. Calendar and other integrations are unaffected.";
export const PRE_OAUTH_DISCLOSURE =
  "Google will show a warning that Aria hasn't been verified. This is expected while Aria is in private testing — your data stays on your machine. Continue?";

// Calendar banner copy (Plan 02-02). Symmetric phrasing — "Gmail and other
// integrations are unaffected" proves SC3 mechanic across both halves.
export const CALENDAR_EMAIL_07_EXPIRED_COPY =
  "Aria's access to Google Calendar has expired. Re-connect to resume syncing. Gmail and other integrations are unaffected.";
export const CALENDAR_EMAIL_07_REVOKED_COPY =
  "Aria's access to Google Calendar was revoked. Re-connect to resume syncing. Gmail and other integrations are unaffected.";
export const CALENDAR_PRE_OAUTH_DISCLOSURE =
  "Aria will read your calendar only — never create, modify, or send events. Calendar write capability arrives in a later release.";

function isErr(v: unknown): v is IpcError {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

/**
 * Map known connect-error codes (UAT Gap 3) to user-facing copy. Unknown
 * codes fall through to a generic message that points at the dev terminal —
 * cheap escape hatch while we're still adding handler-side error vocab.
 */
function connectErrorCopy(code: string): string {
  switch (code) {
    case 'oauth-config-missing':
      return "Aria can't find Google OAuth credentials. See .env.local.example and your local .env.local file.";
    case 'access_denied':
      return 'Connection canceled. Click Connect to try again.';
    default:
      return `Could not connect: ${code}. Check the dev terminal for details.`;
  }
}

function hasErrorCode(v: unknown): v is { error: string } {
  return !!v && typeof v === 'object' && 'error' in (v as object) && typeof (v as { error: unknown }).error === 'string';
}

interface IntegrationsSectionProps {
  /** Hook for tests to start with the pre-OAuth modal already open. */
  initialModalOpen?: boolean;
}

export function IntegrationsSection({ initialModalOpen }: IntegrationsSectionProps = {}): JSX.Element {
  return (
    <section data-testid="settings-integrations" style={{ padding: 'var(--aria-space-lg)' }}>
      <h2 style={{ fontSize: 'var(--aria-type-xl)', marginTop: 0 }}>Integrations</h2>
      <GmailRow initialModalOpen={initialModalOpen} />
      <CalendarRow />
    </section>
  );
}

// ============================================================================
// Gmail row — owns its own state. Behaviorally identical to the Plan 02-01
// version; only refactored out of the section root.
// ============================================================================

function GmailRow({ initialModalOpen }: { initialModalOpen?: boolean }): JSX.Element {
  const [status, setStatus] = useState<GmailIntegrationStatus | null>(null);
  const [modalOpen, setModalOpen] = useState<boolean>(initialModalOpen ?? false);
  const [busy, setBusy] = useState<boolean>(false);
  const [connectError, setConnectError] = useState<string | null>(null);

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
    setConnectError(null);
    setModalOpen(true);
  }, []);
  const onModalContinue = useCallback(async () => {
    setModalOpen(false);
    setBusy(true);
    setConnectError(null);
    try {
      const result = await window.aria.gmailConnect();
      if (hasErrorCode(result)) {
        setConnectError(connectErrorCopy(result.error));
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);
  const onModalCancel = useCallback(() => setModalOpen(false), []);
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
    <>
      <article data-testid="integration-row-gmail" style={rowStyle()}>
        <header style={headerStyle()}>
          <h3 style={titleStyle()}>Gmail</h3>
          {status?.connected && status.email && (
            <span data-testid="gmail-email" style={{ color: 'var(--aria-fg-muted)' }}>
              {status.email}
            </span>
          )}
        </header>

        {status?.connected && status.tokenStatus === 'expired' && (
          <div role="alert" data-testid="email07-banner-expired" style={bannerStyle()}>
            <p style={{ margin: 0 }}>{EMAIL_07_EXPIRED_COPY}</p>
            <button type="button" onClick={onConnectClick} disabled={busy}>Reconnect</button>
          </div>
        )}

        {status?.connected && status.tokenStatus === 'revoked' && (
          <div role="alert" data-testid="email07-banner-revoked" style={bannerStyle()}>
            <p style={{ margin: 0 }}>{EMAIL_07_REVOKED_COPY}</p>
            <button type="button" onClick={onConnectClick} disabled={busy}>Reconnect</button>
          </div>
        )}

        {connectError && (
          <div role="alert" data-testid="gmail-connect-error" style={bannerStyle()}>
            <p style={{ margin: 0 }}>{connectError}</p>
          </div>
        )}

        <div style={actionsStyle()}>
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

      {modalOpen && (
        <div role="dialog" aria-modal="true" data-testid="pre-oauth-modal" style={modalBackdropStyle()}>
          <div style={modalStyle()}>
            <h3 style={{ marginTop: 0 }}>Connect Gmail</h3>
            <p>{PRE_OAUTH_DISCLOSURE}</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={onModalCancel} data-testid="pre-oauth-cancel">Cancel</button>
              <button type="button" onClick={onModalContinue} data-testid="pre-oauth-continue">Continue</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ============================================================================
// Calendar row — its own state, mirroring the Gmail row's IPC vocabulary.
// ============================================================================

function CalendarRow(): JSX.Element {
  const [status, setStatus] = useState<CalendarIntegrationStatus | null>(null);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await window.aria.calendarStatus();
    if (!isErr(next)) setStatus(next);
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const onConnectClick = useCallback(() => {
    setConnectError(null);
    setModalOpen(true);
  }, []);
  const onModalContinue = useCallback(async () => {
    setModalOpen(false);
    setBusy(true);
    setConnectError(null);
    try {
      const result = await window.aria.calendarConnect();
      if (hasErrorCode(result)) {
        setConnectError(connectErrorCopy(result.error));
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);
  const onModalCancel = useCallback(() => setModalOpen(false), []);
  const onDisconnect = useCallback(async () => {
    setBusy(true);
    try {
      await window.aria.calendarDisconnect();
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);
  const onForceSync = useCallback(async () => {
    setBusy(true);
    try {
      await window.aria.calendarForceSync();
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return (
    <>
      <article data-testid="integration-row-calendar" style={rowStyle()}>
        <header style={headerStyle()}>
          <h3 style={titleStyle()}>Calendar</h3>
          {status?.connected && status.email && (
            <span data-testid="calendar-email" style={{ color: 'var(--aria-fg-muted)' }}>
              {status.email}
            </span>
          )}
        </header>

        {status?.connected && status.tokenStatus === 'expired' && (
          <div role="alert" data-testid="calendar-email07-banner-expired" style={bannerStyle()}>
            <p style={{ margin: 0 }}>{CALENDAR_EMAIL_07_EXPIRED_COPY}</p>
            <button type="button" onClick={onConnectClick} disabled={busy}>Reconnect</button>
          </div>
        )}

        {status?.connected && status.tokenStatus === 'revoked' && (
          <div role="alert" data-testid="calendar-email07-banner-revoked" style={bannerStyle()}>
            <p style={{ margin: 0 }}>{CALENDAR_EMAIL_07_REVOKED_COPY}</p>
            <button type="button" onClick={onConnectClick} disabled={busy}>Reconnect</button>
          </div>
        )}

        {connectError && (
          <div role="alert" data-testid="calendar-connect-error" style={bannerStyle()}>
            <p style={{ margin: 0 }}>{connectError}</p>
          </div>
        )}

        <div style={actionsStyle()}>
          {!status?.connected && (
            <button type="button" onClick={onConnectClick} disabled={busy} data-testid="calendar-connect-btn">
              Connect Calendar
            </button>
          )}
          {status?.connected && status.tokenStatus === 'ok' && (
            <>
              <button type="button" onClick={onForceSync} disabled={busy} data-testid="calendar-sync-now-btn">
                Sync now
              </button>
              <button type="button" onClick={onDisconnect} disabled={busy} data-testid="calendar-disconnect-btn">
                Disconnect
              </button>
            </>
          )}
        </div>
      </article>

      {modalOpen && (
        <div role="dialog" aria-modal="true" data-testid="calendar-pre-oauth-modal" style={modalBackdropStyle()}>
          <div style={modalStyle()}>
            <h3 style={{ marginTop: 0 }}>Connect Calendar</h3>
            <p>{CALENDAR_PRE_OAUTH_DISCLOSURE}</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={onModalCancel} data-testid="calendar-pre-oauth-cancel">Cancel</button>
              <button type="button" onClick={onModalContinue} data-testid="calendar-pre-oauth-continue">Continue</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ============================================================================
// Shared styles
// ============================================================================

function rowStyle(): React.CSSProperties {
  return {
    padding: 'var(--aria-space-md)',
    border: '1px solid var(--aria-border)',
    borderRadius: 6,
    marginBottom: 'var(--aria-space-md)',
  };
}

function headerStyle(): React.CSSProperties {
  return { display: 'flex', alignItems: 'baseline', gap: 12 };
}

function titleStyle(): React.CSSProperties {
  return { margin: 0, fontSize: 'var(--aria-type-lg)' };
}

function actionsStyle(): React.CSSProperties {
  return { marginTop: 'var(--aria-space-sm)', display: 'flex', gap: 8 };
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
