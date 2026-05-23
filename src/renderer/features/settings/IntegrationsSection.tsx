/**
 * Settings → Integrations.
 *
 * Connect entry point lives in AddAccountModal (Google, Microsoft, Todoist).
 * Connected accounts render through AccountRow (one row per provider_account),
 * which surfaces provider, email, status chip, lastError banner, and
 * Disconnect via the generic providerAccountDisconnect IPC + a confirmation
 * dialog gated at the section level.
 *
 * Calendar still owns a legacy per-provider row for the EMAIL-07
 * expired/revoked banner copy + inline Reconnect path + writeScopeMissing
 * re-consent flow. Hides itself when an AccountRow already covers the
 * account AND no actionable banner is firing.
 *
 * Gmail and Todoist legacy rows were removed in quick task 260523-a5w when
 * their connect entry points moved into AddAccountModal — AccountRow + the
 * generic disconnect dialog cover the connected-state UX without
 * duplicating the unified account list.
 */
import { useCallback, useEffect, useState } from 'react';
// Phase 9 editorial token reference: var(--ink), var(--gold), var(--rule), var(--paper).
// Import kept for ratchet — used inline below.
import type {
  CalendarIntegrationStatus,
  IpcError,
  ProviderAccountDto,
} from '../../../shared/ipc-contract';
import { AddAccountModal } from '../../components/AddAccountModal';
import { AccountRow } from '../../components/AccountRow';
import { DisconnectConfirmDialog } from '../../components/DisconnectConfirmDialog';
import { RagDisconnectedSection } from './RagDisconnectedSection';

const POLL_MS = 10_000;

// Calendar banner copy (Plan 02-02). Symmetric phrasing — "Gmail and other
// integrations are unaffected" proves SC3 mechanic across both halves.
export const CALENDAR_EMAIL_07_EXPIRED_COPY =
  "Aria's access to Google Calendar has expired. Re-connect to resume syncing. Gmail and other integrations are unaffected.";
export const CALENDAR_EMAIL_07_REVOKED_COPY =
  "Aria's access to Google Calendar was revoked. Re-connect to resume syncing. Gmail and other integrations are unaffected.";
export const CALENDAR_PRE_OAUTH_DISCLOSURE =
  "Aria will read your calendar only — never create, modify, or send events. Calendar write capability arrives in a later release.";

// Plan 04-01 — re-consent banner when the user previously connected Calendar
// under the readonly-only scope set and has NOT yet granted calendar.events
// write scope. Mirrors the Plan 03-04 gmail.send re-consent precedent.
export const CALENDAR_WRITE_SCOPE_MISSING_COPY =
  "Aria needs permission to make changes to your calendar. Reconnect Google Calendar.";

function isErr(v: unknown): v is IpcError {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

/**
 * Quick task 260523-a5w — PRESENCE-based gating for the last remaining
 * legacy row (Calendar). Hides the row whenever ANY AccountRow of the
 * provider is mounted, regardless of status — the row's internal
 * `hasBanner` check still lets the EMAIL-07 expired/revoked +
 * writeScopeMissing banners surface inline since those flows own a
 * Reconnect button AccountRow does not replicate.
 */
function hasAccount(
  accounts: ProviderAccountDto[],
  providerKey: ProviderAccountDto['providerKey'],
): boolean {
  return accounts.some((a) => a.providerKey === providerKey);
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

export function IntegrationsSection(): JSX.Element {
  const [accounts, setAccounts] = useState<ProviderAccountDto[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [pendingDisconnect, setPendingDisconnect] = useState<ProviderAccountDto | null>(null);
  const [disconnectBusy, setDisconnectBusy] = useState(false);
  const refreshAccounts = useCallback(async () => {
    const api = window.aria as typeof window.aria & {
      providerAccountsList?: typeof window.aria.providerAccountsList;
    };
    if (!api.providerAccountsList) return;
    const result = await api.providerAccountsList();
    if (!isErr(result)) setAccounts(result.rows);
  }, []);

  useEffect(() => {
    void refreshAccounts();
  }, [refreshAccounts]);

  // Phase 7 Gap 10 — destructive disconnect requires explicit confirmation.
  // Click opens the dialog; the IPC fires only on confirm.
  const requestDisconnectAccount = useCallback((account: ProviderAccountDto) => {
    setPendingDisconnect(account);
  }, []);

  const confirmDisconnectAccount = useCallback(async () => {
    if (!pendingDisconnect) return;
    const api = window.aria as typeof window.aria & {
      providerAccountDisconnect?: typeof window.aria.providerAccountDisconnect;
    };
    if (!api.providerAccountDisconnect) {
      setPendingDisconnect(null);
      return;
    }
    setDisconnectBusy(true);
    try {
      await api.providerAccountDisconnect({
        providerKey: pendingDisconnect.providerKey,
        accountId: pendingDisconnect.accountId,
      });
      await refreshAccounts();
    } finally {
      setDisconnectBusy(false);
      setPendingDisconnect(null);
    }
  }, [pendingDisconnect, refreshAccounts]);

  return (
    <section
      data-testid="settings-integrations"
      style={{ padding: 32, maxWidth: '64rem', margin: '0 auto', background: 'var(--paper)', color: 'var(--ink)' }}
    >
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--gold)',
          marginBottom: 6,
        }}
      >
        Settings · Connections
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 12, marginBottom: 4 }}>
        <h2
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 32,
            fontWeight: 500,
            letterSpacing: '-0.015em',
            color: 'var(--ink)',
            margin: 0,
          }}
        >
          Integrations
        </h2>
        <button
          type="button"
          data-testid="add-account-open"
          onClick={() => setAddOpen(true)}
          style={{
            background: 'transparent',
            border: 'none',
            padding: '6px 0',
            fontFamily: 'var(--f-display)',
            fontSize: 16,
            color: 'var(--ink)',
            cursor: 'pointer',
            borderBottom: '1px solid var(--gold, #8a6d3b)',
          }}
        >
          Add account
        </button>
      </div>
      {accounts.length > 0 && (
        <div
          data-testid="provider-account-list"
          style={{ marginBottom: 28, borderBottom: '1px solid var(--rule)' }}
        >
          {accounts.map((account) => (
            <AccountRow
              key={`${account.providerKey}:${account.accountId}`}
              account={account}
              onDisconnect={requestDisconnectAccount}
            />
          ))}
        </div>
      )}
      <AddAccountModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onConnected={refreshAccounts}
      />
      <CalendarRow hideWhenHealthy={hasAccount(accounts, 'google')} />
      <RagDisconnectedSection />
      <ResearchApiKeyRow provider="brave" label="Research — Brave Search" />
      <ResearchApiKeyRow provider="exa" label="Research — Exa" />
      {pendingDisconnect && (
        <DisconnectConfirmDialog
          provider={
            pendingDisconnect.providerKey === 'microsoft'
              ? 'Outlook'
              : pendingDisconnect.providerKey === 'todoist'
                ? 'Todoist'
                : 'Google'
          }
          account={pendingDisconnect.displayEmail}
          wipesRagData={
            pendingDisconnect.providerKey === 'google' ||
            pendingDisconnect.providerKey === 'microsoft'
          }
          testIdSuffix={`account-${pendingDisconnect.accountId}`}
          busy={disconnectBusy}
          onCancel={() => setPendingDisconnect(null)}
          onConfirm={confirmDisconnectAccount}
        />
      )}
    </section>
  );
}

