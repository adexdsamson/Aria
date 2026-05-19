import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import { CHANNELS, type TodoistIntegrationStatus } from '../../shared/ipc-contract';
import type { DbHolder } from './onboarding';
import { setProviderTokens, getProviderTokens, clearProviderTokens } from '../secrets/safeStorage';
import { createTodoistClient, type TodoistClient } from '../integrations/todoist/client';
import { syncTodoistTasks } from '../integrations/todoist/sync-tasks';
import { pushApprovedMeetingActions } from '../integrations/todoist/push-actions';

export interface TodoistHandlerDeps {
  logger: Logger;
  dbHolder: DbHolder;
  buildClient?: (token: string) => TodoistClient;
}

const TOKEN_KEY = 'todoist:default';

export function registerTodoistHandlers(ipcMain: IpcMain, deps: TodoistHandlerDeps): void {
  const { dbHolder, logger } = deps;
  const makeClient = (token: string) => deps.buildClient?.(token) ?? createTodoistClient(token);

  function statusFromDb(queueDepth = 0): TodoistIntegrationStatus {
    const db = dbHolder.db;
    const hasToken = Boolean(getProviderTokens(TOKEN_KEY));
    if (!db) return { connected: false, tokenStatus: hasToken ? 'ok' : 'missing', queueDepth };
    const row = db.prepare(
      `SELECT last_synced_at AS lastSyncedAt, last_error AS lastError, status
         FROM provider_account
        WHERE provider_key = 'todoist' AND account_id = 'default'`,
    ).get() as { lastSyncedAt: string | null; lastError: string | null; status: string } | undefined;
    if (!row && !hasToken) return { connected: false, tokenStatus: 'missing', queueDepth };
    return {
      connected: Boolean(hasToken),
      tokenStatus: hasToken ? 'ok' : 'missing',
      lastSyncedAt: row?.lastSyncedAt ?? undefined,
      lastError: row?.lastError ?? undefined,
      queueDepth,
    };
  }

  ipcMain.handle(CHANNELS.TODOIST_CONNECT_TOKEN, async (_e, req: unknown) => {
    const token = typeof (req as { token?: unknown })?.token === 'string' ? (req as { token: string }).token.trim() : '';
    if (!token) return { ok: false as const, error: 'token-required' };
    const db = dbHolder.db;
    if (!db) return { error: 'DB_NOT_OPEN' };
    try {
      await makeClient(token).validateToken();
      setProviderTokens(TOKEN_KEY, token);
      const nowIso = new Date().toISOString();
      db.prepare(
        `INSERT INTO provider_account (
           account_id, provider_key, display_email, status, capabilities_json, created_at, last_error
         )
         VALUES ('default', 'todoist', 'Todoist', 'ok', '{"tasks":true}', @nowIso, NULL)
         ON CONFLICT(provider_key, account_id) DO UPDATE SET
           status = 'ok',
           last_error = NULL,
           capabilities_json = '{"tasks":true}'`,
      ).run({ nowIso });
      return { ok: true as const };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ scope: 'todoist-connect', err: message }, 'todoist token validation failed');
      return { ok: false as const, error: message };
    }
  });

  ipcMain.handle(CHANNELS.TODOIST_STATUS, async () => statusFromDb());

  ipcMain.handle(CHANNELS.TODOIST_DISCONNECT, async () => {
    clearProviderTokens(TOKEN_KEY);
    const db = dbHolder.db;
    if (db) {
      db.transaction(() => {
        db.prepare("DELETE FROM provider_sync_state WHERE provider_key = 'todoist' AND account_id = 'default'").run();
        db.prepare("DELETE FROM provider_account WHERE provider_key = 'todoist' AND account_id = 'default'").run();
      })();
    }
    return { ok: true as const };
  });

  ipcMain.handle(CHANNELS.TODOIST_FORCE_SYNC, async () => {
    const db = dbHolder.db;
    const token = getProviderTokens(TOKEN_KEY);
    if (!db) return { error: 'DB_NOT_OPEN' };
    if (!token) return { ok: false as const, error: 'not-connected' };
    try {
      const result = await syncTodoistTasks({ db, client: makeClient(token) });
      return { ok: true as const, count: result.count };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      db.prepare(
        `UPDATE provider_account SET status = 'degraded', last_error = ?, last_error_at = ?
          WHERE provider_key = 'todoist' AND account_id = 'default'`,
      ).run(message, new Date().toISOString());
      return { ok: false as const, error: message };
    }
  });

  ipcMain.handle(CHANNELS.TODOIST_PUSH_APPROVED_ACTIONS, async (_e, req: unknown) => {
    const approvalId = (req as { approvalId?: string })?.approvalId;
    const db = dbHolder.db;
    const token = getProviderTokens(TOKEN_KEY);
    if (!db) return { error: 'DB_NOT_OPEN' };
    if (!approvalId) return { error: 'approvalId-required' };
    if (!token) return { error: 'TODOIST_NOT_CONNECTED' };
    const result = await pushApprovedMeetingActions({ db, approvalId, client: makeClient(token) });
    return result;
  });
}
