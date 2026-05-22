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
import { CHANNELS, type CalendarEventDto, type CalendarIntegrationStatus } from '../../shared/ipc-contract';
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
import { pendingCatchup } from '../lifecycle/pendingCatchup';
import { trayBus } from '../tray/index';

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
      // Phase 12 / Plan 12-02 — sealed-DB guard (BG-04).
      const db = dbHolder.db;
      if (!db) {
        pendingCatchup.add('calendar-sync');
        trayBus.setBadge();
        return;
      }
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

  // ── Bootstrap: if a Google provider_account with calendar capability
  // exists, register cron now. Reads via the legacy `calendar_account_view`
  // (migration 014) over provider_account.
  try {
    const db = dbHolder.db;
    if (db) {
      const row = db
        .prepare('SELECT email FROM calendar_account_view LIMIT 1')
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
      // Upsert into provider_account (migration 014 dropped the legacy
      // calendar_account base table). Merges the `calendar:true` capability
      // without clobbering any existing `mail:true` set by Gmail connect.
      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO provider_account (
             account_id, provider_key, display_email, status,
             last_synced_at, last_error, last_error_at, created_at, capabilities_json
           ) VALUES (
             @email, 'google', @email, 'ok',
             NULL, NULL, NULL, @connected_at,
             json_object('mail', json('false'), 'calendar', json('true'))
           )
           ON CONFLICT(provider_key, account_id) DO UPDATE SET
             display_email = excluded.display_email,
             status = 'ok',
             last_error = NULL,
             last_error_at = NULL,
             capabilities_json = json_set(
               provider_account.capabilities_json, '$.calendar', json('true')
             )`,
        ).run({ email: result.email, connected_at: nowIso });
        db.prepare(
          `INSERT OR REPLACE INTO provider_sync_state (
             provider_key, account_id, resource, cursor, last_sync_at, last_error
           ) VALUES ('google', @email, 'calendar', NULL, NULL, NULL)`,
        ).run({ email: result.email });
      });
      tx();
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
      // sync_token now lives in provider_sync_state.cursor (migration 014).
      row = db
        .prepare(
          `SELECT pa.account_id AS email,
                  pss.cursor AS sync_token,
                  pa.last_synced_at AS last_synced_at,
                  pa.last_error AS last_error
             FROM provider_account pa
             LEFT JOIN provider_sync_state pss
               ON pss.provider_key = pa.provider_key
              AND pss.account_id = pa.account_id
              AND pss.resource = 'calendar'
            WHERE pa.provider_key = 'google'
              AND json_extract(pa.capabilities_json, '$.calendar') = 1
            ORDER BY pa.created_at ASC
            LIMIT 1`,
        )
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
        // Disconnect = drop the `calendar` capability bit. Migration 014
        // replaced the singleton calendar_account with a provider_account
        // row; if the same Google account also has mail=true, we keep the
        // row so Gmail stays connected (SC3 — per-kind disconnect scope).
        const tx = db.transaction(() => {
          db.prepare(
            `UPDATE provider_account
                SET capabilities_json = json_set(capabilities_json, '$.calendar', json('false'))
              WHERE provider_key = 'google'
                AND json_extract(capabilities_json, '$.calendar') = 1`,
          ).run();
          db.prepare(
            `DELETE FROM provider_account
              WHERE provider_key = 'google'
                AND json_extract(capabilities_json, '$.mail') = 0
                AND json_extract(capabilities_json, '$.calendar') = 0`,
          ).run();
          db.prepare(
            `DELETE FROM provider_sync_state
              WHERE provider_key = 'google' AND resource = 'calendar'`,
          ).run();
          db.prepare(`DELETE FROM calendar_event WHERE provider_key = 'google' OR provider_key IS NULL`).run();
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

  ipcMain.handle(
    CHANNELS.CALENDAR_LIST_EVENTS_RANGE,
    async (_event, req: { startUtc: string; endUtc: string; accountIds?: string[] }) => {
      const db = dbHolder.db;
      if (!db) return { error: 'db-locked' } as const;
      const accountIds = Array.isArray(req.accountIds) ? req.accountIds.filter(Boolean) : [];
      const accountFilter =
        accountIds.length > 0
          ? `AND e.account_id IN (${accountIds.map((_, index) => `@account${index}`).join(', ')})`
          : '';
      const params: Record<string, string> = { startUtc: req.startUtc, endUtc: req.endUtc };
      accountIds.forEach((accountId, index) => {
        params[`account${index}`] = accountId;
      });
      const rows = db.prepare(
        `SELECT e.id,
                e.calendar_id as calendarId,
                e.summary,
                e.location,
                e.start_at_utc as startAtUtc,
                e.end_at_utc as endAtUtc,
                e.start_date as startDate,
                e.end_date as endDate,
                e.start_timezone as startTimezone,
                e.status,
                e.recurring_id as recurringId,
                e.recurrence_json as recurrenceJson,
                e.recurrence_unsupported as recurrenceUnsupported,
                e.provider_key as providerKey,
                e.account_id as accountId,
                p.display_email as accountDisplayEmail,
                p.display_label as accountDisplayLabel,
                p.display_color as accountDisplayColor
           FROM calendar_event e
           JOIN provider_account p
             ON p.provider_key = e.provider_key
            AND p.account_id = e.account_id
          WHERE p.status IN ('ok', 'degraded')
            AND e.provider_key IS NOT NULL
            AND e.account_id IS NOT NULL
            AND (
              (e.start_at_utc IS NOT NULL AND e.start_at_utc < @endUtc AND COALESCE(e.end_at_utc, e.start_at_utc) >= @startUtc)
              OR (e.start_date IS NOT NULL)
            )
            ${accountFilter}
          ORDER BY COALESCE(e.start_at_utc, e.start_date) ASC`,
      ).all(params) as Array<Omit<CalendarEventDto, 'recurrenceUnsupported' | 'webLink'> & { recurrenceUnsupported: 0 | 1 }>;
      return {
        rows: rows.map((row) => ({
          ...row,
          recurrenceUnsupported: row.recurrenceUnsupported === 1,
          webLink: null,
        })),
      } as const;
    },
  );
}
