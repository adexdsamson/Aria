/**
 * Plan 03-01 Task 1 — tier config lookup.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb, type Db } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';
import { getTier, TIER_DEFAULT } from '../../../../src/main/approvals/tier';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

function freshDb(): Db {
  const dataDir = createTempUserDataDir('aria-approvals-tier');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

describe('approvals/tier getTier', () => {
  let db: Db;
  beforeEach(() => {
    db = freshDb();
  });
  afterEach(() => {
    closeDb(db);
  });

  it("returns 'always-confirm' for seeded email_send_general class", () => {
    expect(getTier(db, 'email_send_general')).toBe('always-confirm');
  });

  it('returns TIER_DEFAULT for unknown class', () => {
    expect(getTier(db, 'never-seen-before')).toBe(TIER_DEFAULT);
    expect(TIER_DEFAULT).toBe('always-confirm');
  });
});
