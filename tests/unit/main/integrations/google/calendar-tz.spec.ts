/**
 * Plan 02-02 Task 2 — XCUT-07 timezone correctness.
 *
 * Covers:
 *   1. Timed event timezone preservation + UTC conversion.
 *   2. All-day event YYYY-MM-DD preservation.
 *   3. Migration 003 CHECK constraint rejects rows where both start_at_utc
 *      AND start_date are NULL (real SQLCipher DB via openDb).
 *   4. readTodaysEvents in Africa/Lagos computes correct UTC bounds.
 *   5. readTodaysEvents in America/New_York handles whatever offset is in
 *      force on the test date (DST-robust).
 *   6. All-day event "today" filter is local-date-equality, not UTC-midnight.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb } from '../../../../../src/main/db/connect';
import { runMigrations } from '../../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../../setup';
import {
  toEventRow,
  computeTodayBoundsUtc,
  readTodaysEvents,
} from '../../../../../src/main/integrations/google/sync-calendar';
import type {
  CalendarClient,
  CalendarEventRaw,
} from '../../../../../src/main/integrations/google/calendar';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../../src/main/db/migrations');

describe('XCUT-07 timezone correctness', () => {
  it('Case 1 — timed event: dateTime → start_at_utc (UTC ISO); timeZone preserved; start_date null', () => {
    const raw: CalendarEventRaw = {
      id: 'ev-timed',
      summary: 'Lagos sync',
      start: { dateTime: '2026-05-20T09:00:00+01:00', timeZone: 'Africa/Lagos' },
      end: { dateTime: '2026-05-20T10:00:00+01:00', timeZone: 'Africa/Lagos' },
      updated: '2026-05-19T12:00:00Z',
    };
    const row = toEventRow(raw, '2026-05-19T12:00:00.000Z');
    expect(row.start_at_utc).toBe('2026-05-20T08:00:00.000Z');
    expect(row.start_timezone).toBe('Africa/Lagos');
    expect(row.start_date).toBeNull();
    expect(row.end_at_utc).toBe('2026-05-20T09:00:00.000Z');
  });

  it('Case 2 — all-day event: date YYYY-MM-DD preserved; start_at_utc/start_timezone null', () => {
    const raw: CalendarEventRaw = {
      id: 'ev-allday',
      summary: 'Holiday',
      start: { date: '2026-05-20' },
      end: { date: '2026-05-21' },
      updated: '2026-05-19T12:00:00Z',
    };
    const row = toEventRow(raw, '2026-05-19T12:00:00.000Z');
    expect(row.start_date).toBe('2026-05-20');
    expect(row.end_date).toBe('2026-05-21');
    expect(row.start_at_utc).toBeNull();
    expect(row.start_timezone).toBeNull();
  });

  describe('Case 3 — migration 003 CHECK constraint on real SQLCipher DB', () => {
    let dataDir: string;
    let dbKey: Buffer;

    beforeEach(() => {
      dataDir = createTempUserDataDir('aria-cal-check');
      dbKey = crypto.randomBytes(32);
    });

    it('rejects a row where BOTH start_at_utc AND start_date are NULL', () => {
      const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
      runMigrations(db, { dir: MIGRATIONS_DIR });

      const insert = (): void => {
        db.prepare(
          `INSERT INTO calendar_event (id, calendar_id, summary, location, start_at_utc, end_at_utc,
            start_date, end_date, start_timezone, attendees, status, recurring_id, updated_at, fetched_at)
           VALUES ('bad', 'primary', '', NULL, NULL, NULL, NULL, NULL, NULL, '[]', 'confirmed', NULL, '2026-05-19T12:00:00Z', '2026-05-19T12:00:00Z')`,
        ).run();
      };

      expect(insert).toThrow(/CHECK constraint failed/i);
      closeDb(db);
    });

    it('accepts a row with start_at_utc set', () => {
      const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
      runMigrations(db, { dir: MIGRATIONS_DIR });
      db.prepare(
        `INSERT INTO calendar_event (id, calendar_id, summary, location, start_at_utc, end_at_utc,
          start_date, end_date, start_timezone, attendees, status, recurring_id, updated_at, fetched_at)
         VALUES ('ok-timed', 'primary', '', NULL, '2026-05-20T08:00:00.000Z', '2026-05-20T09:00:00.000Z',
                 NULL, NULL, 'Africa/Lagos', '[]', 'confirmed', NULL, '2026-05-19T12:00:00Z', '2026-05-19T12:00:00Z')`,
      ).run();
      const row = db.prepare('SELECT id FROM calendar_event WHERE id=?').get('ok-timed') as { id: string };
      expect(row.id).toBe('ok-timed');
      closeDb(db);
    });

    it('accepts a row with start_date set', () => {
      const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
      runMigrations(db, { dir: MIGRATIONS_DIR });
      db.prepare(
        `INSERT INTO calendar_event (id, calendar_id, summary, location, start_at_utc, end_at_utc,
          start_date, end_date, start_timezone, attendees, status, recurring_id, updated_at, fetched_at)
         VALUES ('ok-allday', 'primary', '', NULL, NULL, NULL,
                 '2026-05-20', '2026-05-21', NULL, '[]', 'confirmed', NULL, '2026-05-19T12:00:00Z', '2026-05-19T12:00:00Z')`,
      ).run();
      const row = db.prepare('SELECT id FROM calendar_event WHERE id=?').get('ok-allday') as { id: string };
      expect(row.id).toBe('ok-allday');
      closeDb(db);
    });
  });

  it('Case 4 — readTodaysEvents in Africa/Lagos (UTC+1) on 2026-05-20 → bounds 23:00Z prev/next', async () => {
    // 2026-05-20 in Africa/Lagos (UTC+1, no DST) is the UTC window 2026-05-19T23:00:00Z → 2026-05-20T23:00:00Z
    const now = new Date('2026-05-20T12:00:00Z'); // 13:00 local Lagos
    const bounds = computeTodayBoundsUtc('Africa/Lagos', now);
    expect(bounds.timeMin).toBe('2026-05-19T23:00:00.000Z');
    expect(bounds.timeMax).toBe('2026-05-20T23:00:00.000Z');

    const client: CalendarClient = {
      listEvents: vi.fn(),
      listEventsWindow: vi.fn().mockResolvedValue({ items: [{ id: 'tx' }] }),
      getCalendarMetadata: vi.fn(),
    };
    const result = await readTodaysEvents(client, 'Africa/Lagos', now);
    expect(result.length).toBe(1);
    const callArg = (client.listEventsWindow as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.timeMin).toBe('2026-05-19T23:00:00.000Z');
    expect(callArg.timeMax).toBe('2026-05-20T23:00:00.000Z');
    expect(callArg.singleEvents).toBe(true);
  });

  it('Case 5 — readTodaysEvents in America/New_York: bounds match the current NY offset (DST-robust)', () => {
    // 2026-05-20 in NY is in EDT (UTC-4): local midnight = 04:00Z; next midnight = 28:00Z = next day 04:00Z.
    const now = new Date('2026-05-20T15:00:00Z');
    const bounds = computeTodayBoundsUtc('America/New_York', now);
    expect(bounds.timeMin).toBe('2026-05-20T04:00:00.000Z');
    expect(bounds.timeMax).toBe('2026-05-21T04:00:00.000Z');

    // 2026-02-01 in NY is EST (UTC-5): local midnight = 05:00Z.
    const winter = new Date('2026-02-01T15:00:00Z');
    const wBounds = computeTodayBoundsUtc('America/New_York', winter);
    expect(wBounds.timeMin).toBe('2026-02-01T05:00:00.000Z');
    expect(wBounds.timeMax).toBe('2026-02-02T05:00:00.000Z');
  });

  it('Case 6 — all-day event "today" predicate is local-date-equality, not UTC midnight', () => {
    // Plan 02-04 will own the briefing filter, but the contract is: an all-day
    // event whose start_date === today-in-userTz is considered on-day, even if
    // the UTC midnight bound crosses into the next/previous UTC day.
    const now = new Date('2026-05-20T12:00:00Z'); // 13:00 local Lagos = 2026-05-20 local
    const localToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    expect(localToday).toBe('2026-05-20');

    const raw: CalendarEventRaw = {
      id: 'allday',
      start: { date: '2026-05-20' },
      end: { date: '2026-05-21' },
      updated: '2026-05-19T00:00:00Z',
    };
    const row = toEventRow(raw, '2026-05-19T00:00:00Z');
    // The downstream "today" predicate compares row.start_date === localToday.
    expect(row.start_date).toBe(localToday);
  });
});
