/**
 * Plan 04-01 Task 3 — applyCalendarChange unit tests.
 *
 * Covers:
 *   (a) assertApproved-throws when state != 'approved' → zero client calls
 *   (b) happy path scope='all' → 1 patch call, transitions to 'sent',
 *       2 audit rows (pre_write + post_write)
 *   (c) happy path scope='this' with instance id (contains '_') → accepted
 *   (d) scope='this' without '_' → InvalidInstanceIdError, zero client calls
 *   (e) Google API failure → failed audit row + state stays 'approved' +
 *       rethrow
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb, type Db } from '../../../../../src/main/db/connect';
import { runMigrations } from '../../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../../setup';
import {
  insertApproval,
  transitionTo,
  getApproval,
} from '../../../../../src/main/approvals/persist';
import { applyCalendarChange } from '../../../../../src/main/integrations/write-event';
import {
  InvalidInstanceIdError,
  type CalendarClient,
} from '../../../../../src/main/integrations/google/calendar';
import { ApprovalGateError } from '../../../../../src/main/approvals/gate';

const MIGRATIONS_DIR = path.resolve(
  __dirname,
  '../../../../../src/main/db/migrations',
);

function freshDb(): Db {
  const dataDir = createTempUserDataDir('aria-cal-write');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

interface SeedOpts {
  scope?: 'this' | 'future' | 'all';
  eventId?: string;
  before?: { parentId?: string; recurrence?: string[]; etag?: string; startUtc: string };
  after?: Record<string, unknown>;
  state?: 'pending' | 'approved';
}

function seedCalendarChange(db: Db, opts: SeedOpts = {}): string {
  const before = opts.before ?? { startUtc: '2026-05-20T10:00:00.000Z' };
  const after = opts.after ?? { startUtc: '2026-05-20T11:00:00.000Z' };
  const id = insertApproval(db, {
    kind: 'calendar_change',
    calendar_event_id: opts.eventId ?? 'evt_20260520T100000Z',
    calendar_action: 'move',
    recurring_scope: opts.scope ?? 'this',
    before_json: JSON.stringify(before),
    after_json: JSON.stringify(after),
  });
  if (opts.state === 'approved' || opts.state === undefined) {
    transitionTo(db, id, 'generating');
    transitionTo(db, id, 'ready');
    transitionTo(db, id, 'approved', { approval_path: 'explicit' });
  }
  return id;
}

function makeFakeClient(opts: {
  patchOk?: boolean;
  patchError?: Error;
  insertOk?: boolean;
} = {}): { client: CalendarClient; patchEvent: ReturnType<typeof vi.fn>; insertEvent: ReturnType<typeof vi.fn> } {
  const patchOk = opts.patchOk ?? true;
  const insertOk = opts.insertOk ?? true;
  const patchEvent = vi.fn(async (args: { eventId: string }) => {
    if (!patchOk) throw opts.patchError ?? new Error('patch-failed');
    return { id: args.eventId, etag: '"new-etag-1"' };
  });
  const insertEvent = vi.fn(async () => {
    if (!insertOk) throw new Error('insert-failed');
    return { id: 'evt-new-series-1', etag: '"new-etag-2"' };
  });
  const client: CalendarClient = {
    listEvents: vi.fn() as never,
    listEventsWindow: vi.fn() as never,
    getCalendarMetadata: vi.fn() as never,
    patchEvent,
    insertEvent,
    eventsInstances: vi.fn() as never,
    freebusyQuery: vi.fn() as never,
    getCalendarSettings: vi.fn() as never,
  };
  return { client, patchEvent, insertEvent };
}

function auditRows(db: Db, approvalId: string): Array<{ phase: string; google_error: string | null; google_etag: string | null }> {
  return db
    .prepare(
      `SELECT phase, google_error, google_etag FROM calendar_action_log
       WHERE approval_id = ? ORDER BY id ASC`,
    )
    .all(approvalId) as Array<{ phase: string; google_error: string | null; google_etag: string | null }>;
}

describe('applyCalendarChange', () => {
  let db: Db;

  beforeEach(() => {
    db = freshDb();
  });
  afterEach(() => {
    closeDb(db);
  });

  it('(a) throws ApprovalGateError when approval is not approved; zero client calls', async () => {
    const id = seedCalendarChange(db, { state: 'pending' });
    const { client, patchEvent, insertEvent } = makeFakeClient();
    await expect(
      applyCalendarChange(db, id, { buildCalendarClient: async () => client }),
    ).rejects.toBeInstanceOf(ApprovalGateError);
    expect(patchEvent).not.toHaveBeenCalled();
    expect(insertEvent).not.toHaveBeenCalled();
    // State unchanged.
    expect(getApproval(db, id)!.state).toBe('pending');
  });

  it("(b) scope='all' happy path: 1 patch call, sent, 2 audit rows", async () => {
    const id = seedCalendarChange(db, {
      scope: 'all',
      eventId: 'evt-weekly-parent-1',
      before: {
        recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TU'],
        startUtc: '2026-05-26T15:00:00.000Z',
        etag: '"old-etag"',
      },
      after: { summary: 'Renamed standup' },
    });
    const { client, patchEvent, insertEvent } = makeFakeClient();
    const res = await applyCalendarChange(db, id, { buildCalendarClient: async () => client });
    expect(res.ok).toBe(true);
    expect(patchEvent).toHaveBeenCalledTimes(1);
    expect(insertEvent).not.toHaveBeenCalled();
    expect(patchEvent.mock.calls[0]![0]).toMatchObject({
      eventId: 'evt-weekly-parent-1',
      sendUpdates: 'none',
      ifMatch: '"old-etag"',
    });
    expect(getApproval(db, id)!.state).toBe('sent');

    const audits = auditRows(db, id);
    expect(audits.length).toBe(2);
    expect(audits[0]!.phase).toBe('pre_write');
    expect(audits[1]!.phase).toBe('post_write');
    expect(audits[1]!.google_etag).toBe('"new-etag-1"');
  });

  it("(c) scope='this' with instance id (contains '_') is accepted", async () => {
    const id = seedCalendarChange(db, {
      scope: 'this',
      eventId: 'evt-weekly-parent-1_20260526T150000Z',
      before: {
        parentId: 'evt-weekly-parent-1',
        startUtc: '2026-05-26T15:00:00.000Z',
        etag: '"inst-etag"',
      },
      after: { startUtc: '2026-05-26T16:00:00.000Z' },
    });
    const { client, patchEvent } = makeFakeClient();
    await applyCalendarChange(db, id, { buildCalendarClient: async () => client });
    expect(patchEvent).toHaveBeenCalledTimes(1);
    expect(patchEvent.mock.calls[0]![0].eventId).toBe('evt-weekly-parent-1_20260526T150000Z');
    expect(getApproval(db, id)!.state).toBe('sent');
  });

  it("(d) scope='this' without '_' in id → InvalidInstanceIdError, zero client calls", async () => {
    const id = seedCalendarChange(db, {
      scope: 'this',
      eventId: 'evt-weekly-parent-1',
      before: {
        parentId: 'evt-weekly-parent-1',
        startUtc: '2026-05-26T15:00:00.000Z',
      },
    });
    const { client, patchEvent, insertEvent } = makeFakeClient();
    await expect(
      applyCalendarChange(db, id, { buildCalendarClient: async () => client }),
    ).rejects.toBeInstanceOf(InvalidInstanceIdError);
    expect(patchEvent).not.toHaveBeenCalled();
    expect(insertEvent).not.toHaveBeenCalled();
    expect(getApproval(db, id)!.state).toBe('approved');
  });

  it('(e) Google API failure → failed audit row, state stays approved, rethrow', async () => {
    const id = seedCalendarChange(db, {
      scope: 'all',
      eventId: 'evt-weekly-parent-1',
      before: {
        recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TU'],
        startUtc: '2026-05-26T15:00:00.000Z',
      },
      after: { summary: 'x' },
    });
    const { client, patchEvent } = makeFakeClient({
      patchOk: false,
      patchError: new Error('boom-google-failed'),
    });
    await expect(
      applyCalendarChange(db, id, { buildCalendarClient: async () => client }),
    ).rejects.toThrow(/boom-google-failed/);
    expect(patchEvent).toHaveBeenCalledTimes(1);
    expect(getApproval(db, id)!.state).toBe('approved');

    const audits = auditRows(db, id);
    // pre_write written before API call, then failed.
    expect(audits.map((r) => r.phase)).toEqual(['pre_write', 'failed']);
    expect(audits[1]!.google_error).toContain('boom-google-failed');
  });
});
