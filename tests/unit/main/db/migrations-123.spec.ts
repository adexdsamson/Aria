import { describe, expect, it } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { createTempUserDataDir } from '../../../setup';
import { openDb, closeDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

describe('migration 123 meeting notes', () => {
  it('creates meeting_note and meeting_note_segment schema', () => {
    const db = openDb({
      dataDir: createTempUserDataDir('aria-mig-123'),
      dbKey: crypto.randomBytes(32),
      runMigrationsOnOpen: false,
    });
    const applied = runMigrations(db, { dir: MIGRATIONS_DIR });

    expect(applied).toContain(123);
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(123);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => (row as { name: string }).name);
    expect(tables).toContain('meeting_note');
    expect(tables).toContain('meeting_note_segment');
    expect(() =>
      db.prepare(
        `INSERT INTO meeting_note (id, source_kind, title, normalized_text, ingested_at)
         VALUES ('n1', 'pdf', 'Bad', 'x', '2026-05-19T00:00:00.000Z')`,
      ).run(),
    ).toThrow();

    closeDb(db);
  });
});
