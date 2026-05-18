/**
 * Plan 04-03 Task 3a — proposeCalendarChange orchestrator tests.
 *
 * Covers all 6 result branches:
 *   1. cancel-not-in-v1 refusal
 *   2. multi-attendee refusal
 *   3. no-match refusal
 *   4. multiple-matches clarification
 *   5. success without conflicts
 *   6. success with conflicts
 *
 * Stubs parseIntent via deps.intentFn; stubs CalendarClient with an in-memory
 * fake; uses a real SQLCipher DB seeded with calendar_event + scheduling_rules.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb, type Db } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';
import { proposeCalendarChange } from '../../../../src/main/scheduling/propose';
import { IntentRefusedError } from '../../../../src/main/scheduling/intent';
import type { CalendarClient } from '../../../../src/main/integrations/google/calendar';
import { getApproval } from '../../../../src/main/approvals/persist';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

const USER = 'me@example.com';

function freshDb(): Db {
  const dataDir = createTempUserDataDir('aria-propose');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

function fakeClient(busy: Array<{ start: string; end: string }> = []): CalendarClient {
  return {
    listEvents: vi.fn(),
    listEventsWindow: vi.fn(),
    getCalendarMetadata: vi.fn(),
    patchEvent: vi.fn(),
    insertEvent: vi.fn(),
    eventsInstances: vi.fn().mockResolvedValue([]),
    freebusyQuery: vi.fn().mockResolvedValue({ calendars: { primary: { busy } } }),
    getCalendarSettings: vi.fn().mockResolvedValue({ timeZone: 'UTC' }),
  } as unknown as CalendarClient;
}

function seedEvent(
  db: Db,
  id: string,
  opts: {
    summary?: string;
    startUtc?: string;
    endUtc?: string;
    attendees?: Array<{ email: string; self?: boolean }>;
    organizerEmail?: string;
    organizerSelf?: 0 | 1;
    recurringId?: string | null;
  } = {},
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO calendar_event
     (id, calendar_id, summary, location, start_at_utc, end_at_utc, start_date, end_date,
      start_timezone, attendees, status, recurring_id, updated_at, fetched_at,
      etag, i_cal_uid, sequence, organizer_email, organizer_self, recurrence_json)
     VALUES (?, 'primary', ?, NULL, ?, ?, NULL, NULL,
             'UTC', ?, 'confirmed', ?, ?, ?,
             'etag-1', NULL, NULL, ?, ?, NULL)`,
  ).run(
    id,
    opts.summary ?? '3pm sync',
    opts.startUtc ?? '2026-05-18T15:00:00.000Z',
    opts.endUtc ?? '2026-05-18T16:00:00.000Z',
    JSON.stringify(opts.attendees ?? []),
    opts.recurringId ?? null,
    now,
    now,
    opts.organizerEmail ?? USER,
    opts.organizerSelf ?? 1,
  );
}

describe('proposeCalendarChange — 6 branches', () => {
  let db: Db;
  beforeEach(() => {
    db = freshDb();
  });
  afterEach(() => {
    closeDb(db);
  });

  it('(1) cancel-not-in-v1 refusal', async () => {
    const result = await proposeCalendarChange('cancel my 3pm', {
      db,
      client: fakeClient(),
      userEmail: USER,
      intentFn: async () => {
        throw new IntentRefusedError('cancel-not-in-v1');
      },
      nowIso: '2026-05-18T12:00:00.000Z',
    });
    expect(result).toMatchObject({ refused: true, code: 'cancel-not-in-v1' });
  });

  it('(2) multi-attendee refusal', async () => {
    seedEvent(db, 'ev1', {
      attendees: [{ email: USER, self: true }, { email: 'bob@external.com' }],
    });
    const result = await proposeCalendarChange('move my 3pm to Thursday', {
      db,
      client: fakeClient(),
      userEmail: USER,
      intentFn: async () => ({
        action: 'move',
        target: { eventRef: 'my 3pm' },
        when: { nlWhen: 'Thursday' },
      }),
      nowIso: '2026-05-18T12:00:00.000Z',
    });
    expect(result).toMatchObject({ refused: true, code: 'multi-attendee' });
  });

  it('(3) no-match refusal', async () => {
    // No events seeded.
    const result = await proposeCalendarChange('move my 3pm to Thursday', {
      db,
      client: fakeClient(),
      userEmail: USER,
      intentFn: async () => ({
        action: 'move',
        target: { eventRef: 'my 3pm' },
        when: { nlWhen: 'Thursday' },
      }),
      nowIso: '2026-05-18T12:00:00.000Z',
    });
    expect(result).toMatchObject({ refused: true, code: 'no-match' });
  });

  it('(4) multiple-matches clarification', async () => {
    seedEvent(db, 'ev1', { summary: 'Sync A', startUtc: '2026-05-18T15:00:00.000Z' });
    seedEvent(db, 'ev2', { summary: 'Sync B', startUtc: '2026-05-18T15:15:00.000Z' });
    const result = await proposeCalendarChange('move my 3pm to Thursday', {
      db,
      client: fakeClient(),
      userEmail: USER,
      intentFn: async () => ({
        action: 'move',
        target: { eventRef: 'my 3pm' },
        when: { nlWhen: 'Thursday' },
      }),
      nowIso: '2026-05-18T12:00:00.000Z',
    });
    expect(result).toHaveProperty('needsClarification', true);
    expect((result as { candidates: unknown[] }).candidates).toHaveLength(2);
  });

  it('(5) success with no conflicts → ProposeResult, approval row state=ready', async () => {
    seedEvent(db, 'ev1');
    const result = await proposeCalendarChange('move my 3pm to Thursday', {
      db,
      client: fakeClient(),
      userEmail: USER,
      intentFn: async () => ({
        action: 'move',
        target: { eventRef: 'my 3pm' },
        when: { nlWhen: 'Thursday' },
      }),
      nowIso: '2026-05-18T12:00:00.000Z',
    });
    expect(result).toHaveProperty('approvalId');
    const r = result as { approvalId: string; primaryFeasible: boolean; conflicts: unknown[] };
    expect(r.primaryFeasible).toBe(true);
    expect(r.conflicts).toHaveLength(0);
    const row = getApproval(db, r.approvalId);
    expect(row?.state).toBe('ready');
    expect(row?.kind).toBe('calendar_change');
    expect(row?.calendar_event_id).toBe('ev1');
    expect(row?.before_json).toContain('etag-1');
  });

  it('(6) success with busy conflict → primaryFeasible=false + alternatives', async () => {
    seedEvent(db, 'ev1');
    // Make the proposed Thursday window busy.
    const busy = [{ start: '2026-05-21T15:00:00.000Z', end: '2026-05-21T16:00:00.000Z' }];
    const result = await proposeCalendarChange('move my 3pm to Thursday', {
      db,
      client: fakeClient(busy),
      userEmail: USER,
      intentFn: async () => ({
        action: 'move',
        target: { eventRef: 'my 3pm' },
        when: { nlWhen: 'Thursday' },
      }),
      nowIso: '2026-05-18T12:00:00.000Z',
    });
    expect(result).toHaveProperty('approvalId');
    const r = result as { primaryFeasible: boolean; conflicts: Array<{ type: string }>; alternatives: unknown[] };
    expect(r.primaryFeasible).toBe(false);
    expect(r.conflicts.some((c) => c.type === 'busy')).toBe(true);
    expect(r.alternatives.length).toBeGreaterThan(0);
  });
});
