/**
 * Plan 02-02 Task 3 — Calendar IPC handlers + 15-minute cron registration.
 *
 * Channels (mirror Gmail symmetry from Plan 02-01):
 *   CALENDAR_CONNECT       — run OAuth loopback (reuses connectGoogle('calendar')),
 *                            INSERT OR REPLACE calendar_account, kick off
 *                            fullResyncWindow via CalendarSync.tick().
 *   CALENDAR_STATUS        — CalendarIntegrationStatus from row + queue depth.
 *   CALENDAR_DISCONNECT    — stop cron, clearGoogleTokens('calendar'), delete
 *                            calendar_account, truncate calendar_event.
 *   CALENDAR_FORCE_SYNC    — manual CalendarSync.tick().
 *
 * Cron: 'calendar-sync' every 15 minutes (cron expression every 15 min).
 * Wraps tick() in try/catch so sync failures NEVER crash the app. Suspend/
 * resume via powerMonitor.registerLifecycleCallbacks (XCUT-01 — no back-fire
 * on resume; reuses the API extended by Plan 02-01 Task 3).
 */
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import cron from 'node-cron';
import { CHANNELS, type CalendarIntegrationStatus } from '../../shared/ipc-contract';
import type { SchedulerHandle } from '../lifecycle/scheduler';
import type { DbHolder } from './onboarding';
import { registerLifecycleCallbacks } from '../lifecycle/powerMonitor';
import {
  connectGoogle,
  getOAuth2Client,
  TokenInvalidError,
  OAuthConfigMissingError,
} from '../integrations/google/auth';
import { clearGoogleTokens, getGoogleTokens } from '../secrets/safeStorage';
import { createCalendarClient, type CalendarClient } from '../integrations/google/calendar';
import { CalendarSync, createCalendarSync } from '../integrations/google/sync-calendar';

export interface CalendarHandlerDeps {
  logger: Logger;
  dbHolder: DbHolder;
  scheduler: SchedulerHandle;
  /** Override for tests: build a CalendarClient without going through googleapis. */
  buildClient?: () => CalendarClient | null;
  /** Override for tests: short-circuit OAuth. */
  doConnect?: () => Promise<{ ok: true; email: string }>;
}

const CRON_KEY = 'calendar-sync';
const CRON_SCHEDULE = '*/15 * * * *';

