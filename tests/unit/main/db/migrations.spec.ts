import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb, DbOpenError } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

describe('db/migrations', () => {
  let dataDir: string;
  let dbKey: Buffer;

  beforeEach(() => {
    dataDir = createTempUserDataDir('aria-db-mig');
    dbKey = crypto.randomBytes(32);
  });

  it('runMigrations creates app_meta, settings, routing_log and sets user_version=1', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    const applied = runMigrations(db, { dir: MIGRATIONS_DIR });
    expect(applied).toEqual([1]);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain('app_meta');
    expect(tables).toContain('settings');
    expect(tables).toContain('routing_log');

    const version = db.pragma('user_version', { simple: true }) as number;
    expect(version).toBe(1);

    closeDb(db);
  });

  it('runMigrations is a no-op on re-run', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });
    const second = runMigrations(db, { dir: MIGRATIONS_DIR });
    expect(second).toEqual([]);
    closeDb(db);
  });

  it('opening an encrypted DB with the wrong key throws DbOpenError', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });
    db.prepare('INSERT INTO settings(k, v) VALUES (?, ?)').run('theme', 'dark');
    closeDb(db);

    const wrongKey = crypto.randomBytes(32);
    expect(() => openDb({ dataDir, dbKey: wrongKey, runMigrationsOnOpen: false })).toThrow(
      DbOpenError,
    );
  });

  it('routing_log schema contains every column Plan 04 requires', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });
    const cols = db
      .prepare("PRAGMA table_info(routing_log)")
      .all()
      .map((c) => (c as { name: string }).name);
    for (const c of ['ts', 'route', 'reason', 'source', 'prompt_hash', 'model', 'latency_ms', 'ok']) {
      expect(cols).toContain(c);
    }
    closeDb(db);
  });
});
