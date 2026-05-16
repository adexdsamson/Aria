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

  // ── Bootstrap: if gmail_account row exists, register cron now ──────────────
  try {
    const db = dbHolder.db;
    if (db) {
      const row = db
        .prepare('SELECT email FROM gmail_account WHERE id = 1')
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
      db.prepare(
        `INSERT OR REPLACE INTO gmail_account (id, email, history_id, last_synced_at, last_error, connected_at)
         VALUES (1, @email, NULL, NULL, NULL, @connected_at)`,
      ).run({ email: result.email, connected_at: nowIso });
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
      row = db
        .prepare('SELECT email, history_id, last_synced_at, last_error FROM gmail_account WHERE id = 1')
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
    };
  });

  // ── GMAIL_DISCONNECT ───────────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.GMAIL_DISCONNECT, async () => {
    stopCron();
    try { clearGoogleTokens('gmail'); } catch { /* best effort */ }
    const db = dbHolder.db;
    if (db) {
      try {
        const tx = db.transaction(() => {
          db.prepare('DELETE FROM gmail_account WHERE id = 1').run();
          db.prepare('DELETE FROM gmail_message').run();
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
