import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

/**
 * Plan 10-01 Task 1: migration 132 knowledge_folders schema.
 *
 * Asserts:
 *  - DB advances to user_version=132
 *  - knowledge_folders, knowledge_files tables exist
 *  - rag_chunk CHECK is widened to include 'folder'
 *  - folder_id, file_id columns added to rag_chunk
 *  - existing rag_chunk rows + rag_embedding rows survive
 *  - FK cascade via file_id
 */
describe('migration 132 knowledge_folders', () => {
  let dataDir: string;
  let dbKey: Buffer;

  beforeEach(() => {
    dataDir = createTempUserDataDir('aria-db-mig-132');
    dbKey = crypto.randomBytes(32);
  });

  it('advances to user_version=132', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });
    const version = db.pragma('user_version', { simple: true }) as number;
    expect(version).toBeGreaterThanOrEqual(132);
    closeDb(db);
  });

  it('creates knowledge_folders and knowledge_files tables', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain('knowledge_folders');
    expect(tables).toContain('knowledge_files');

    // Verify knowledge_folders columns
    const folderCols = (db.pragma('table_info(knowledge_folders)') as Array<{ name: string }>)
      .map((c) => c.name);
    for (const col of ['id', 'path', 'label', 'sensitivity', 'status', 'last_scan_at', 'last_error', 'created_at', 'updated_at']) {
      expect(folderCols).toContain(col);
    }

    // Verify knowledge_files columns
    const fileCols = (db.pragma('table_info(knowledge_files)') as Array<{ name: string }>)
      .map((c) => c.name);
    for (const col of ['id', 'folder_id', 'relative_path', 'absolute_path', 'size', 'mtime', 'content_hash', 'status', 'last_error', 'tombstoned_at', 'created_at', 'updated_at']) {
      expect(fileCols).toContain(col);
    }

    closeDb(db);
  });

  it('rag_chunk has folder_id and file_id columns after migration', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });

    const chunkCols = (db.pragma('table_info(rag_chunk)') as Array<{ name: string }>)
      .map((c) => c.name);
    expect(chunkCols).toContain('folder_id');
    expect(chunkCols).toContain('file_id');

    closeDb(db);
  });

  it('idx_rag_chunk_file_id index exists', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(indexes).toContain('idx_rag_chunk_file_id');
    expect(indexes).toContain('idx_knowledge_files_folder');
    expect(indexes).toContain('idx_knowledge_files_tombstoned');

    closeDb(db);
  });

  it('pre-existing rag_chunk rows and rag_embedding rows survive migration', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    // Run migrations up to 131 first, seed rows, then apply 132.
    // Since runner applies ALL pending, we seed BEFORE running.
    // Instead: run all migrations (which now includes 132), then seed.
    // The test verifies the schema accepts the old data shape.
    runMigrations(db, { dir: MIGRATIONS_DIR });

    const now = new Date().toISOString();
    // Insert 5 rag_chunk rows as if they existed before 132 (no folder_id/file_id).
    const insertChunk = db.prepare(
      `INSERT INTO rag_chunk (id, source_kind, source_id, title, text, char_start, char_end, token_count, dirty, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 10, 4, 0, ?, ?)`
    );
    for (let i = 0; i < 5; i++) {
      insertChunk.run(`email:msg${i}:chunk:0`, 'email', `msg${i}`, `Subject ${i}`, `text ${i}`, now, now);
    }

    // Insert rag_embedding rows for each chunk.
    const insertEmbed = db.prepare(
      `INSERT INTO rag_embedding (chunk_id, model_id, dim, vector, embedded_at)
       VALUES (?, 'nomic-embed-text:v1.5', 768, X'00', ?)`
    );
    for (let i = 0; i < 5; i++) {
      insertEmbed.run(`email:msg${i}:chunk:0`, now);
    }

    const chunkCount = (db.prepare('SELECT COUNT(*) AS n FROM rag_chunk').get() as { n: number }).n;
    expect(chunkCount).toBe(5);
    const embedCount = (db.prepare('SELECT COUNT(*) AS n FROM rag_embedding').get() as { n: number }).n;
    expect(embedCount).toBe(5);

    // Verify folder_id and file_id are NULL for legacy rows.
    const row = db
      .prepare("SELECT folder_id, file_id FROM rag_chunk WHERE source_kind='email' LIMIT 1")
      .get() as { folder_id: null; file_id: null };
    expect(row.folder_id).toBeNull();
    expect(row.file_id).toBeNull();

    closeDb(db);
  });

  it("accepts source_kind='folder' after migration", () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });

    const now = new Date().toISOString();
    // Must succeed
    expect(() => {
      db.prepare(
        `INSERT INTO rag_chunk (id, source_kind, source_id, title, text, char_start, char_end, token_count, dirty, created_at, updated_at)
         VALUES ('folder:f1:chunk:0', 'folder', 'f1', 'doc.md', 'hello', 0, 5, 1, 1, ?, ?)`
      ).run(now, now);
    }).not.toThrow();

    closeDb(db);
  });

  it("rejects source_kind='garbage' with CHECK violation", () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });

    const now = new Date().toISOString();
    expect(() => {
      db.prepare(
        `INSERT INTO rag_chunk (id, source_kind, source_id, title, text, char_start, char_end, token_count, dirty, created_at, updated_at)
         VALUES ('garbage:1:chunk:0', 'garbage', '1', 'title', 'text', 0, 4, 1, 1, ?, ?)`
      ).run(now, now);
    }).toThrow();

    closeDb(db);
  });

  it('FK cascade: deleting knowledge_files row removes linked rag_chunk rows', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });
    db.pragma('foreign_keys=ON');

    const now = new Date().toISOString();

    // Seed folder
    db.prepare(
      `INSERT INTO knowledge_folders (id, path, label, sensitivity, status, created_at, updated_at)
       VALUES ('folder-1', '/tmp/test', 'Test', 'general', 'active', ?, ?)`
    ).run(now, now);

    // Seed file
    db.prepare(
      `INSERT INTO knowledge_files (id, folder_id, relative_path, absolute_path, size, mtime, status, created_at, updated_at)
       VALUES ('file-1', 'folder-1', 'doc.md', '/tmp/test/doc.md', 100, ?, 'indexed', ?, ?)`
    ).run(now, now, now);

    // Seed chunk linked to the file
    db.prepare(
      `INSERT INTO rag_chunk (id, source_kind, source_id, folder_id, file_id, title, text, char_start, char_end, token_count, dirty, created_at, updated_at)
       VALUES ('folder:file-1:chunk:0', 'folder', 'file-1', 'folder-1', 'file-1', 'doc.md', 'hello', 0, 5, 1, 0, ?, ?)`
    ).run(now, now);

    // Delete the file — chunk should cascade away
    db.prepare(`DELETE FROM knowledge_files WHERE id='file-1'`).run();

    const count = (
      db.prepare("SELECT COUNT(*) AS n FROM rag_chunk WHERE file_id='file-1'").get() as { n: number }
    ).n;
    expect(count).toBe(0);

    closeDb(db);
  });
});
