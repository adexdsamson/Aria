import type Database from 'better-sqlite3-multiple-ciphers';
import type PQueueImport from 'p-queue';
import type { Logger } from 'pino';
import { DeltaExpiredError, TokenInvalidError, TransientGraphError } from './errors';
import { listMessagesDelta, normalizeMailItem, type MicrosoftMailClient } from './mail';
import { setProviderAccountStatus, upsertProviderSyncState } from './provider-account';

type Db = Database.Database;

export interface MicrosoftMailSyncDeps {
  db: Db;
  accountId: string;
  client: MicrosoftMailClient;
  scheduler: { queue: InstanceType<typeof PQueueImport> };
  logger?: Pick<Logger, 'info' | 'warn'>;
  now?: () => Date;
}

function readCursor(db: Db, accountId: string): string | null {
  const row = db
    .prepare(
      `SELECT cursor
         FROM provider_sync_state
        WHERE provider_key = 'microsoft'
          AND account_id = ?
          AND resource = 'mail'`,
    )
    .get(accountId) as { cursor?: string | null } | undefined;
  return row?.cursor ?? null;
}

function writeRows(db: Db, accountId: string, rows: ReturnType<typeof normalizeMailItem>[], tombstones: string[], fetchedAt: string, cursor: string): void {
  const tx = db.transaction(() => {
    const upsert = db.prepare(
      `INSERT OR REPLACE INTO gmail_message
       (id, thread_id, from_addr, subject, snippet, received_at, label_ids, is_unread,
        is_important, history_id, fetched_at, provider_key, account_id)
       VALUES (@id, @thread_id, @from_addr, @subject, @snippet, @received_at, @label_ids,
               @is_unread, @is_important, @history_id, @fetched_at, 'microsoft', @account_id)`,
    );
    for (const row of rows) {
      upsert.run({ ...row, account_id: accountId });
    }
    if (tombstones.length > 0) {
      const del = db.prepare(
        `DELETE FROM gmail_message WHERE provider_key = 'microsoft' AND account_id = ? AND id = ?`,
      );
      for (const id of tombstones) {
        del.run(accountId, id);
      }
    }
    upsertProviderSyncState(db, {
      providerKey: 'microsoft',
      accountId,
      resource: 'mail',
      cursor,
      lastSyncAt: fetchedAt,
      lastError: null,
    });
    setProviderAccountStatus(db, {
      providerKey: 'microsoft',
      accountId,
      status: 'ok',
      lastError: null,
      lastSyncedAt: fetchedAt,
    });
  });
  tx();
}

export async function tickMail(deps: MicrosoftMailSyncDeps): Promise<void> {
  const fetchedAt = (deps.now ?? (() => new Date()))().toISOString();
  const cursor = readCursor(deps.db, deps.accountId);
  try {
    const delta = await deps.scheduler.queue.add(() =>
      listMessagesDelta(deps.client, { cursor }),
    );
    const rows = delta.items.map((item) => normalizeMailItem(item, fetchedAt));
    await deps.scheduler.queue.add(() =>
      writeRows(deps.db, deps.accountId, rows, delta.tombstones, fetchedAt, delta.cursor),
    );
  } catch (err) {
    if (err instanceof DeltaExpiredError) {
      deps.logger?.info?.({ scope: 'microsoft-mail', accountId: deps.accountId }, 'mail delta expired; refreshing');
      await fullResyncMailWindow(deps);
      return;
    }
    if (err instanceof TokenInvalidError) {
      setProviderAccountStatus(deps.db, {
        providerKey: 'microsoft',
        accountId: deps.accountId,
        status: 'needs-auth',
        lastError: `token-${err.reason}`,
      });
      throw err;
    }
    if (err instanceof TransientGraphError) {
      setProviderAccountStatus(deps.db, {
        providerKey: 'microsoft',
        accountId: deps.accountId,
        status: 'degraded',
        lastError: err.message,
      });
      throw err;
    }
    throw err;
  }
}

export async function fullResyncMailWindow(deps: MicrosoftMailSyncDeps): Promise<void> {
  const fetchedAt = (deps.now ?? (() => new Date()))().toISOString();
  const delta = await deps.scheduler.queue.add(() =>
    listMessagesDelta(deps.client, { cursor: null }),
  );
  const rows = delta.items.map((item) => normalizeMailItem(item, fetchedAt));
  await deps.scheduler.queue.add(() =>
    writeRows(deps.db, deps.accountId, rows, delta.tombstones, fetchedAt, delta.cursor),
  );
}

