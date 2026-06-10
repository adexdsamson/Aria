import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import { CHANNELS, type ProviderAccountDto } from '../../shared/ipc-contract';
import type { DbHolder } from './onboarding';
import { listProviderAccounts } from '../integrations/microsoft/provider-account';
import { clearGoogleTokens } from '../secrets/safeStorage';
import { clearProviderTokens } from '../secrets/safeStorage';
import type Database from 'better-sqlite3-multiple-ciphers';
import type { WhatsAppSessionManager } from '../whatsapp/session-manager';

export interface ProviderAccountsDeps {
  logger: Logger;
  dbHolder: DbHolder;
  /**
   * Getter for the WhatsApp session manager — used for cascade disconnect (WA-04).
   * A getter (not a direct reference) is required because the manager is constructed
   * post-unlock in bootPoll, but registerProviderAccountHandlers is called pre-unlock.
   * The getter returns null pre-unlock and the live instance post-unlock.
   */
  getWhatsAppManager?: () => WhatsAppSessionManager | null;
}

function notReady(): { error: string } {
  return { error: 'DB_NOT_OPEN' };
}

// ─── Exported disconnect helper (also used by WHATSAPP_DISCONNECT IPC) ────────

export interface DisconnectArgs {
  db: Database.Database;
  /** WhatsApp session manager — only used when providerKey === 'whatsapp'. */
  manager?: WhatsAppSessionManager | null;
  providerKey: 'google' | 'microsoft' | 'todoist' | 'whatsapp';
  accountId: string;
}

/**
 * Execute the full provider account disconnect cascade.
 *
 * For 'whatsapp': stops the socket (manager.stop()), deletes
 * whatsapp_auth_state + whatsapp_group (FK CASCADE removes
 * whatsapp_message + whatsapp_group_digest), then deletes the
 * provider_account row (WA-04).
 *
 * For other providers: clears OAuth tokens from keychain, then
 * deletes provider_sync_state / gmail_message / calendar_event /
 * approval / provider_account rows in one transaction.
 *
 * Exported so it can be called directly from:
 *   - registerProviderAccountHandlers (PROVIDER_ACCOUNT_DISCONNECT IPC)
 *   - registerWhatsAppHandlers (WHATSAPP_DISCONNECT IPC)
 *   - whatsapp-disconnect.spec.ts integration spec (WA-04 verification)
 */
export async function handleProviderAccountDisconnect(args: DisconnectArgs): Promise<void> {
  const { db, manager, providerKey, accountId } = args;

  if (providerKey === 'whatsapp') {
    // Tear down the socket first (before DB deletes).
    if (manager) {
      manager.stop();
    }
    // Cascade delete in one transaction.
    // Migration 138 restores foreign_keys=ON, so:
    //   DELETE FROM whatsapp_group → CASCADE removes whatsapp_message + whatsapp_group_digest.
    // No explicit message/digest delete needed.
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM whatsapp_auth_state').run();
      db.prepare('DELETE FROM whatsapp_group').run();
      db.prepare(
        'DELETE FROM provider_account WHERE provider_key = ? AND account_id = ?',
      ).run(providerKey, accountId);
    });
    tx();
    return;
  }

  // Non-WhatsApp providers: best-effort token cleanup, then transactional row deletes.
  try {
    if (providerKey === 'google') {
      if (accountId === 'gmail') clearGoogleTokens('gmail');
      if (accountId === 'calendar') clearGoogleTokens('calendar');
    }
    clearProviderTokens(`${providerKey}:${accountId}`);
  } catch {
    /* best-effort key cleanup */
  }
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM provider_sync_state WHERE provider_key = ? AND account_id = ?').run(providerKey, accountId);
    db.prepare('DELETE FROM gmail_message WHERE provider_key = ? AND account_id = ?').run(providerKey, accountId);
    db.prepare('DELETE FROM calendar_event WHERE provider_key = ? AND account_id = ?').run(providerKey, accountId);
    db.prepare('DELETE FROM approval WHERE provider_key = ? AND account_id = ?').run(providerKey, accountId);
    db.prepare('DELETE FROM provider_account WHERE provider_key = ? AND account_id = ?').run(providerKey, accountId);
  });
  tx();
}

// ─── IPC handler registration ─────────────────────────────────────────────────

export function registerProviderAccountHandlers(ipcMain: IpcMain, deps: ProviderAccountsDeps): void {
  const { dbHolder, logger } = deps;

  ipcMain.handle(CHANNELS.PROVIDER_ACCOUNTS_LIST, async () => {
    const db = dbHolder.db;
    if (!db) return notReady();
    const rows: ProviderAccountDto[] = listProviderAccounts(db).map((row) => ({
      providerKey: row.providerKey,
      accountId: row.accountId,
      displayEmail: row.displayEmail,
      displayLabel: row.displayLabel ?? null,
      displayColor: row.displayColor ?? null,
      status: row.status ?? 'ok',
      capabilitiesJson: row.capabilitiesJson,
      lastSyncedAt: row.lastSyncedAt ?? null,
      lastError: row.lastError ?? null,
    }));
    return { rows };
  });

  ipcMain.handle(CHANNELS.PROVIDER_ACCOUNT_UPDATE, async (_e, req: unknown) => {
    const db = dbHolder.db;
    if (!db) return notReady();
    const r = req as {
      providerKey?: 'google' | 'microsoft' | 'todoist' | 'whatsapp';
      accountId?: string;
      displayLabel?: string | null;
      displayColor?: string | null;
    };
    if (!r.providerKey || !r.accountId) return { error: 'PROVIDER_AND_ACCOUNT_REQUIRED' };
    db.prepare(
      `UPDATE provider_account
          SET display_label = COALESCE(?, display_label),
              display_color = COALESCE(?, display_color)
        WHERE provider_key = ? AND account_id = ?`,
    ).run(r.displayLabel ?? null, r.displayColor ?? null, r.providerKey, r.accountId);
    logger.info({ event: 'provider-account.update', providerKey: r.providerKey, accountId: r.accountId });
    return { ok: true as const };
  });

  ipcMain.handle(CHANNELS.PROVIDER_ACCOUNT_DISCONNECT, async (_e, req: unknown) => {
    const db = dbHolder.db;
    if (!db) return notReady();
    const r = req as {
      providerKey?: 'google' | 'microsoft' | 'todoist' | 'whatsapp';
      accountId?: string;
    };
    if (!r.providerKey || !r.accountId) return { error: 'PROVIDER_AND_ACCOUNT_REQUIRED' };
    try {
      await handleProviderAccountDisconnect({
        db,
        manager: r.providerKey === 'whatsapp' ? (deps.getWhatsAppManager?.() ?? null) : null,
        providerKey: r.providerKey,
        accountId: r.accountId,
      });
      logger.info({ event: 'provider-account.disconnect', providerKey: r.providerKey, accountId: r.accountId });
      return { ok: true as const };
    } catch (err) {
      logger.warn({ event: 'provider-account.disconnect.fail', err });
      return { error: String(err) };
    }
  });
}
