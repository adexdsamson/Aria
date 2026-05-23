/**
 * Settings → Integrations.
 *
 * Connect entry point lives in AddAccountModal (Google, Microsoft, Todoist).
 * Connected accounts render through AccountRow (one row per provider_account),
 * which surfaces provider, email, status chip, lastError banner, Sync now,
 * and Disconnect via the generic providerAccountDisconnect IPC + a
 * confirmation dialog gated at the section level.
 *
 * Gmail / Calendar / Todoist legacy per-provider rows were all removed in
 * quick task 260523-a5w when their connect entry points moved into
 * AddAccountModal — AccountRow + the generic disconnect dialog cover the
 * connected-state UX without duplicating the unified account list.
 */
import { useCallback, useEffect, useState } from 'react';
// Phase 9 editorial token reference: var(--ink), var(--gold), var(--rule), var(--paper).
// Import kept for ratchet — used inline below.
import type {
  IpcError,
  ProviderAccountDto,
} from '../../../shared/ipc-contract';
import { AddAccountModal } from '../../components/AddAccountModal';
import { AccountRow } from '../../components/AccountRow';
import { DisconnectConfirmDialog } from '../../components/DisconnectConfirmDialog';
import { RagDisconnectedSection } from './RagDisconnectedSection';

function isErr(v: unknown): v is IpcError {
  return !!v && typeof v === 'object' && 'error' in (v as object);
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

  // Quick task 260523-a5w — manual force-sync per account. Force-sync IPCs
  // are singleton (no accountId arg) so for Google we run both gmail +
  // calendar in parallel; Microsoft + Todoist each have a single combined
  // sync IPC.
  const syncAccount = useCallback(async (account: ProviderAccountDto): Promise<void> => {
    if (account.providerKey === 'google') {
      await Promise.allSettled([
        window.aria.gmailForceSync(),
        window.aria.calendarForceSync(),
      ]);
    } else if (account.providerKey === 'microsoft') {
      await window.aria.microsoftForceSync();
    } else if (account.providerKey === 'todoist') {
      await window.aria.todoistForceSync();
    }
    await refreshAccounts();
  }, [refreshAccounts]);

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
              onSync={syncAccount}
            />
          ))}
        </div>
      )}
      <AddAccountModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onConnected={refreshAccounts}
      />
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
// (Removed: legacy CalendarRow — quick task 260523-a5w. AddAccountModal
// requests calendar.events scope in the dual Google OAuth flow alongside
// gmail.readonly + gmail.send; AccountRow surfaces provider, email,
// status chip, lastError, Sync now, and Disconnect for Google accounts
// with calendar capability set. The expired/revoked + writeScopeMissing
// banners + inline Reconnect button are lost — recovery is to re-OAuth
// via Add account → Google when status flips to needs-auth.)
// ============================================================================

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

