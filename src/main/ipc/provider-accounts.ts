import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import { CHANNELS, type ProviderAccountDto } from '../../shared/ipc-contract';
import type { DbHolder } from './onboarding';
import { listProviderAccounts } from '../integrations/microsoft/provider-account';
import { clearGoogleTokens } from '../secrets/safeStorage';
import { clearProviderTokens } from '../secrets/safeStorage';

export interface ProviderAccountsDeps {
  logger: Logger;
  dbHolder: DbHolder;
}

function notReady(): { error: string } {
  return { error: 'DB_NOT_OPEN' };
}

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
      providerKey?: 'google' | 'microsoft' | 'todoist';
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
    const r = req as { providerKey?: 'google' | 'microsoft' | 'todoist'; accountId?: string };
    if (!r.providerKey || !r.accountId) return { error: 'PROVIDER_AND_ACCOUNT_REQUIRED' };
    try {
      if (r.providerKey === 'google') {
        if (r.accountId === 'gmail') clearGoogleTokens('gmail');
        if (r.accountId === 'calendar') clearGoogleTokens('calendar');
      }
      clearProviderTokens(`${r.providerKey}:${r.accountId}`);
    } catch {
      /* best-effort key cleanup */
    }
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM provider_sync_state WHERE provider_key = ? AND account_id = ?').run(r.providerKey, r.accountId);
      db.prepare('DELETE FROM gmail_message WHERE provider_key = ? AND account_id = ?').run(r.providerKey, r.accountId);
      db.prepare('DELETE FROM calendar_event WHERE provider_key = ? AND account_id = ?').run(r.providerKey, r.accountId);
      db.prepare('DELETE FROM approval WHERE provider_key = ? AND account_id = ?').run(r.providerKey, r.accountId);
      db.prepare('DELETE FROM provider_account WHERE provider_key = ? AND account_id = ?').run(r.providerKey, r.accountId);
    });
    tx();
    logger.info({ event: 'provider-account.disconnect', providerKey: r.providerKey, accountId: r.accountId });
    return { ok: true as const };
  });
}
