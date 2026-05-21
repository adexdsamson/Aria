/**
 * Plan 10-02 Task 3 — Tombstone sweep cron tests.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb } from '../db/connect';
import { runMigrations } from '../db/migrations/runner';
import { createFolderRegistry } from './folder-registry';
import { startTombstoneSweep } from './sweep-cron';
import { createTempUserDataDir } from '../../../tests/setup';

const MIGRATIONS_DIR = path.resolve(__dirname, '../db/migrations');

describe('startTombstoneSweep', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    const dataDir = createTempUserDataDir('aria-sweep-test');
    const dbKey = crypto.randomBytes(32);
    db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });
    db.pragma('foreign_keys=ON');
  });

  function seedTombstoned(hoursAgo: number, folderId: string): string {
    const dt = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
    const registry = createFolderRegistry(db);
    registry.addFolder({ path: `/tmp/fold-${folderId}`, label: 'F', sensitivity: 'general' });
    const file = registry.addFile({
      folderId,
      relativePath: `file-${hoursAgo}h.txt`,
      absolutePath: `/tmp/fold-${folderId}/file-${hoursAgo}h.txt`,
      size: 10,
      mtime: dt,
    });
    // Directly set tombstoned status + tombstoned_at
    db.prepare(`UPDATE knowledge_files SET status='tombstoned', tombstoned_at=? WHERE id=?`)
      .run(dt, file.id);
    return file.id;
  }

  it('deletes tombstoned files older than 24h and preserves recent ones', () => {
    const registry = createFolderRegistry(db);
    const folder = registry.addFolder({ path: '/tmp/fold', label: 'F', sensitivity: 'general' });
    const folderId = folder.id;

    // Old tombstone (25h ago)
    const oldFile = registry.addFile({
      folderId, relativePath: 'old.txt', absolutePath: '/tmp/fold/old.txt',
      size: 1, mtime: new Date().toISOString(),
    });
    db.prepare(`UPDATE knowledge_files SET status='tombstoned', tombstoned_at=? WHERE id=?`)
      .run(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), oldFile.id);

    // Recent tombstone (1h ago)
    const recentFile = registry.addFile({
      folderId, relativePath: 'recent.txt', absolutePath: '/tmp/fold/recent.txt',
      size: 1, mtime: new Date().toISOString(),
    });
    db.prepare(`UPDATE knowledge_files SET status='tombstoned', tombstoned_at=? WHERE id=?`)
      .run(new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), recentFile.id);

    const sweep = startTombstoneSweep({
      db,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as import('pino').Logger,
    });
    const deleted = sweep.runNow();
    sweep.stop();

    expect(deleted).toBe(1);

    const remaining = db.prepare(`SELECT id FROM knowledge_files WHERE status='tombstoned'`).all() as { id: string }[];
    expect(remaining.map((r) => r.id)).toContain(recentFile.id);
    expect(remaining.map((r) => r.id)).not.toContain(oldFile.id);
  });

  it('cascade deletes rag_chunk rows via FK when knowledge_files are deleted', () => {
    const registry = createFolderRegistry(db);
    const folder = registry.addFolder({ path: '/tmp/cascade', label: 'F', sensitivity: 'general' });
    const folderId = folder.id;

    const file = registry.addFile({
      folderId, relativePath: 'chunk-owner.txt', absolutePath: '/tmp/cascade/chunk-owner.txt',
      size: 10, mtime: new Date().toISOString(),
    });
    db.prepare(`UPDATE knowledge_files SET status='tombstoned', tombstoned_at=? WHERE id=?`)
      .run(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), file.id);

    // Insert a rag_chunk row pointing at this file
    db.prepare(
      `INSERT INTO rag_chunk (id, source_kind, source_id, title, text, char_start, char_end, token_count,
        sensitivity, sensitivity_model, sensitivity_at, folder_id, file_id)
       VALUES (?, 'folder', ?, 't', 'text', 0, 4, 1, 'folder:low', 'folder-rule:v1', ?, ?, ?)`
    ).run(`chunk-${file.id}:0`, file.id, new Date().toISOString(), folderId, file.id);

    const sweep = startTombstoneSweep({ db, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as import('pino').Logger });
    sweep.runNow();
    sweep.stop();

    // knowledge_files row should be gone
    const fileRow = db.prepare(`SELECT id FROM knowledge_files WHERE id=?`).get(file.id);
    expect(fileRow).toBeUndefined();

    // rag_chunk row should also be gone via FK cascade
    const chunkRow = db.prepare(`SELECT id FROM rag_chunk WHERE file_id=?`).get(file.id);
    expect(chunkRow).toBeUndefined();
  });
});

// Need to import vi for the mock logger
import { vi } from 'vitest';
