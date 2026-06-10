/**
 * Plan 20-06 — WhatsApp IPC handler registrar.
 *
 * WHATSAPP_CHANNELS is the single source of truth for the removeHandler loop
 * in main/index.ts bootPoll (IPC double-register safety — ipcMain.handle THROWS
 * on a 2nd registration, it does NOT override). If you add or remove an
 * `ipcMain.handle(CHANNELS.WHATSAPP_*, …)` below, update the array.
 *
 * Pattern mirrors knowledge-folders.ts exactly:
 *   - Export WHATSAPP_CHANNELS (5 invoke channels — push channels are excluded)
 *   - registerWhatsAppHandlers(deps) registers real handlers post-unlock
 *   - Every handler uses notReady() `if (!db) return { error:'DB_NOT_OPEN' }`
 *
 * The 2 push channels (WHATSAPP_QR_UPDATE, WHATSAPP_STATE_CHANGED) are NOT in
 * this array — they are registered in pushOnlyChannels in ipc/index.ts and are
 * never invoked by the renderer (main → renderer via webContents.send).
 */
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import { CHANNELS, WhatsAppSetTrackedReq } from '../../shared/ipc-contract';
import type { DbHolder } from './onboarding';
import type { SchedulerHandle } from '../lifecycle/scheduler';
import type { WhatsAppSessionManager } from '../whatsapp/session-manager';
import { handleProviderAccountDisconnect } from './provider-accounts';

export interface WhatsAppHandlersDeps {
  ipcMain: IpcMain;
  logger: Logger;
  dbHolder: DbHolder;
  scheduler: SchedulerHandle;
  manager: WhatsAppSessionManager;
}

/**
 * Canonical list of every invoke channel registerWhatsAppHandlers() registers.
 * SINGLE SOURCE OF TRUTH for the removeHandler loop in main/index.ts bootPoll.
 * Push-only channels (WHATSAPP_QR_UPDATE, WHATSAPP_STATE_CHANGED) are excluded
 * — they are managed separately in pushOnlyChannels (ipc/index.ts).
 */
export const WHATSAPP_CHANNELS = [
  CHANNELS.WHATSAPP_LINK,
  CHANNELS.WHATSAPP_DISCONNECT,
  CHANNELS.WHATSAPP_LIST_GROUPS,
  CHANNELS.WHATSAPP_SET_TRACKED,
  CHANNELS.WHATSAPP_STATUS,
] as const;

function notReady(): { error: string } {
  return { error: 'DB_NOT_OPEN' };
}

export function registerWhatsAppHandlers(deps: WhatsAppHandlersDeps): void {
  const { ipcMain, logger, dbHolder, manager } = deps;

  // aria:whatsapp:link — WA-01: start the QR link flow
  ipcMain.handle(CHANNELS.WHATSAPP_LINK, async () => {
    const db = dbHolder.db;
    if (!db) return notReady();
    try {
      await manager.startLink();
      return { ok: true as const };
    } catch (err) {
      logger.warn({ scope: 'whatsapp-ipc', event: 'link.fail', err });
      return { ok: false, error: String(err) };
    }
  });

  // aria:whatsapp:disconnect — WA-04: stop session + cascade delete
  ipcMain.handle(CHANNELS.WHATSAPP_DISCONNECT, async (_e, req: unknown) => {
    const db = dbHolder.db;
    if (!db) return notReady();
    const r = req as { accountId?: string } | undefined;
    const accountId = r?.accountId ?? '';
    try {
      await handleProviderAccountDisconnect({
        db,
        manager,
        providerKey: 'whatsapp',
        accountId,
      });
      return { ok: true as const };
    } catch (err) {
      logger.warn({ scope: 'whatsapp-ipc', event: 'disconnect.fail', err });
      return { ok: false, error: String(err) };
    }
  });

  // aria:whatsapp:list-groups — WA-05: return tracked/untracked group list
  ipcMain.handle(CHANNELS.WHATSAPP_LIST_GROUPS, async () => {
    const db = dbHolder.db;
    if (!db) return notReady();
    try {
      const rows = db
        .prepare<[], {
          jid: string;
          display_name: string;
          tracked: number;
          member_count: number | null;
        }>(
          `SELECT jid, display_name, tracked, member_count
             FROM whatsapp_group
            ORDER BY display_name ASC`,
        )
        .all();
      const groups = rows.map((r) => ({
        jid: r.jid,
        displayName: r.display_name,
        tracked: r.tracked === 1,
        memberCount: r.member_count ?? null,
      }));
      return { groups };
    } catch (err) {
      logger.warn({ scope: 'whatsapp-ipc', event: 'list-groups.fail', err });
      return { error: String(err) };
    }
  });

  // aria:whatsapp:set-tracked — WA-05: toggle whatsapp_group.tracked
  ipcMain.handle(CHANNELS.WHATSAPP_SET_TRACKED, async (_e, req: unknown) => {
    const db = dbHolder.db;
    if (!db) return notReady();
    const parsed = WhatsAppSetTrackedReq.safeParse(req);
    if (!parsed.success) {
      return { ok: false, error: 'INVALID_REQUEST', issues: parsed.error.issues };
    }
    const { jid, tracked } = parsed.data;
    try {
      db.prepare<[number, string]>(
        `UPDATE whatsapp_group SET tracked = ? WHERE jid = ?`,
      ).run(tracked ? 1 : 0, jid);
      logger.info({
        scope: 'whatsapp-ipc',
        event: 'set-tracked',
        jid,
        tracked,
      });
      return { ok: true as const };
    } catch (err) {
      logger.warn({ scope: 'whatsapp-ipc', event: 'set-tracked.fail', jid, err });
      return { ok: false, error: String(err) };
    }
  });

  // aria:whatsapp:status — WA-03: return WhatsAppStatusDto
  ipcMain.handle(CHANNELS.WHATSAPP_STATUS, async () => {
    const db = dbHolder.db;
    if (!db) return notReady();
    try {
      const status = manager.getStatus();
      // Read the JID (D-11: account_id = creds.me.id) from provider_account
      const row = db
        .prepare<[], { account_id: string }>(
          `SELECT account_id FROM provider_account
            WHERE provider_key = 'whatsapp'
            LIMIT 1`,
        )
        .get();
      const accountId = row?.account_id ?? null;
      const displayNumber = accountId
        ? accountId.replace(/[@:].*/g, '').replace(/^\+?/, '+')
        : null;
      return {
        status,
        accountId,
        displayNumber,
      };
    } catch (err) {
      logger.warn({ scope: 'whatsapp-ipc', event: 'status.fail', err });
      return { error: String(err) };
    }
  });
}
