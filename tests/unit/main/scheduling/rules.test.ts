/**
 * Plan 04-02 Task 1 — scheduling rules CRUD tests.
 *
 * Covers:
 *   (a) getRules on default-seeded singleton returns DEFAULT_RULES merged
 *       with the row's time_zone column
 *   (b) setRules persists; getRules round-trips the same shape
 *   (c) RulesSchema rejects bad input (negative buffer); setRules throws
 *   (d) time_zone column kept consistent with rules_json.timeZone
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb, type Db } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';
import {
  getRules,
  setRules,
  loadActiveRules,
  getUpdatedAt,
} from '../../../../src/main/scheduling/rules';
import { DEFAULT_RULES, type Rules } from '../../../../src/shared/scheduling-rules';

const MIGRATIONS_DIR = path.resolve(
  __dirname,
  '../../../../src/main/db/migrations',
);

function freshDb(): Db {
  const dataDir = createTempUserDataDir('aria-sched-rules');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

describe('scheduling/rules CRUD', () => {
  let db: Db;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    closeDb(db);
  });

  it('(a) getRules on default-seeded singleton returns DEFAULT_RULES + row tz', () => {
    const rules = getRules(db);
    expect(rules).toEqual({ ...DEFAULT_RULES, timeZone: 'UTC' });
    expect(loadActiveRules(db)).toEqual(rules);
  });

  it('(b) setRules persists; round-trip via getRules', () => {
    const next: Rules = {
      focusBlocks: [{ day: 'mon', start: '09:00', end: '11:00' }],
      buffers: { beforeMin: 10, afterMin: 5 },
      noMeetingWindows: [
        { day: 'fri', start: '12:00', end: '13:00', label: 'Lunch' },
      ],
      primeTimeWindows: [{ day: 'all', start: '10:00', end: '12:00' }],
      timeZone: 'America/New_York',
    };
    setRules(db, next);
    const got = getRules(db);
    expect(got).toEqual(next);
    const updatedAt = getUpdatedAt(db);
    expect(updatedAt).toBeTruthy();
    expect(updatedAt).not.toBe('1970-01-01T00:00:00.000Z');
  });

  it('(c) setRules throws on negative buffer (Zod rejection)', () => {
    const bad = {
      ...DEFAULT_RULES,
      buffers: { beforeMin: -5, afterMin: 0 },
    } as unknown as Rules;
    expect(() => setRules(db, bad)).toThrow();
  });

  it('(d) time_zone column kept consistent with rules_json.timeZone', () => {
    setRules(db, { ...DEFAULT_RULES, timeZone: 'Europe/Berlin' });
    const row = db
      .prepare<[], { rules_json: string; time_zone: string }>(
        `SELECT rules_json, time_zone FROM scheduling_rules WHERE id = 1`,
      )
      .get();
    expect(row?.time_zone).toBe('Europe/Berlin');
    const parsed = JSON.parse(row!.rules_json);
    expect(parsed.timeZone).toBe('Europe/Berlin');
  });
});
