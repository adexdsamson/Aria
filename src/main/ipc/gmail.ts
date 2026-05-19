/**
 * Plan 02-01 Task 3 — Gmail IPC handlers + 5-minute cron registration.
 *
 * Channels:
 *   GMAIL_CONNECT       — run OAuth loopback, INSERT OR REPLACE gmail_account,
 *                         kick off the 7-day backfill via GmailSync.tick().
 *   GMAIL_STATUS        — read gmail_account row + scheduler.queue depth →
 *                         GmailIntegrationStatus.
 *   GMAIL_DISCONNECT    — stop the cron entry, clearGoogleTokens, delete
 *                         gmail_account + truncate gmail_message.
 *   GMAIL_FORCE_SYNC    — manual GmailSync.tick().
 *
 * Cron: registers `gmail-sync` in `scheduler.cronRegistry` running every 5
 * minutes (cron expression: every-5-min). The cron callback wraps `tick()` in try/catch so
 * a sync failure NEVER crashes the app. Suspend/resume integration is via
 * `powerMonitor.registerLifecycleCallbacks`: stop on suspend, start on resume
 * (no back-fire — XCUT-01).
 */
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import cron from 'node-cron';
import { CHANNELS, type GmailIntegrationStatus } from '../../shared/ipc-contract';
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
import { createGmailClient, type GmailClient } from '../integrations/google/gmail';
import { isVerificationPending } from '../integrations/google/sendLog';
import { GmailSync, createGmailSync } from '../integrations/google/sync-gmail';

export interface GmailHandlerDeps {
  logger: Logger;
  dbHolder: DbHolder;
  scheduler: SchedulerHandle;
  /** Override for tests: build a GmailClient without going through googleapis. */
  buildClient?: () => GmailClient | null;
  /** Override for tests: short-circuit OAuth. */
  doConnect?: () => Promise<{ ok: true; email: string }>;
}

const CRON_KEY = 'gmail-sync';
const CRON_SCHEDULE = '*/5 * * * *';

