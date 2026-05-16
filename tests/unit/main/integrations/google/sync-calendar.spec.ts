/**
 * Plan 02-02 Task 2 — CalendarSync engine tests.
 *
 * Uses the same in-memory Db shim pattern as sync-gmail.spec.ts (the dual-build
 * pipeline makes real SQLCipher available, but the gmail spec established the
 * shim convention for engine-level unit tests; the CHECK constraint + real DB
 * cases live in calendar-tz.spec.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PQueueImport from 'p-queue';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PQueue: typeof PQueueImport = ((PQueueImport as any).default ?? PQueueImport) as typeof PQueueImport;

import { createCalendarSync } from '../../../../../src/main/integrations/google/sync-calendar';
import {
  SyncTokenInvalidatedError,
  type CalendarClient,
  type CalendarEventRaw,
} from '../../../../../src/main/integrations/google/calendar';
import { TokenInvalidError } from '../../../../../src/main/integrations/google/auth';

// ============================================================================
// In-memory Db shim (mirrors sync-gmail.spec.ts)
// ============================================================================

interface AccountRow {
  email: string;
  sync_token: string | null;
  last_synced_at: string | null;
  last_error: string | null;
}

function createInMemoryDb(initial?: AccountRow) {
  const accountState: { row: AccountRow | null } = { row: initial ? { ...initial } : null };
  const events = new Map<string, Record<string, unknown>>();

  const db = {
    prepare(sql: string) {
      const s = sql.trim();
      if (/^SELECT email, sync_token FROM calendar_account/.test(s)) {
        return {
          get: () =>
            accountState.row
              ? { email: accountState.row.email, sync_token: accountState.row.sync_token }
              : undefined,
        };
      }
      if (/^INSERT OR REPLACE INTO calendar_event/.test(s)) {
        return {
          run: (row: Record<string, unknown>) => {
            events.set(String(row.id), { ...row });
          },
        };
      }
      if (/^UPDATE calendar_account\s+SET sync_token/.test(s)) {
        return {
          run: (row: { sync_token: string; last_synced_at: string }) => {
            if (!accountState.row) throw new Error('no calendar_account row to update');
            accountState.row.sync_token = row.sync_token;
            accountState.row.last_synced_at = row.last_synced_at;
            accountState.row.last_error = null;
          },
        };
      }
      if (/^UPDATE calendar_account SET last_error/.test(s)) {
        return {
          run: (reason: string) => {
            if (accountState.row) accountState.row.last_error = reason;
          },
        };
      }
      throw new Error(`in-memory db: unhandled SQL: ${s}`);
    },
    transaction<T extends (...args: unknown[]) => unknown>(fn: T): T {
      return ((...args: unknown[]) => {
        const accountSnapshot = accountState.row ? { ...accountState.row } : null;
        const messagesSnapshot = new Map(events);
        try {
          return fn(...args);
        } catch (err) {
          accountState.row = accountSnapshot;
          events.clear();
          for (const [k, v] of messagesSnapshot) events.set(k, v);
          throw err;
        }
      }) as T;
    },
    _inspect: {
      account: () => accountState.row,
      events: () => events,
    },
  };
  return db;
}

// ============================================================================
// Fixtures
// ============================================================================

function timedEvent(id: string, dt = '2026-05-20T09:00:00Z'): CalendarEventRaw {
  return { id, summary: `Event ${id}`, start: { dateTime: dt }, end: { dateTime: dt }, updated: dt };
}

function allDayEvent(id: string, date = '2026-05-20'): CalendarEventRaw {
  return { id, summary: `All-day ${id}`, start: { date }, end: { date: '2026-05-21' }, updated: '2026-05-19T00:00:00Z' };
}

function makeFakeClient(): CalendarClient & {
  listEvents: ReturnType<typeof vi.fn>;
  listEventsWindow: ReturnType<typeof vi.fn>;
  getCalendarMetadata: ReturnType<typeof vi.fn>;
} {
  return {
    listEvents: vi.fn(),
    listEventsWindow: vi.fn(),
    getCalendarMetadata: vi.fn(),
  } as never;
}

// ============================================================================
// Tests
// ============================================================================

describe('CalendarSync.tick', () => {
  let queue: InstanceType<typeof PQueueImport>;

  beforeEach(() => {
    queue = new PQueue({ concurrency: 1 });
  });

  it('Case 1 — first tick, no sync_token: fullResyncWindow path bootstraps fresh token', async () => {
    const db = createInMemoryDb({
      email: 'me@x.com',
      sync_token: null,
      last_synced_at: null,
      last_error: null,
    });
    const client = makeFakeClient();
    client.listEventsWindow.mockResolvedValue({
      items: [timedEvent('a'), timedEvent('b'), allDayEvent('c')],
    });
    client.listEvents.mockResolvedValue({ items: [], nextSyncToken: 'st-fresh' });

    const sync = createCalendarSync({ db: db as never, client, scheduler: { queue } });
    await sync.tick();

    expect(db._inspect.events().size).toBe(3);
    expect(db._inspect.account()?.sync_token).toBe('st-fresh');
  });

  it('Case 2 — incremental tick happy path: 1 new event + nextSyncToken advances', async () => {
    const db = createInMemoryDb({
      email: 'me@x.com',
      sync_token: 'st-1',
      last_synced_at: null,
      last_error: null,
    });
    const client = makeFakeClient();
    client.listEvents.mockResolvedValue({ items: [timedEvent('e1')], nextSyncToken: 'st-2' });

    const sync = createCalendarSync({ db: db as never, client, scheduler: { queue } });
    await sync.tick();

    expect(db._inspect.events().has('e1')).toBe(true);
    expect(db._inspect.account()?.sync_token).toBe('st-2');
  });

  it('Case 3 — multi-page: caller paginates; sync_token only updates on final page', async () => {
    const db = createInMemoryDb({
      email: 'me@x.com',
      sync_token: 'st-prev',
      last_synced_at: null,
      last_error: null,
    });
    const client = makeFakeClient();
    client.listEvents
      .mockResolvedValueOnce({ items: [timedEvent('p1')], nextPageToken: 'p2' })
      .mockResolvedValueOnce({ items: [timedEvent('p2-evt')], nextSyncToken: 'st-3' });

    const sync = createCalendarSync({ db: db as never, client, scheduler: { queue } });
    await sync.tick();

    expect(client.listEvents).toHaveBeenCalledTimes(2);
    expect(db._inspect.events().size).toBe(2);
    expect(db._inspect.account()?.sync_token).toBe('st-3');
  });

  it('Case 4 — SyncTokenInvalidatedError → fullResyncWindow recovery', async () => {
    const db = createInMemoryDb({
      email: 'me@x.com',
      sync_token: 'old',
      last_synced_at: null,
      last_error: null,
    });
    const client = makeFakeClient();
    // First call (incremental) throws 410.
    client.listEvents.mockImplementationOnce(() => {
      throw new SyncTokenInvalidatedError('410 gone');
    });
    // Bootstrap step 2 call returns fresh token.
    client.listEvents.mockResolvedValueOnce({ items: [], nextSyncToken: 'st-new' });
    client.listEventsWindow.mockResolvedValue({ items: [timedEvent('r1')] });

    const sync = createCalendarSync({ db: db as never, client, scheduler: { queue } });
    await sync.tick();

    expect(db._inspect.events().has('r1')).toBe(true);
    expect(db._inspect.account()?.sync_token).toBe('st-new');
  });

  it('Case 5 — TokenInvalidError sets last_error=token-expired and re-throws', async () => {
    const db = createInMemoryDb({
      email: 'me@x.com',
      sync_token: 'st',
      last_synced_at: null,
      last_error: null,
    });
    const client = makeFakeClient();
    client.listEvents.mockRejectedValue(new TokenInvalidError({ reason: 'expired' }));

    const sync = createCalendarSync({ db: db as never, client, scheduler: { queue } });
    await expect(sync.tick()).rejects.toBeInstanceOf(TokenInvalidError);
    expect(db._inspect.account()?.last_error).toBe('token-expired');
  });

  it('Case 6 — atomicity: forced upsert failure rolls back both rows and sync_token', async () => {
    const db = createInMemoryDb({
      email: 'me@x.com',
      sync_token: 'st-keep',
      last_synced_at: null,
      last_error: null,
    });
    const client = makeFakeClient();
    client.listEvents.mockResolvedValue({ items: [timedEvent('mX')], nextSyncToken: 'st-bad' });

    const origPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      if (/^INSERT OR REPLACE INTO calendar_event/.test(sql.trim())) {
        return { run: () => { throw new Error('simulated write failure'); } };
      }
      return origPrepare(sql);
    };

    const sync = createCalendarSync({ db: db as never, client, scheduler: { queue } });
    await expect(sync.tick()).rejects.toThrow('simulated write failure');
    expect(db._inspect.events().size).toBe(0);
    expect(db._inspect.account()?.sync_token).toBe('st-keep');
  });

  it('Case 7 — cancelled event still upserts with status=cancelled', async () => {
    const db = createInMemoryDb({
      email: 'me@x.com',
      sync_token: 'st',
      last_synced_at: null,
      last_error: null,
    });
    const client = makeFakeClient();
    client.listEvents.mockResolvedValue({
      items: [
        {
          id: 'ev1',
          status: 'cancelled',
          start: { dateTime: '2026-05-20T09:00:00Z' },
          end: { dateTime: '2026-05-20T10:00:00Z' },
        },
      ],
      nextSyncToken: 'st-2',
    });

    const sync = createCalendarSync({ db: db as never, client, scheduler: { queue } });
    await sync.tick();

    expect(db._inspect.events().get('ev1')?.status).toBe('cancelled');
  });

  it('Case 8 — queue routing: scheduler.queue.add called for API call AND for DB transaction', async () => {
    const db = createInMemoryDb({
      email: 'me@x.com',
      sync_token: 'st',
      last_synced_at: null,
      last_error: null,
    });
    const client = makeFakeClient();
    client.listEvents.mockResolvedValue({ items: [timedEvent('eq')], nextSyncToken: 'st-2' });

    const addSpy = vi.spyOn(queue, 'add');
    const sync = createCalendarSync({ db: db as never, client, scheduler: { queue } });
    await sync.tick();

    // ≥ 1 for listEvents + ≥ 1 for the DB transaction.
    expect(addSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('Case 9 — M2 bootstrap call shape: listEvents({pageToken: undefined}) with NO syncToken/timeMin/timeMax/singleEvents', async () => {
    const db = createInMemoryDb({
      email: 'me@x.com',
      sync_token: null,
      last_synced_at: null,
      last_error: null,
    });
    const client = makeFakeClient();
    client.listEventsWindow.mockResolvedValue({ items: [] });
    client.listEvents.mockResolvedValue({ items: [], nextSyncToken: 'st-fresh' });

    const sync = createCalendarSync({ db: db as never, client, scheduler: { queue } });
    await sync.tick();

    expect(client.listEvents).toHaveBeenCalledTimes(1);
    const callArg = client.listEvents.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArg.pageToken).toBeUndefined();
    expect(callArg.syncToken).toBeUndefined();
    expect(callArg.timeMin).toBeUndefined();
    expect(callArg.timeMax).toBeUndefined();
    expect(callArg.singleEvents).toBeUndefined();
  });
});