export function registerCalendarHandlers(ipcMain: IpcMain, deps: CalendarHandlerDeps): void {
  const { logger, dbHolder, scheduler } = deps;

  function buildSync(): CalendarSync | null {
    const db = dbHolder.db;
    if (!db) return null;
    let client: CalendarClient | null = null;
    if (deps.buildClient) {
      client = deps.buildClient();
    } else {
      const oauth = getOAuth2Client('calendar');
      if (!oauth) return null;
      client = createCalendarClient(oauth);
    }
    if (!client) return null;
    return createCalendarSync({ db, client, scheduler, logger });
  }

  async function runTick(): Promise<{ ok: true } | { ok: false; error: string }> {
    const sync = buildSync();
    if (!sync) return { ok: false, error: 'not-connected' };
    try {
      await sync.tick();
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ scope: 'calendar-sync', err: message }, 'calendar tick failed');
      return { ok: false, error: err instanceof TokenInvalidError ? `token-${err.reason}` : message };
    }
  }

  function ensureCron(): void {
    if (scheduler.cronRegistry.has(CRON_KEY)) return;
    const task = cron.schedule(CRON_SCHEDULE, () => {
      void runTick().catch((err) => {
        logger.warn({ scope: 'calendar-sync', err: (err as Error).message }, 'cron tick error');
      });
    });
    scheduler.cronRegistry.set(CRON_KEY, task);
    logger.info({ scope: 'calendar-sync', schedule: CRON_SCHEDULE }, 'calendar-sync cron registered');
  }

  function stopCron(): void {
    const task = scheduler.cronRegistry.get(CRON_KEY);
    if (task) {
      task.stop();
      scheduler.cronRegistry.delete(CRON_KEY);
    }
  }

  // ── Suspend/resume coalescing (XCUT-01) ────────────────────────────────────
  registerLifecycleCallbacks({
    onSuspend: () => {
      const task = scheduler.cronRegistry.get(CRON_KEY);
      if (task) {
        task.stop();
        logger.info({ scope: 'calendar-sync', event: 'suspend' }, 'paused cron on suspend');
      }
    },
    onResume: () => {
      const task = scheduler.cronRegistry.get(CRON_KEY);
      if (task) {
        task.start();
        logger.info({ scope: 'calendar-sync', event: 'resume' }, 'resumed cron on resume');
      }
    },
  });

  // ── Bootstrap: if calendar_account row exists, register cron now ───────────
  try {
    const db = dbHolder.db;
    if (db) {
      const row = db
        .prepare('SELECT email FROM calendar_account WHERE id = 1')
        .get() as { email: string } | undefined;
      if (row) ensureCron();
    }
  } catch (err) {
    logger.warn(
      { scope: 'calendar-sync', err: (err as Error).message },
      'calendar_account bootstrap check skipped',
    );
  }

  // ── CALENDAR_CONNECT ───────────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.CALENDAR_CONNECT, async () => {
    try {
      const result = deps.doConnect ? await deps.doConnect() : await connectGoogle('calendar');
      const db = dbHolder.db;
      if (!db) return { ok: false, error: 'db-locked' };
      const nowIso = new Date().toISOString();
      db.prepare(
        `INSERT OR REPLACE INTO calendar_account (id, email, calendar_id, sync_token, last_synced_at, last_error, connected_at)
         VALUES (1, @email, 'primary', NULL, NULL, NULL, @connected_at)`,
      ).run({ email: result.email, connected_at: nowIso });
      ensureCron();
      // Kick off bootstrap fullResyncWindow without awaiting.
      void runTick().catch(() => { /* runTick already logs */ });
      return { ok: true, email: result.email } as const;
    } catch (err) {
      const message =
        err instanceof OAuthConfigMissingError
          ? 'oauth-config-missing'
          : err instanceof Error
            ? err.message
            : String(err);
      logger.warn({ scope: 'calendar-connect', err: message }, 'calendar connect failed');
      return { ok: false, error: message } as const;
    }
  });

  // ── CALENDAR_STATUS ────────────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.CALENDAR_STATUS, async (): Promise<CalendarIntegrationStatus> => {
    const db = dbHolder.db;
    const queueDepth = scheduler.queue.size + scheduler.queue.pending;
    if (!db) {
      return { connected: false, tokenStatus: 'missing', queueDepth };
    }
    let row:
      | { email: string; sync_token: string | null; last_synced_at: string | null; last_error: string | null }
      | undefined;
    try {
      row = db
        .prepare('SELECT email, sync_token, last_synced_at, last_error FROM calendar_account WHERE id = 1')
        .get() as typeof row;
    } catch {
      row = undefined;
    }
    if (!row) {
      return { connected: false, tokenStatus: 'missing', queueDepth };
    }
    const hasToken = !!getGoogleTokens('calendar');
    let tokenStatus: CalendarIntegrationStatus['tokenStatus'];
    if (!hasToken) tokenStatus = 'missing';
    else if (row.last_error?.startsWith('token-expired')) tokenStatus = 'expired';
    else if (row.last_error?.startsWith('token-revoked')) tokenStatus = 'revoked';
    else tokenStatus = 'ok';
    return {
      connected: true,
      email: row.email,
      lastSyncedAt: row.last_synced_at ?? undefined,
      lastError: row.last_error ?? undefined,
      tokenStatus,
      queueDepth,
    };
  });

  // ── CALENDAR_DISCONNECT ────────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.CALENDAR_DISCONNECT, async () => {
    stopCron();
    try { clearGoogleTokens('calendar'); } catch { /* best effort */ }
    const db = dbHolder.db;
    if (db) {
      try {
        const tx = db.transaction(() => {
          db.prepare('DELETE FROM calendar_account WHERE id = 1').run();
          db.prepare('DELETE FROM calendar_event').run();
        });
        tx();
      } catch (err) {
        logger.warn({ scope: 'calendar-disconnect', err: (err as Error).message }, 'disconnect cleanup failed');
      }
    }
    return { ok: true } as const;
  });

  // ── CALENDAR_FORCE_SYNC ────────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.CALENDAR_FORCE_SYNC, async () => {
    return await runTick();
  });
}
