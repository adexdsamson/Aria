/**
 * Unit tests for the dormant voiceConfirm seam (Phase 14, D-10/D-11).
 *
 * Uses an in-memory-style temp-dir DB migrated to version 134 so that
 * 'voice-explicit' is a legal approval_path value.
 */
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createTempUserDataDir } from '../../../tests/setup';
import { openDb, closeDb, type Db } from '../db/connect';
import { runMigrations } from '../db/migrations/runner';
import { insertApproval } from '../approvals/persist';
import { voiceConfirm } from './confirm';

const MIGRATIONS_DIR = path.resolve(__dirname, '../db/migrations');

describe('voiceConfirm', () => {
  let db: Db;

  beforeEach(() => {
    const dataDir = createTempUserDataDir('aria-voice-confirm');
    const dbKey = crypto.randomBytes(32);
    db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });
  });

  afterEach(() => {
    closeDb(db);
  });

  it('transitions a ready row to approved with approval_path=voice-explicit', () => {
    const approvalId = insertApproval(db, {
      kind: 'email_send',
      state: 'ready',
      severity: 'low',
      categories_json: JSON.stringify([]),
    });

    voiceConfirm(db, approvalId);

    const row = db
      .prepare('SELECT state, approval_path FROM approval WHERE id = ?')
      .get(approvalId) as { state: string; approval_path: string };

    expect(row.state).toBe('approved');
    expect(row.approval_path).toBe('voice-explicit');
  });

  it('throws an invalid-transition error when called on a non-ready row (proves it routes through transitionTo)', () => {
    // 'pending' cannot transition to 'approved' — assertTransition will reject
    const approvalId = insertApproval(db, {
      kind: 'email_send',
      state: 'pending',
    });

    expect(() => voiceConfirm(db, approvalId)).toThrow(/invalid-transition/);
  });
});
