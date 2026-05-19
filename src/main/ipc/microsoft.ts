import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import cron from 'node-cron';
import { CHANNELS, type MicrosoftIntegrationStatus } from '../../shared/ipc-contract';
import type { SchedulerHandle } from '../lifecycle/scheduler';
import type { DbHolder } from './onboarding';
import { registerLifecycleCallbacks } from '../lifecycle/powerMonitor';
import { connectMicrosoft } from '../integrations/microsoft/auth';
import { OAuthConfigMissingError } from '../integrations/microsoft/errors';
import {
  listProviderAccounts,
  upsertProviderAccount,
  upsertProviderSyncState,
} from '../integrations/microsoft/provider-account';
import { clearProviderTokens } from '../secrets/safeStorage';
import { createGraphClient } from '../integrations/microsoft/client';
import { tickMail } from '../integrations/microsoft/sync-mail';
import { tickCalendar } from '../integrations/microsoft/sync-calendar';

export interface MicrosoftHandlerDeps {
  logger: Logger;
  dbHolder: DbHolder;
  scheduler: SchedulerHandle;
  doConnect?: () => Promise<{ accountId: string; email: string; displayName: string; identitySet: { primaryEmail: string; aliases: string[] } }>;
  buildGraphClient?: (accountId: string) => ReturnType<typeof createGraphClient>;
  doMailTick?: (accountId: string) => Promise<void>;
  doCalendarTick?: (accountId: string) => Promise<void>;
}

const MAIL_CRON_KEY = (accountId: string) => `microsoft-mail-sync:${accountId}`;
const CALENDAR_CRON_KEY = (accountId: string) => `microsoft-calendar-sync:${accountId}`;
const MAIL_CRON_SCHEDULE = '*/5 * * * *';
const CALENDAR_CRON_SCHEDULE = '*/15 * * * *';

function statusFromRow(row: {
  email: string;
  displayLabel?: string | null;
  last_synced_at?: string | null;
  last_error?: string | null;
  status?: string;
} | undefined, queueDepth: number): MicrosoftIntegrationStatus {
  if (!row) {
    return { connected: false, tokenStatus: 'missing', queueDepth };
  }
  const tokenStatus: MicrosoftIntegrationStatus['tokenStatus'] =
    !row.last_error
      ? 'ok'
      : row.last_error.startsWith('token-expired')
        ? 'expired'
        : row.last_error.startsWith('token-revoked')
          ? 'revoked'
          : 'ok';
  return {
    connected: row.status !== 'disconnected',
    email: row.email,
    displayName: row.displayLabel ?? undefined,
    lastSyncedAt: row.last_synced_at ?? undefined,
    lastError: row.last_error ?? undefined,
    tokenStatus,
    queueDepth,
  };
}

