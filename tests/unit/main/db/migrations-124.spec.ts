import { describe, expect, it } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { createTempUserDataDir } from '../../../setup';
import { openDb, closeDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

describe('migration 124 meeting extraction approvals', () => {
  it('creates extraction tables and widens approval kind to task_batch', () => {
    const db = openDb({ dataDir: createTempUserDataDir('aria-mig-124'), dbKey: crypto.randomBytes(32), runMigrationsOnOpen: false });
    const applied = runMigrations(db, { dir: MIGRATIONS_DIR });
    expect(applied).toContain(124);
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(124);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => (row as { name: string }).name);
    expect(tables).toContain('meeting_summary');
    expect(tables).toContain('meeting_summary_item');
    expect(tables).toContain('meeting_action');
    const now = new Date().toISOString();
    expect(() =>
      db.prepare(
        `INSERT INTO approval (id, kind, state, created_at, updated_at, idempotency_key, meeting_note_id)
         VALUES ('task-1', 'task_batch', 'ready', ?, ?, 'idem-task-1', 'note-1')`,
      ).run(now, now),
    ).not.toThrow();
    closeDb(db);
  });
});
