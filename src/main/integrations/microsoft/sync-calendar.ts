import type Database from 'better-sqlite3-multiple-ciphers';
import type PQueueImport from 'p-queue';
import type { Logger } from 'pino';
import { DeltaExpiredError, TokenInvalidError, TransientGraphError } from './errors';
import { listEventsDelta, normalizeCalendarItem, type MicrosoftCalendarClient } from './calendar';
import { setProviderAccountStatus, upsertProviderSyncState } from './provider-account';

type Db = Database.Database;

export interface MicrosoftCalendarSyncDeps {
  db: Db;
  accountId: string;
  client: MicrosoftCalendarClient;
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
          AND resource = 'calendar'`,
    )
    .get(accountId) as { cursor?: string | null } | undefined;
  return row?.cursor ?? null;
}

function writeRows(
  db: Db,
  accountId: string,
  rows: ReturnType<typeof normalizeCalendarItem>[],
  tombstones: string[],
  fetchedAt: string,
  cursor: string,
): void {
  const tx = db.transaction(() => {
    const upsert = db.prepare(
      `INSERT OR REPLACE INTO calendar_event
       (id, calendar_id, summary, location, start_at_utc, end_at_utc, start_date, end_date,
        start_timezone, attendees, status, recurring_id, updated_at, fetched_at,
        etag, i_cal_uid, sequence, organizer_email, organizer_self, recurrence_json,
        recurrence_unsupported, provider_key, account_id)
       VALUES (@id, @calendar_id, @summary, @location, @start_at_utc, @end_at_utc,
               @start_date, @end_date, @start_timezone, @attendees, @status,
               @recurring_id, @updated_at, @fetched_at,
               @etag, @i_cal_uid, @sequence, @organizer_email, @organizer_self, @recurrence_json,
               @recurrence_unsupported, 'microsoft', @account_id)`,
    );
    for (const row of rows) {
      upsert.run({ ...row, account_id: accountId });
    }
    if (tombstones.length > 0) {
      const del = db.prepare(
        `DELETE FROM calendar_event WHERE provider_key = 'microsoft' AND account_id = ? AND id = ?`,
      );
      for (const id of tombstones) {
        del.run(accountId, id);
      }
    }
    upsertProviderSyncState(db, {
      providerKey: 'microsoft',
      accountId,
      resource: 'calendar',
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

export async function tickCalendar(deps: MicrosoftCalendarSyncDeps): Promise<void> {
  const fetchedAt = (deps.now ?? (() => new Date()))().toISOString();
  const cursor = readCursor(deps.db, deps.accountId);
  try {
    const delta = await deps.scheduler.queue.add(() =>
      listEventsDelta(deps.client, { cursor }),
    );
    const rows = delta.items.map((item) => normalizeCalendarItem(item, fetchedAt));
    await deps.scheduler.queue.add(() =>
      writeRows(deps.db, deps.accountId, rows, delta.tombstones, fetchedAt, delta.cursor),
    );
  } catch (err) {
    if (err instanceof DeltaExpiredError) {
      deps.logger?.info?.({ scope: 'microsoft-calendar', accountId: deps.accountId }, 'calendar delta expired; refreshing');
      await fullResyncCalendarWindow(deps);
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

export async function fullResyncCalendarWindow(deps: MicrosoftCalendarSyncDeps): Promise<void> {
  const fetchedAt = (deps.now ?? (() => new Date()))().toISOString();
  const delta = await deps.scheduler.queue.add(() =>
    listEventsDelta(deps.client, { cursor: null }),
  );
  const rows = delta.items.map((item) => normalizeCalendarItem(item, fetchedAt));
  await deps.scheduler.queue.add(() =>
    writeRows(deps.db, deps.accountId, rows, delta.tombstones, fetchedAt, delta.cursor),
  );
}