export function registerMicrosoftHandlers(ipcMain: IpcMain, deps: MicrosoftHandlerDeps): void {
  const { logger, dbHolder, scheduler } = deps;

  function buildGraphClient(accountId: string) {
    return deps.buildGraphClient ? deps.buildGraphClient(accountId) : createGraphClient(accountId);
  }

  function ensureMailCron(accountId: string): void {
    const key = MAIL_CRON_KEY(accountId);
    if (scheduler.cronRegistry.has(key)) return;
    const task = cron.schedule(MAIL_CRON_SCHEDULE, () => {
      void runMail(accountId).catch((err) => {
        logger.warn({ scope: 'microsoft-mail', accountId, err: (err as Error).message }, 'mail cron tick error');
      });
    });
    scheduler.cronRegistry.set(key, task);
    logger.info({ scope: 'microsoft-mail', accountId, schedule: MAIL_CRON_SCHEDULE }, 'microsoft mail cron registered');
  }

  function ensureCalendarCron(accountId: string): void {
    const key = CALENDAR_CRON_KEY(accountId);
    if (scheduler.cronRegistry.has(key)) return;
    const task = cron.schedule(CALENDAR_CRON_SCHEDULE, () => {
      void runCalendar(accountId).catch((err) => {
        logger.warn({ scope: 'microsoft-calendar', accountId, err: (err as Error).message }, 'calendar cron tick error');
      });
    });
    scheduler.cronRegistry.set(key, task);
    logger.info({ scope: 'microsoft-calendar', accountId, schedule: CALENDAR_CRON_SCHEDULE }, 'microsoft calendar cron registered');
  }

  function stopAccountCrons(accountId: string): void {
    for (const key of [MAIL_CRON_KEY(accountId), CALENDAR_CRON_KEY(accountId)]) {
      const task = scheduler.cronRegistry.get(key);
      if (task) {
        task.stop();
        scheduler.cronRegistry.delete(key);
      }
    }
  }

  async function runMail(accountId: string): Promise<void> {
    const db = dbHolder.db;
    if (!db) return;
    const tick = deps.doMailTick
      ? () => deps.doMailTick!(accountId)
      : () => {
          const client = buildGraphClient(accountId);
          return tickMail({ db, accountId, client, scheduler, logger });
        };
    await scheduler.queue.add(() => tick());
  }

  async function runCalendar(accountId: string): Promise<void> {
    const db = dbHolder.db;
    if (!db) return;
    const tick = deps.doCalendarTick
      ? () => deps.doCalendarTick!(accountId)
      : () => {
          const client = buildGraphClient(accountId);
          return tickCalendar({ db, accountId, client, scheduler, logger });
        };
    await scheduler.queue.add(() => tick());
  }

  registerLifecycleCallbacks({
    onSuspend: () => {
      const db = dbHolder.db;
      const rows = db ? listProviderAccounts(db, 'microsoft').filter((row) => row.status === 'ok') : [];
      for (const row of rows) {
        stopAccountCrons(row.accountId);
      }
    },
    onResume: () => {
      const db = dbHolder.db;
      const rows = db ? listProviderAccounts(db, 'microsoft').filter((row) => row.status === 'ok') : [];
      for (const row of rows) {
        ensureMailCron(row.accountId);
        ensureCalendarCron(row.accountId);
      }
    },
  });

  function bootstrapCrons(): void {
    const db = dbHolder.db;
    if (!db) return;
    for (const row of listProviderAccounts(db, 'microsoft')) {
      if (row.status !== 'ok') continue;
      ensureMailCron(row.accountId);
      ensureCalendarCron(row.accountId);
    }
  }

  async function connectAndSeed(): Promise<{ ok: true; email: string; displayName: string } | { ok: false; error: string }> {
    try {
      const result = deps.doConnect ? await deps.doConnect() : await connectMicrosoft();
      const db = dbHolder.db;
      if (!db) return { ok: false, error: 'db-locked' };
      upsertProviderAccount(db, {
        providerKey: 'microsoft',
        accountId: result.accountId,
        displayEmail: result.email,
        displayLabel: result.displayName,
        status: 'ok',
        identitySet: result.identitySet,
        capabilitiesJson: JSON.stringify({ mail: true, calendar: true }),
        lastSyncedAt: null,
        lastError: null,
        lastErrorAt: null,
      });
      upsertProviderSyncState(db, {
        providerKey: 'microsoft',
        accountId: result.accountId,
        resource: 'mail',
        cursor: null,
        lastSyncAt: null,
        lastError: null,
      });
      upsertProviderSyncState(db, {
        providerKey: 'microsoft',
        accountId: result.accountId,
        resource: 'calendar',
        cursor: null,
        lastSyncAt: null,
        lastError: null,
      });
      ensureMailCron(result.accountId);
      ensureCalendarCron(result.accountId);
      void runMail(result.accountId).catch((err) => {
        logger.warn({ scope: 'microsoft-mail', err: (err as Error).message }, 'mail bootstrap sync failed');
      });
      void runCalendar(result.accountId).catch((err) => {
        logger.warn({ scope: 'microsoft-calendar', err: (err as Error).message }, 'calendar bootstrap sync failed');
      });
      return { ok: true, email: result.email, displayName: result.displayName };
    } catch (err) {
      const message =
        err instanceof OAuthConfigMissingError
          ? 'oauth-config-missing'
          : err instanceof Error
            ? err.message
            : String(err);
      logger.warn({ scope: 'microsoft-connect', err: message }, 'microsoft connect failed');
      return { ok: false, error: message };
    }
  }

  ipcMain.handle(CHANNELS.MICROSOFT_CONNECT, async () => {
    return await connectAndSeed();
  });

  ipcMain.handle(CHANNELS.MICROSOFT_STATUS, async (): Promise<MicrosoftIntegrationStatus> => {
    const db = dbHolder.db;
    const queueDepth = scheduler.queue.size + scheduler.queue.pending;
    if (!db) return { connected: false, tokenStatus: 'missing', queueDepth };
    const row = db
      .prepare(
        `SELECT account_id as accountId, display_email as email, display_label as displayLabel,
                last_synced_at, last_error, status
           FROM provider_account
          WHERE provider_key = 'microsoft'
          ORDER BY created_at DESC
          LIMIT 1`,
      )
      .get() as
      | {
          accountId: string;
          email: string;
          displayLabel?: string | null;
          last_synced_at?: string | null;
          last_error?: string | null;
          status?: string;
        }
      | undefined;
    return statusFromRow(row, queueDepth);
  });

  ipcMain.handle(CHANNELS.MICROSOFT_DISCONNECT, async () => {
    const db = dbHolder.db;
    if (!db) return { ok: true } as const;
    const rows = listProviderAccounts(db, 'microsoft');
    for (const row of rows) {
      stopAccountCrons(row.accountId);
      try {
        clearProviderTokens(`microsoft:${row.accountId}`);
      } catch {
        /* best effort */
      }
    }
    try {
      const tx = db.transaction(() => {
        db.prepare(`DELETE FROM provider_sync_state WHERE provider_key = 'microsoft'`).run();
        db.prepare(`DELETE FROM gmail_message WHERE provider_key = 'microsoft'`).run();
        db.prepare(`DELETE FROM calendar_event WHERE provider_key = 'microsoft'`).run();
        db.prepare(`DELETE FROM approval WHERE provider_key = 'microsoft'`).run();
        db.prepare(`DELETE FROM provider_account WHERE provider_key = 'microsoft'`).run();
      });
      tx();
    } catch (err) {
      logger.warn({ scope: 'microsoft-disconnect', err: (err as Error).message }, 'disconnect cleanup failed');
    }
    return { ok: true } as const;
  });

  ipcMain.handle(CHANNELS.MICROSOFT_FORCE_SYNC, async () => {
    const db = dbHolder.db;
    if (!db) return { ok: false, error: 'db-locked' } as const;
    const rows = listProviderAccounts(db, 'microsoft');
    if (rows.length === 0) return { ok: false, error: 'not-connected' } as const;
    try {
      for (const row of rows) {
        await runMail(row.accountId);
        await runCalendar(row.accountId);
      }
      return { ok: true } as const;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message } as const;
    }
  });

  bootstrapCrons();
}
