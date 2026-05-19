import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { openDb, closeDb, type Db } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');
const FIXTURE_PATH = path.resolve(__dirname, '../../../fixtures/approval-schema-pre-012a.snapshot.json');

function parseVersion(file: string): number | null {
  const match = /^(\d+)([a-z]?)_/.exec(file);
  if (!match) return null;
  const base = Number.parseInt(match[1]!, 10);
  const suffix = match[2] ?? '';
  return suffix ? base * 10 + (suffix.charCodeAt(0) - 96) : base;
}

function loadFixture(): string[] {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) as string[];
}

function applyPre012Migrations(db: Db): void {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const version = parseVersion(file);
    if (version === null || version > 12) {
      continue;
    }
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
  }
}

function getApprovalColumns(db: Db): string[] {
  return db
    .prepare('PRAGMA table_info(approval)')
    .all()
    .map((col) => (col as { name: string }).name);
}

describe('012a migration', () => {
  let db!: Db;

  beforeEach(() => {
    const dataDir = createTempUserDataDir('aria-migration-012a');
    const dbKey = crypto.randomBytes(32);
    db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    applyPre012Migrations(db);
  });

  afterEach(() => {
    if (db) closeDb(db);
  });

  it('preserves the pre-012a approval columns, backfills idempotency_key, and extends the state CHECK', () => {
    const preCols = getApprovalColumns(db);
    expect(preCols).toEqual(loadFixture());

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO approval (
        id, kind, state, created_at, updated_at, approval_path
      ) VALUES (?, 'email_send', 'approved', ?, ?, 'explicit')`,
    ).run('approval-pre-012a', now, now);

    const applied = runMigrations(db, { dir: MIGRATIONS_DIR });
    expect(applied).toEqual([121]);

    const postCols = getApprovalColumns(db);
    expect(postCols).toEqual([...preCols, 'idempotency_key', 'last_error_message']);

    const row = db
      .prepare('SELECT id, idempotency_key, last_error_message FROM approval WHERE id = ?')
      .get('approval-pre-012a') as { id: string; idempotency_key: string; last_error_message: string | null };
    expect(row.idempotency_key).toMatch(/^[a-f0-9]{32}$/);
    expect(row.last_error_message).toBeNull();

    expect(() =>
      db.prepare(
        `INSERT INTO approval (
          id, kind, state, created_at, updated_at, approval_path, idempotency_key
        ) VALUES (?, 'email_send', 'sending', ?, ?, 'explicit', ?)`,
      ).run('approval-sending', now, now, '0123456789abcdef0123456789abcdef'),
    ).not.toThrow();

    expect(() =>
      db.prepare(
        `INSERT INTO approval (
          id, kind, state, created_at, updated_at, approval_path, idempotency_key
        ) VALUES (?, 'email_send', 'needs-operator-decision', ?, ?, 'explicit', ?)`,
      ).run('approval-needs-op', now, now, 'fedcba9876543210fedcba9876543210'),
    ).not.toThrow();

    expect(() =>
      db.prepare(
        `INSERT INTO approval (
          id, kind, state, created_at, updated_at, approval_path, idempotency_key
        ) VALUES (?, 'email_send', 'bogus', ?, ?, 'explicit', ?)`,
      ).run('approval-bogus', now, now, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    ).toThrow();

    const rerun = runMigrations(db, { dir: MIGRATIONS_DIR });
    expect(rerun).toEqual([]);
  });
});
