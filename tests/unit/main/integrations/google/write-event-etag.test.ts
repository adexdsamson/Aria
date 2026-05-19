/**
 * Plan 04-01 Task 3 — applyCalendarChange etag-mismatch path.
 *
 * (f) When the wrapper translates Google's 412 to EtagMismatchError, the
 *     chokepoint writes a `failed` audit row whose google_error contains
 *     'etag-mismatch', leaves the approval in 'approved' state, and
 *     rethrows the original EtagMismatchError unchanged so the consumer
 *     (Plan 04-03) can surface a refresh prompt.
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
  EtagMismatchError,
  type CalendarClient,
} from '../../../../../src/main/integrations/google/calendar';

const MIGRATIONS_DIR = path.resolve(
  __dirname,
  '../../../../../src/main/db/migrations',
);

function freshDb(): Db {
  const dataDir = createTempUserDataDir('aria-cal-write-etag');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

describe('applyCalendarChange (etag mismatch)', () => {
  let db: Db;

  beforeEach(() => {
    db = freshDb();
  });
  afterEach(() => {
    closeDb(db);
  });

  it('(f) EtagMismatchError → failed audit row + state unchanged + rethrow', async () => {
    const id = insertApproval(db, {
      kind: 'calendar_change',
      calendar_event_id: 'evt-weekly-parent-1',
      calendar_action: 'move',
      recurring_scope: 'all',
      before_json: JSON.stringify({
        recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TU'],
        startUtc: '2026-05-26T15:00:00.000Z',
        etag: '"stale-etag"',
      }),
      after_json: JSON.stringify({ summary: 'x' }),
    });
    transitionTo(db, id, 'generating');
    transitionTo(db, id, 'ready');
    transitionTo(db, id, 'approved', { approval_path: 'explicit' });

    const patchEvent = vi.fn(async () => {
      throw new EtagMismatchError('events.patch returned 412: etag mismatch');
    });
    const client: CalendarClient = {
      listEvents: vi.fn() as never,
      listEventsWindow: vi.fn() as never,
      getCalendarMetadata: vi.fn() as never,
      patchEvent,
      insertEvent: vi.fn() as never,
      eventsInstances: vi.fn() as never,
      freebusyQuery: vi.fn() as never,
      getCalendarSettings: vi.fn() as never,
    };

    await expect(
      applyCalendarChange(db, id, { buildCalendarClient: async () => client }),
    ).rejects.toBeInstanceOf(EtagMismatchError);

    expect(getApproval(db, id)!.state).toBe('approved');

    const audits = db
      .prepare(
        `SELECT phase, google_error FROM calendar_action_log
         WHERE approval_id = ? ORDER BY id ASC`,
      )
      .all(id) as Array<{ phase: string; google_error: string | null }>;
    expect(audits.map((r) => r.phase)).toEqual(['pre_write', 'failed']);
    expect(audits[1]!.google_error).toContain('etag-mismatch');
  });
});