// ============================================================================
// Calendar row — owns the EMAIL-07 expired/revoked banner + Reconnect path
// + writeScopeMissing re-consent flow that AccountRow doesn't replicate.
// Hides itself when an AccountRow already covers the account AND no
// actionable banner is firing.
// ============================================================================

function CalendarRow({ hideWhenHealthy }: { hideWhenHealthy?: boolean } = {}): JSX.Element | null {
  const [status, setStatus] = useState<CalendarIntegrationStatus | null>(null);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);

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
  // Phase 7 Gap 10 — gate disconnect behind explicit confirmation.
  const onDisconnectClick = useCallback(() => setConfirmOpen(true), []);
  const onConfirmDisconnect = useCallback(async () => {
    setBusy(true);
    try {
      await window.aria.calendarDisconnect();
      await refresh();
    } finally {
      setBusy(false);
      setConfirmOpen(false);
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

  const hasBanner =
    (status?.connected && status.tokenStatus !== 'ok') ||
    !!connectError ||
    (status?.connected && status.tokenStatus === 'ok' && (!!status.lastError || !!status.writeScopeMissing));
  if (hideWhenHealthy && !hasBanner) {
    return null;
  }

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

        {status?.connected && status.tokenStatus === 'ok' && status.lastError && (
          <p data-testid="calendar-sync-error" style={{ color: 'red', fontSize: 12, margin: '4px 0 0 0' }}>
            Last sync: {status.lastError}. See Status panel for history.
          </p>
        )}

        {status?.connected && status.tokenStatus === 'ok' && status.writeScopeMissing && (
          <div role="alert" data-testid="calendar-write-scope-banner" style={bannerStyle()}>
            <p style={{ margin: 0 }}>{CALENDAR_WRITE_SCOPE_MISSING_COPY}</p>
            <button type="button" onClick={onConnectClick} disabled={busy} data-testid="calendar-write-scope-reconnect">
              Reconnect Google Calendar
            </button>
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
              <button type="button" onClick={onDisconnectClick} disabled={busy} data-testid="calendar-disconnect-btn">
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

      {confirmOpen && (
        <DisconnectConfirmDialog
          provider="Google Calendar"
          account={status?.email ?? null}
          wipesRagData={true}
          testIdSuffix="calendar"
          busy={busy}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={onConfirmDisconnect}
        />
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

// ============================================================================
// Research API key rows — Phase 11
// ============================================================================

function ResearchApiKeyRow({
  provider,
  label,
}: {
  provider: 'brave' | 'exa';
  label: string;
}): JSX.Element {
  const [keyValue, setKeyValue] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    if (!keyValue.trim()) return;
    setBusy(true);
    try {
      await window.aria.researchSecretsSet({ provider, key: keyValue.trim() });
      setSaved(true);
      setKeyValue('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--rule)' }}>
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 11,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--gray-soft)',
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="password"
          value={keyValue}
          onChange={(e) => { setKeyValue(e.target.value); setSaved(false); }}
          placeholder="Paste API key…"
          style={{
            flex: 1,
            fontFamily: 'var(--f-mono)',
            fontSize: 13,
            border: '1px solid var(--rule)',
            borderRadius: 4,
            padding: '7px 12px',
            background: 'var(--bg)',
            color: 'inherit',
          }}
        />
        <button
          onClick={() => void save()}
          disabled={!keyValue.trim() || busy}
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 12,
            background: keyValue.trim() ? 'var(--gold)' : 'var(--rule)',
            color: keyValue.trim() ? 'var(--bg)' : 'var(--gray-soft)',
            border: 'none',
            borderRadius: 4,
            padding: '7px 16px',
            cursor: keyValue.trim() && !busy ? 'pointer' : 'not-allowed',
          }}
        >
          {busy ? 'Saving…' : 'Save key'}
        </button>
      </div>
      {saved && (
        <div
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 12,
            color: '#27ae60',
            marginTop: 6,
          }}
        >
          Key saved
        </div>
      )}
    </div>
  );
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