export function registerGmailHandlers(ipcMain: IpcMain, deps: GmailHandlerDeps): void {
  const { logger, dbHolder, scheduler } = deps;

  function buildSync(): GmailSync | null {
    const db = dbHolder.db;
    if (!db) return null;
    let client: GmailClient | null = null;
    if (deps.buildClient) {
      client = deps.buildClient();
    } else {
      const oauth = getOAuth2Client('gmail');
      if (!oauth) return null;
      client = createGmailClient(oauth);
    }
    if (!client) return null;
    return createGmailSync({ db, client, scheduler, logger });
  }

  async function runTick(): Promise<{ ok: true } | { ok: false; error: string }> {
    const sync = buildSync();
    if (!sync) return { ok: false, error: 'not-connected' };
    try {
      await sync.tick();
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ scope: 'gmail-sync', err: message }, 'gmail tick failed');
      return { ok: false, error: err instanceof TokenInvalidError ? `token-${err.reason}` : message };
    }
  }

  function ensureCron(): void {
    if (scheduler.cronRegistry.has(CRON_KEY)) return;
    const task = cron.schedule(
      CRON_SCHEDULE,
      () => {
        // Fire-and-log; never throw out of cron.
        void runTick().catch((err) => {
          logger.warn({ scope: 'gmail-sync', err: (err as Error).message }, 'cron tick error');
        });
      },
    );
    scheduler.cronRegistry.set(CRON_KEY, task);
    logger.info({ scope: 'gmail-sync', schedule: CRON_SCHEDULE }, 'gmail-sync cron registered');
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
        logger.info({ scope: 'gmail-sync', event: 'suspend' }, 'paused cron on suspend');
      }
    },
    onResume: () => {
      const task = scheduler.cronRegistry.get(CRON_KEY);
      if (task) {
        task.start();
        logger.info({ scope: 'gmail-sync', event: 'resume' }, 'resumed cron on resume');
      }
    },
  });

  // ── Bootstrap: if a Google provider_account with mail capability exists,
  // register cron now. Reads via the legacy `gmail_account_view` (migration 014)
  // which projects rows from `provider_account` where capabilities_json.mail=1.
  try {
    const db = dbHolder.db;
    if (db) {
      const row = db
        .prepare('SELECT email FROM gmail_account_view LIMIT 1')
        .get() as { email: string } | undefined;
      if (row) ensureCron();
    }
  } catch (err) {
    // Migration may not have been applied yet — that's fine; connect handler
    // will register the cron after the row is created.
    logger.warn(
      { scope: 'gmail-sync', err: (err as Error).message },
      'gmail_account bootstrap check skipped',
    );
  }

  // ── GMAIL_CONNECT ──────────────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.GMAIL_CONNECT, async () => {
    try {
      const result = deps.doConnect ? await deps.doConnect() : await connectGoogle('gmail');
      const db = dbHolder.db;
      if (!db) return { ok: false, error: 'db-locked' };
      const nowIso = new Date().toISOString();
      // Upsert into provider_account (migration 014 dropped the legacy
      // gmail_account base table). Merges the `mail:true` capability without
      // clobbering any existing `calendar:true` set by a prior Calendar connect.
      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO provider_account (
             account_id, provider_key, display_email, status,
             last_synced_at, last_error, last_error_at, created_at, capabilities_json
           ) VALUES (
             @email, 'google', @email, 'ok',
             NULL, NULL, NULL, @connected_at,
             json_object('mail', json('true'), 'calendar', json('false'))
           )
           ON CONFLICT(provider_key, account_id) DO UPDATE SET
             display_email = excluded.display_email,
             status = 'ok',
             last_error = NULL,
             last_error_at = NULL,
             capabilities_json = json_set(
               provider_account.capabilities_json, '$.mail', json('true')
             )`,
        ).run({ email: result.email, connected_at: nowIso });
        db.prepare(
          `INSERT OR REPLACE INTO provider_sync_state (
             provider_key, account_id, resource, cursor, last_sync_at, last_error
           ) VALUES ('google', @email, 'mail', NULL, NULL, NULL)`,
        ).run({ email: result.email });
      });
      tx();
      ensureCron();
      // Kick off the 7d backfill (do NOT await — IPC should return quickly).
      void runTick().catch(() => {/* runTick already logs */});
      return { ok: true, email: result.email } as const;
    } catch (err) {
      const message =
        err instanceof OAuthConfigMissingError
          ? 'oauth-config-missing'
          : err instanceof Error
            ? err.message
            : String(err);
      logger.warn({ scope: 'gmail-connect', err: message }, 'gmail connect failed');
      return { ok: false, error: message } as const;
    }
  });

  // ── GMAIL_STATUS ───────────────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.GMAIL_STATUS, async (): Promise<GmailIntegrationStatus> => {
    const db = dbHolder.db;
    const queueDepth = scheduler.queue.size + scheduler.queue.pending;
    if (!db) {
      return { connected: false, tokenStatus: 'missing', queueDepth };
    }
    let row:
      | { email: string; history_id: string | null; last_synced_at: string | null; last_error: string | null }
      | undefined;
    try {
      // history_id now lives in provider_sync_state.cursor (migration 014
      // dropped the legacy gmail_account table). Read both in one shot.
      row = db
        .prepare(
          `SELECT pa.account_id AS email,
                  pss.cursor AS history_id,
                  pa.last_synced_at AS last_synced_at,
                  pa.last_error AS last_error
             FROM provider_account pa
             LEFT JOIN provider_sync_state pss
               ON pss.provider_key = pa.provider_key
              AND pss.account_id = pa.account_id
              AND pss.resource = 'mail'
            WHERE pa.provider_key = 'google'
              AND json_extract(pa.capabilities_json, '$.mail') = 1
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
    const hasToken = !!getGoogleTokens('gmail');
    let tokenStatus: GmailIntegrationStatus['tokenStatus'];
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
      verificationPending: isVerificationPending(),
    };
  });

  // ── GMAIL_DISCONNECT ───────────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.GMAIL_DISCONNECT, async () => {
    stopCron();
    try { clearGoogleTokens('gmail'); } catch { /* best effort */ }
    const db = dbHolder.db;
    if (db) {
      try {
        // Disconnect = drop the `mail` capability bit. Migration 014 replaced
        // the singleton gmail_account with a row in provider_account; if the
        // same Google account also has calendar=true, we keep the row so
        // Calendar stays connected (SC3 — disconnects are scoped per kind).
        const tx = db.transaction(() => {
          db.prepare(
            `UPDATE provider_account
                SET capabilities_json = json_set(capabilities_json, '$.mail', json('false'))
              WHERE provider_key = 'google'
                AND json_extract(capabilities_json, '$.mail') = 1`,
          ).run();
          db.prepare(
            `DELETE FROM provider_account
              WHERE provider_key = 'google'
                AND json_extract(capabilities_json, '$.mail') = 0
                AND json_extract(capabilities_json, '$.calendar') = 0`,
          ).run();
          db.prepare(
            `DELETE FROM provider_sync_state
              WHERE provider_key = 'google' AND resource = 'mail'`,
          ).run();
          db.prepare(`DELETE FROM gmail_message WHERE provider_key = 'google' OR provider_key IS NULL`).run();
        });
        tx();
      } catch (err) {
        logger.warn({ scope: 'gmail-disconnect', err: (err as Error).message }, 'disconnect cleanup failed');
      }
    }
    return { ok: true } as const;
  });

  // ── GMAIL_FORCE_SYNC ───────────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.GMAIL_FORCE_SYNC, async () => {
    return await runTick();
  });
}
