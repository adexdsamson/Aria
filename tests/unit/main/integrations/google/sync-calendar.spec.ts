/**
 * Plan 02-02 Task 2 — CalendarSync engine tests.
 *
 * Uses the same in-memory Db shim pattern as sync-gmail.spec.ts (the dual-build
 * pipeline makes real SQLCipher available, but the gmail spec established the
 * shim convention for engine-level unit tests; the CHECK constraint + real DB
 * cases live in calendar-tz.spec.ts).
 *
 * Quick task 260523-a5w — sync lifted off the dropped `calendar_account` base
 * table onto `provider_account` + `provider_sync_state` + `calendar_account_view`.
 * The shim reflects the new SQL surface; the assertions still inspect the
 * conceptual account state, just now read out of the lifted tables.
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
// In-memory Db shim (mirrors sync-gmail.spec.ts; 260523-a5w lift to
// provider_account + provider_sync_state)
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
      // calendar_account_view existence check (provider_account row probe).
      if (/^SELECT email FROM calendar_account_view WHERE email = \?/.test(s)) {
        return {
          get: (email: string) =>
            accountState.row && accountState.row.email === email
              ? { email: accountState.row.email }
              : undefined,
        };
      }
      // provider_sync_state cursor read.
      if (/^SELECT cursor[\s\S]*FROM provider_sync_state/.test(s)) {
        return {
          get: (_accountId: string) =>
            accountState.row ? { cursor: accountState.row.sync_token } : undefined,
        };
      }
      if (/^INSERT OR REPLACE INTO calendar_event/.test(s)) {
        return {
          run: (row: Record<string, unknown>) => {
            events.set(String(row.id), { ...row });
          },
        };
      }
      if (/^DELETE FROM calendar_event WHERE id = \?/.test(s)) {
        return {
          run: (id: string) => {
            events.delete(String(id));
          },
        };
      }
      // provider_sync_state cursor write (upsertProviderSyncState helper).
      if (/^INSERT OR REPLACE INTO provider_sync_state/.test(s)) {
        return {
          run: (
            _providerKey: string,
            _accountId: string,
            _resource: string,
            cursor: string | null,
            lastSyncAt: string | null,
            _lastError: string | null,
          ) => {
            if (!accountState.row) throw new Error('no calendar_account row to update');
            accountState.row.sync_token = cursor;
            if (lastSyncAt) accountState.row.last_synced_at = lastSyncAt;
            accountState.row.last_error = null;
          },
        };
      }
      // provider_account success-path UPDATE (clears last_error, bumps last_synced_at).
      if (/^UPDATE provider_account[\s\S]*last_error = NULL/.test(s)) {
        return {
          run: (lastSyncedAt: string, _accountId: string) => {
            if (accountState.row) {
              accountState.row.last_synced_at = lastSyncedAt;
              accountState.row.last_error = null;
            }
          },
        };
      }
      // provider_account error-path UPDATE (recordError).
      if (/^UPDATE provider_account[\s\S]*SET status = \?/.test(s)) {
        return {
          run: (_status: string, reason: string, _lastErrorAt: string, _accountId: string) => {
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

    const sync = createCalendarSync({ db: db as never, client, scheduler: { queue }, accountId: 'me@x.com' });
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

    const sync = createCalendarSync({ db: db as never, client, scheduler: { queue }, accountId: 'me@x.com' });
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

    const sync = createCalendarSync({ db: db as never, client, scheduler: { queue }, accountId: 'me@x.com' });
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

    const sync = createCalendarSync({ db: db as never, client, scheduler: { queue }, accountId: 'me@x.com' });
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

    const sync = createCalendarSync({ db: db as never, client, scheduler: { queue }, accountId: 'me@x.com' });
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

    const sync = createCalendarSync({ db: db as never, client, scheduler: { queue }, accountId: 'me@x.com' });
    await expect(sync.tick()).rejects.toThrow('simulated write failure');
    expect(db._inspect.events().size).toBe(0);
    expect(db._inspect.account()?.sync_token).toBe('st-keep');
  });

  it('Case 7 (UAT Gap 7) — cancelled event with start is a tombstone: not upserted', async () => {
    // Pre-Gap-7 contract was "upsert with status=cancelled". Post-Gap-7:
    // cancelled events are tombstones regardless of whether they still carry
    // start fields — incremental responses signal deletion this way. We assert
    // the row is NOT present after the tick.
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

    const sync = createCalendarSync({ db: db as never, client, scheduler: { queue }, accountId: 'me@x.com' });
    await sync.tick();

    expect(db._inspect.events().has('ev1')).toBe(false);
    expect(db._inspect.account()?.sync_token).toBe('st-2');
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
    const sync = createCalendarSync({ db: db as never, client, scheduler: { queue }, accountId: 'me@x.com' });
    await sync.tick();

    // ≥ 1 for listEvents + ≥ 1 for the DB transaction.
    expect(addSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('Case 9a (UAT Gap 6) — bootstrap pages through to nextSyncToken on page 3', async () => {
    const db = createInMemoryDb({
      email: 'me@x.com',
      sync_token: null,
      last_synced_at: null,
      last_error: null,
    });
    const client = makeFakeClient();
    client.listEventsWindow.mockResolvedValue({ items: [] });
    // Three-page bootstrap; nextSyncToken only on the last page (busy calendar).
    client.listEvents
      .mockResolvedValueOnce({ items: [timedEvent('b1')], nextPageToken: 'bp2' })
      .mockResolvedValueOnce({ items: [timedEvent('b2')], nextPageToken: 'bp3' })
      .mockResolvedValueOnce({ items: [timedEvent('b3')], nextSyncToken: 'st-paged' });

    const sync = createCalendarSync({ db: db as never, client, scheduler: { queue }, accountId: 'me@x.com' });
    await sync.tick();

    expect(client.listEvents).toHaveBeenCalledTimes(3);
    // pageToken progresses across the three calls.
    expect((client.listEvents.mock.calls[0]![0] as Record<string, unknown>).pageToken).toBeUndefined();
    expect((client.listEvents.mock.calls[1]![0] as Record<string, unknown>).pageToken).toBe('bp2');
    expect((client.listEvents.mock.calls[2]![0] as Record<string, unknown>).pageToken).toBe('bp3');
    expect(db._inspect.events().size).toBe(3);
    expect(db._inspect.account()?.sync_token).toBe('st-paged');
    expect(db._inspect.account()?.last_error).toBeNull();
  });

  it('Case 9b (UAT Gap 6) — empty-calendar bootstrap: single page with nextSyncToken and no items', async () => {
    const db = createInMemoryDb({
      email: 'me@x.com',
      sync_token: null,
      last_synced_at: null,
      last_error: null,
    });
    const client = makeFakeClient();
    client.listEventsWindow.mockResolvedValue({ items: [] });
    client.listEvents.mockResolvedValue({ items: [], nextSyncToken: 'st-empty' });

    const sync = createCalendarSync({ db: db as never, client, scheduler: { queue }, accountId: 'me@x.com' });
    await sync.tick();

    expect(client.listEvents).toHaveBeenCalledTimes(1);
    expect(db._inspect.events().size).toBe(0);
    expect(db._inspect.account()?.sync_token).toBe('st-empty');
    expect(db._inspect.account()?.last_error).toBeNull();
  });

  it('Case 9c (UAT Gap 6) — MAX_PAGES exhaustion records sync-token-bootstrap-paginated-overflow', async () => {
    const db = createInMemoryDb({
      email: 'me@x.com',
      sync_token: null,
      last_synced_at: null,
      last_error: null,
    });
    const client = makeFakeClient();
    client.listEventsWindow.mockResolvedValue({ items: [] });
    // Always return nextPageToken, never nextSyncToken → loop hits MAX_PAGES.
    client.listEvents.mockImplementation(async () => ({
      items: [timedEvent('overflow')],
      nextPageToken: 'never-ending',
    }));

    const sync = createCalendarSync({ db: db as never, client, scheduler: { queue }, accountId: 'me@x.com' });
    await sync.tick();

    // MAX_PAGES is 50 in the implementation.
    expect(client.listEvents).toHaveBeenCalledTimes(50);
    expect(db._inspect.account()?.last_error).toBe('sync-token-bootstrap-paginated-overflow');
    // sync_token NOT advanced — must remain null.
    expect(db._inspect.account()?.sync_token).toBeNull();
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

    const sync = createCalendarSync({ db: db as never, client, scheduler: { queue }, accountId: 'me@x.com' });
    await sync.tick();

    expect(client.listEvents).toHaveBeenCalledTimes(1);
    const callArg = client.listEvents.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArg.pageToken).toBeUndefined();
    expect(callArg.syncToken).toBeUndefined();
    expect(callArg.timeMin).toBeUndefined();
    expect(callArg.timeMax).toBeUndefined();
    expect(callArg.singleEvents).toBeUndefined();
  });

  // ==========================================================================
  // UAT Gap 7 — CHECK-constraint failure on cancelled / malformed events.
  // ==========================================================================

  it('Case 10a (UAT Gap 7) — bootstrap response with a cancelled (no-start) event: NOT inserted, no throw', async () => {
    const db = createInMemoryDb({
      email: 'me@x.com',
      sync_token: null,
      last_synced_at: null,
      last_error: null,
    });
    const client = makeFakeClient();
    // Bootstrap window page returns a tombstone alongside a real event.
    client.listEventsWindow.mockResolvedValue({
      items: [
        timedEvent('keep'),
        { id: 'cancelled-no-start', status: 'cancelled' } as CalendarEventRaw,
      ],
    });
    client.listEvents.mockResolvedValue({ items: [], nextSyncToken: 'st-bs' });

    const sync = createCalendarSync({ db: db as never, client, scheduler: { queue }, accountId: 'me@x.com' });
    await expect(sync.tick()).resolves.toBeUndefined();

    // Only the real event is inserted; tombstone is silently dropped.
    expect(db._inspect.events().size).toBe(1);
    expect(db._inspect.events().has('keep')).toBe(true);
    expect(db._inspect.events().has('cancelled-no-start')).toBe(false);
    expect(db._inspect.account()?.sync_token).toBe('st-bs');
  });

  it('Case 10b (UAT Gap 7) — incremental cancelled event whose id matches existing row: row deleted', async () => {
    const db = createInMemoryDb({
      email: 'me@x.com',
      sync_token: 'st-prev',
      last_synced_at: null,
      last_error: null,
    });
    // Pre-seed an existing row that the incremental tick will tombstone.
    // We do this by running a first tick with the event present, then a
    // second tick that cancels it.
    const client = makeFakeClient();
    client.listEvents
      .mockResolvedValueOnce({ items: [timedEvent('to-cancel')], nextSyncToken: 'st-mid' })
      .mockResolvedValueOnce({
        items: [{ id: 'to-cancel', status: 'cancelled' } as CalendarEventRaw],
        nextSyncToken: 'st-final',
      });

    const sync = createCalendarSync({ db: db as never, client, scheduler: { queue }, accountId: 'me@x.com' });
    await sync.tick();
    expect(db._inspect.events().has('to-cancel')).toBe(true);

    await sync.tick();
    expect(db._inspect.events().has('to-cancel')).toBe(false);
    expect(db._inspect.account()?.sync_token).toBe('st-final');
  });

  it('Case 10c (UAT Gap 7) — confirmed event with NO start field: skipped with warn log', async () => {
    const db = createInMemoryDb({
      email: 'me@x.com',
      sync_token: 'st',
      last_synced_at: null,
      last_error: null,
    });
    const warn = vi.fn();
    const client = makeFakeClient();
    client.listEvents.mockResolvedValue({
      items: [
        timedEvent('ok'),
        { id: 'malformed', status: 'confirmed' } as CalendarEventRaw,
      ],
      nextSyncToken: 'st-2',
    });

    const sync = createCalendarSync({
      db: db as never,
      client,
      scheduler: { queue },
      accountId: 'me@x.com',
      logger: { info: vi.fn(), warn, debug: vi.fn() },
    });
    await sync.tick();

    expect(db._inspect.events().has('ok')).toBe(true);
    expect(db._inspect.events().has('malformed')).toBe(false);
    // Assert the warn line fired for the malformed event.
    const warnedForMalformed = warn.mock.calls.some((call) => {
      const ctx = call[0] as Record<string, unknown> | undefined;
      return ctx?.event_id === 'malformed' && ctx?.reason === 'no-start';
    });
    expect(warnedForMalformed).toBe(true);
  });
});
