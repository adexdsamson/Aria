import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

/**
 * Plan 08-01 Task 1: migration 128 — insights table.
 *
 * Stream 1 ONLY owns this migration. Streams 2/3 add 129/130 in their own plans.
 *
 * Asserts:
 *  - 128 applies cleanly on a fresh DB and bumps user_version to ≥128
 *  - Re-running the runner after 128 is a no-op (idempotent)
 *  - `insights` table has documented column shape + CHECK constraint
 *  - Unique index on (kind, week_ymd) so re-compute upserts
 *  - Index on (week_ymd DESC) for briefing reads
 */
describe('migration 128 insights', () => {
  let dataDir: string;
  let dbKey: Buffer;

  beforeEach(() => {
    dataDir = createTempUserDataDir('aria-db-mig-128');
    dbKey = crypto.randomBytes(32);
  });

  it('applies 128: bumps user_version, creates insights table + indices', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });

    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(128);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain('insights');

    const cols = (db.pragma('table_info(insights)') as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>);
    const colMap = Object.fromEntries(cols.map((c) => [c.name, c]));
    expect(colMap.id).toBeDefined();
    expect(colMap.kind).toBeDefined();
    expect(colMap.kind.notnull).toBe(1);
    expect(colMap.week_ymd).toBeDefined();
    expect(colMap.week_ymd.notnull).toBe(1);
    expect(colMap.computed_at).toBeDefined();
    expect(colMap.computed_at.notnull).toBe(1);
    expect(colMap.payload_json).toBeDefined();
    expect(colMap.payload_json.notnull).toBe(1);
    expect(colMap.dismissed).toBeDefined();
    expect(colMap.dismissed.notnull).toBe(1);

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='insights' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    // Unique index on (kind, week_ymd)
    expect(indexes.some((i) => /uniq.*insights/i.test(i) || /insights.*kind.*week/i.test(i))).toBe(true);
    // Read index on week_ymd
    expect(indexes.some((i) => /insights.*week/i.test(i))).toBe(true);

    closeDb(db);
  });

  it('CHECK constraint rejects unknown kind', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });
    const now = new Date().toISOString();
    expect(() =>
      db.prepare(
        `INSERT INTO insights (kind, week_ymd, computed_at, payload_json) VALUES (?,?,?,?)`,
      ).run('not_a_kind', '2026-05-18', now, '{}'),
    ).toThrow();
    closeDb(db);
  });

  it('upsert on (kind, week_ymd) via unique index', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO insights (kind, week_ymd, computed_at, payload_json) VALUES (?,?,?,?)`,
    ).run('calendar_load', '2026-05-18', now, '{"v":1}');
    // Re-insert same (kind, week_ymd) should violate the unique index
    expect(() =>
      db.prepare(
        `INSERT INTO insights (kind, week_ymd, computed_at, payload_json) VALUES (?,?,?,?)`,
      ).run('calendar_load', '2026-05-18', now, '{"v":2}'),
    ).toThrow();
    // ON CONFLICT upsert pattern works
    db.prepare(
      `INSERT INTO insights (kind, week_ymd, computed_at, payload_json) VALUES (?,?,?,?)
       ON CONFLICT(kind, week_ymd) DO UPDATE SET
         computed_at = excluded.computed_at,
         payload_json = excluded.payload_json`,
    ).run('calendar_load', '2026-05-18', now, '{"v":3}');
    const row = db
      .prepare(`SELECT payload_json FROM insights WHERE kind=? AND week_ymd=?`)
      .get('calendar_load', '2026-05-18') as { payload_json: string };
    expect(row.payload_json).toBe('{"v":3}');
    closeDb(db);
  });

  it('idempotent: re-running migrations after 128 applies no further versions', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    const applied1 = runMigrations(db, { dir: MIGRATIONS_DIR });
    expect(applied1).toContain(128);
    const applied2 = runMigrations(db, { dir: MIGRATIONS_DIR });
    expect(applied2).toEqual([]);
    closeDb(db);
  });
});
