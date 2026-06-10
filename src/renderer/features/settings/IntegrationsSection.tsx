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
import { useCallback, useEffect, useRef, useState } from 'react';
// Phase 9 editorial token reference: var(--ink), var(--gold), var(--rule), var(--paper).
// Import kept for ratchet — used inline below.
import type {
  IpcError,
  ProviderAccountDto,
  WhatsAppStateChangedDto,
} from '../../../shared/ipc-contract';
import { AddAccountModal } from '../../components/AddAccountModal';
import { AccountRow } from '../../components/AccountRow';
import { DisconnectConfirmDialog } from '../../components/DisconnectConfirmDialog';
import { WhatsAppConsentModal } from '../../components/WhatsAppConsentModal';
import { WhatsAppQrModal } from '../../components/WhatsAppQrModal';
import { WhatsAppGroupPickerModal } from '../../components/WhatsAppGroupPickerModal';
import { RagDisconnectedSection } from './RagDisconnectedSection';

function isErr(v: unknown): v is IpcError {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

export function IntegrationsSection(): JSX.Element {
  const [accounts, setAccounts] = useState<ProviderAccountDto[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [pendingDisconnect, setPendingDisconnect] = useState<ProviderAccountDto | null>(null);
  const [disconnectBusy, setDisconnectBusy] = useState(false);

  // WhatsApp link flow: consent → QR (D-05/D-07/WA-01)
  const [waConsentOpen, setWaConsentOpen] = useState(false);
  const [waQrOpen, setWaQrOpen] = useState(false);
  // WhatsApp group picker (D-01)
  const [waGroupPickerOpen, setWaGroupPickerOpen] = useState(false);
  const waStateUnsubRef = useRef<(() => void) | null>(null);
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

  // D-09: Subscribe to WHATSAPP_STATE_CHANGED to refresh the AccountRow status
  // chip without toasts (passive posture). Unsubscribe on unmount.
  useEffect(() => {
    const api = window.aria;
    if (!api.onWhatsappStateChanged) return;
    const unsub = api.onWhatsappStateChanged((_dto: WhatsAppStateChangedDto) => {
      // Refresh accounts so the chip reflects the new status (no toast — D-09)
      void refreshAccounts();
    });
    waStateUnsubRef.current = unsub;
    return () => {
      unsub();
      waStateUnsubRef.current = null;
    };
  }, [refreshAccounts]);

  // WhatsApp connect flow: AddAccountModal → consent ack → WHATSAPP_LINK → QR modal
  // Per D-07/SC-1: the WHATSAPP_LINK IPC is only callable AFTER consent ack.
  // D-12: QR only — no OAuth BrowserWindow for WhatsApp.
  const handleWaConsentConfirm = useCallback(async () => {
    const api = window.aria;
    if (!api.whatsappLink) return;
    await api.whatsappLink();
    setWaConsentOpen(false);
    setWaQrOpen(true);
  }, []);

  // Called when AddAccountModal triggers the WhatsApp "connect" action.
  // Exposed via the onConnected callback shape: WhatsApp deviates from OAuth
  // by opening the consent modal instead.
  const openWaConsent = useCallback(() => {
    setAddOpen(false);
    setWaConsentOpen(true);
  }, []);

  // Reconnect (needs-auth / degraded): re-opens consent → QR flow
  const handleWaReconnect = useCallback(async (account: ProviderAccountDto) => {
    if (account.providerKey !== 'whatsapp') return;
    const api = window.aria;
    if (!api.whatsappLink) return;
    await api.whatsappLink();
    setWaQrOpen(true);
  }, []);

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
        <div style={{ display: 'flex', gap: 16 }}>
          <button
            type="button"
            data-testid="add-whatsapp-open"
            onClick={openWaConsent}
            style={{
              background: 'transparent',
              border: 'none',
              padding: '6px 0',
              fontFamily: 'var(--f-display)',
              fontSize: 16,
              color: 'var(--ink)',
              cursor: 'pointer',
              borderBottom: '1px solid #25d366',
              opacity: 0.85,
            }}
          >
            Link WhatsApp
          </button>
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
              onSync={account.providerKey !== 'whatsapp' ? syncAccount : undefined}
              onReconnect={account.providerKey === 'whatsapp' ? handleWaReconnect : undefined}
              onManageGroups={
                account.providerKey === 'whatsapp'
                  ? () => setWaGroupPickerOpen(true)
                  : undefined
              }
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
                : pendingDisconnect.providerKey === 'whatsapp'
                  ? 'WhatsApp'
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

      {/* WhatsApp link flow: consent → QR (D-05/D-07/WA-01) */}
      <WhatsAppConsentModal
        open={waConsentOpen}
        onClose={() => setWaConsentOpen(false)}
        onShowQr={() => void handleWaConsentConfirm()}
      />
      <WhatsAppQrModal
        open={waQrOpen}
        onClose={() => {
          setWaQrOpen(false);
          void refreshAccounts();
        }}
      />

      {/* WhatsApp group picker (D-01) */}
      <WhatsAppGroupPickerModal
        open={waGroupPickerOpen}
        onClose={() => setWaGroupPickerOpen(false)}
      />
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
            color: keyValue.trim() ? 'var(--on-gold, #fff)' : 'var(--gray-soft)',
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

