import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

describe('migration 125 todoist tasks', () => {
  let dataDir: string;
  let dbKey: Buffer;

  beforeEach(() => {
    dataDir = createTempUserDataDir('aria-db-mig-125');
    dbKey = crypto.randomBytes(32);
  });

  it('adds Todoist provider/resource support and task tables', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });

    expect(db.pragma('user_version', { simple: true })).toBe(125);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain('todoist_task');
    expect(tables).toContain('meeting_action_task_link');

    expect(() =>
      db.prepare(
        `INSERT INTO provider_account (account_id, provider_key, display_email, capabilities_json)
         VALUES ('default', 'todoist', 'Todoist', '{"tasks":true}')`,
      ).run(),
    ).not.toThrow();

    expect(() =>
      db.prepare(
        `INSERT INTO provider_sync_state (provider_key, account_id, resource, cursor)
         VALUES ('todoist', 'default', 'tasks', 'cursor-1')`,
      ).run(),
    ).not.toThrow();

    const now = new Date().toISOString();
    expect(() =>
      db.prepare(
        `INSERT INTO todoist_task (
           id, remote_id, content, description, labels_json, due_iso, priority,
           is_completed, source, local_updated_at
         )
         VALUES ('task-1', 'remote-1', 'Follow up', 'From meeting', '["from-meeting"]',
                 '2026-05-20', 4, 0, 'todoist', ?)`,
      ).run(now),
    ).not.toThrow();

    closeDb(db);
  });
});
