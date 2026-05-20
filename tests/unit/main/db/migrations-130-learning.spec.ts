import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

/**
 * Plan 08-03 Task 1 — migration 130 learning schema.
 *
 * Tests 1–7 (per PLAN behavior):
 *   1. learning_signals table shape + CHECK on source
 *   2. learned_preferences singleton (id CHECK = 1)
 *   3. briefing_feedback shape + thumb CHECK in (-1,0,1)
 *   4. rag_turn.thumb column present
 *   5. indexes on (occurred_at) + (source, occurred_at)
 *   6. idempotent re-run (no-op under runner's user_version guard)
 *   7. clean apply on fresh DB; advances user_version to 130
 */
describe('migration 130 phase8 learning', () => {
  let dataDir: string;
  let dbKey: Buffer;

  beforeEach(() => {
    dataDir = createTempUserDataDir('aria-db-mig-130');
    dbKey = crypto.randomBytes(32);
  });

  it('applies 130 and advances user_version', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });

    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(130);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain('learning_signals');
    expect(tables).toContain('learned_preferences');
    expect(tables).toContain('briefing_feedback');

    closeDb(db);
  });

  it('learning_signals source CHECK rejects invalid source', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });

    expect(() =>
      db
        .prepare(
          `INSERT INTO learning_signals (source, kind, payload_json, occurred_at) VALUES (?,?,?,?)`,
        )
        .run('bogus', 'x', '{}', new Date().toISOString()),
    ).toThrow();

    db.prepare(
      `INSERT INTO learning_signals (source, kind, payload_json, occurred_at) VALUES (?,?,?,?)`,
    ).run('approval', 'approval.edit', '{}', new Date().toISOString());

    closeDb(db);
  });

  it('learned_preferences id CHECK forbids id != 1', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });

    db.prepare(
      `INSERT INTO learned_preferences (id, payload_json, updated_at) VALUES (1,?,?)`,
    ).run('{}', new Date().toISOString());

    expect(() =>
      db
        .prepare(
          `INSERT INTO learned_preferences (id, payload_json, updated_at) VALUES (2,?,?)`,
        )
        .run('{}', new Date().toISOString()),
    ).toThrow();

    closeDb(db);
  });

  it('briefing_feedback thumb CHECK rejects values outside {-1,0,1}', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });

    db.prepare(
      `INSERT INTO briefing_feedback (briefing_id, section_key, thumb, created_at) VALUES (?,?,?,?)`,
    ).run('2026-05-20', 'email', 1, new Date().toISOString());

    expect(() =>
      db
        .prepare(
          `INSERT INTO briefing_feedback (briefing_id, section_key, thumb, created_at) VALUES (?,?,?,?)`,
        )
        .run('2026-05-20', 'email', 2, new Date().toISOString()),
    ).toThrow();

    closeDb(db);
  });

  it('rag_turn.thumb column added with default 0', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });
    const cols = db
      .prepare(`PRAGMA table_info(rag_turn)`)
      .all() as Array<{ name: string; dflt_value: string | null }>;
    const thumb = cols.find((c) => c.name === 'thumb');
    expect(thumb).toBeDefined();
    expect(Number(thumb?.dflt_value)).toBe(0);
    closeDb(db);
  });

  it('indexes exist on learning_signals', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });
    const idx = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='learning_signals'`,
      )
      .all()
      .map((r) => (r as { name: string }).name);
    expect(idx).toContain('idx_learning_signals_occurred');
    expect(idx).toContain('idx_learning_signals_source_occ');
    closeDb(db);
  });

  it('idempotent re-run is a no-op', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });
    const v1 = db.pragma('user_version', { simple: true }) as number;
    runMigrations(db, { dir: MIGRATIONS_DIR });
    const v2 = db.pragma('user_version', { simple: true }) as number;
    expect(v2).toBe(v1);
    closeDb(db);
  });
});
