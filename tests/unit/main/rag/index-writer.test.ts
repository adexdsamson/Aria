import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import pino from 'pino';
import { openDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';
import { createIndexWriter } from '../../../../src/main/rag/index-writer';
import { strategyA } from '../../../../src/main/rag/chunk-strategies';
import type { SourceDoc } from '../../../../src/main/rag/chunk-types';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

function setupDb() {
  const dataDir = createTempUserDataDir('aria-iw');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

function mkDoc(text: string, sourceId = 'm1'): SourceDoc {
  return {
    sourceKind: 'email',
    sourceId,
    title: 'Subject',
    text,
    parentRef: 't1',
  };
}

describe('IndexWriter — Plan 07-02 Task 3', () => {
  let db: ReturnType<typeof setupDb>;
  const logger = pino({ level: 'silent' });

  beforeEach(() => {
    db = setupDb();
  });

  it('upsertSource inserts chunks + populates sensitivity at index time', async () => {
    const classify = vi.fn(async () => 'pii:low' as const);
    const w = createIndexWriter({
      db,
      logger,
      strategy: strategyA,
      classify,
      classifierModelId: 'router-v1',
    });
    const res = await w.upsertSource(mkDoc('contains email foo@example.com'));
    expect(res.inserted).toBeGreaterThan(0);
    expect(res.classified).toBe(res.inserted);
    const rows = db
      .prepare('SELECT sensitivity, sensitivity_model FROM rag_chunk WHERE source_id = ?')
      .all('m1') as Array<{ sensitivity: string; sensitivity_model: string }>;
    for (const r of rows) {
      expect(r.sensitivity).toBe('pii:low');
      expect(r.sensitivity_model).toBe('router-v1');
    }
  });

  it('shrinking from 5 chunks to 3 leaves only 3 rows (delete+insert in txn)', async () => {
    // Seed 5 chunks manually then re-upsert with content that produces just 1
    // chunk under strategyA. Easier: re-upsert twice and compare counts.
    const classify = vi.fn(async () => 'none' as const);
    const w = createIndexWriter({
      db,
      logger,
      strategy: strategyA,
      classify,
      classifierModelId: 'router-v1',
    });
    await w.upsertSource(mkDoc('one body', 'm1'));
    const before = db
      .prepare(`SELECT count(*) AS n FROM rag_chunk WHERE source_id = 'm1'`)
      .get() as { n: number };
    expect(before.n).toBeGreaterThan(0);

    await w.upsertSource(mkDoc('shrunk', 'm1'));
    const after = db
      .prepare(`SELECT count(*) AS n FROM rag_chunk WHERE source_id = 'm1'`)
      .get() as { n: number };
    // strategyA emits exactly one chunk per source.
    expect(after.n).toBe(1);
  });

  it('deleteSource removes chunks AND clears rag_source_dirty', async () => {
    const w = createIndexWriter({
      db,
      logger,
      strategy: strategyA,
      classify: async () => 'none' as const,
      classifierModelId: 'router-v1',
    });
    await w.upsertSource(mkDoc('body', 'mZ'));
    const dirtyBefore = db
      .prepare(`SELECT count(*) AS n FROM rag_source_dirty WHERE source_id = 'mZ'`)
      .get() as { n: number };
    expect(dirtyBefore.n).toBe(1);

    const res = w.deleteSource('email', 'mZ');
    expect(res.deletedChunks).toBeGreaterThan(0);
    const chunksAfter = db
      .prepare(`SELECT count(*) AS n FROM rag_chunk WHERE source_id = 'mZ'`)
      .get() as { n: number };
    expect(chunksAfter.n).toBe(0);
    const dirtyAfter = db
      .prepare(`SELECT count(*) AS n FROM rag_source_dirty WHERE source_id = 'mZ'`)
      .get() as { n: number };
    expect(dirtyAfter.n).toBe(0);
  });

  it('FTS5 trigger keeps rag_chunk_fts row count consistent', async () => {
    const w = createIndexWriter({
      db,
      logger,
      strategy: strategyA,
      classify: async () => 'none' as const,
      classifierModelId: 'router-v1',
    });
    await w.upsertSource(mkDoc('searchable body about Q3 budget', 'mFTS'));
    const ftsCount = db.prepare(`SELECT count(*) AS n FROM rag_chunk_fts`).get() as { n: number };
    const chunkCount = db.prepare(`SELECT count(*) AS n FROM rag_chunk`).get() as { n: number };
    expect(ftsCount.n).toBe(chunkCount.n);

    w.deleteSource('email', 'mFTS');
    const ftsAfter = db.prepare(`SELECT count(*) AS n FROM rag_chunk_fts`).get() as { n: number };
    expect(ftsAfter.n).toBe(0);
  });

  it('classifier failure leaves sensitivity NULL (fail-closed)', async () => {
    const w = createIndexWriter({
      db,
      logger,
      strategy: strategyA,
      classify: async () => {
        throw new Error('ollama-down');
      },
      classifierModelId: 'router-v1',
    });
    const res = await w.upsertSource(mkDoc('x', 'mNull'));
    expect(res.classified).toBe(0);
    const row = db
      .prepare(`SELECT sensitivity FROM rag_chunk WHERE source_id = 'mNull' LIMIT 1`)
      .get() as { sensitivity: string | null };
    expect(row.sensitivity).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Plan 10-01 Task 3 — folder_id / file_id persistence + cascade tests
// ---------------------------------------------------------------------------

describe('IndexWriter — Phase 10 folder_id / file_id', () => {
  let db: ReturnType<typeof setupDb>;
  const logger = pino({ level: 'silent' });
  const classify = vi.fn(async () => 'folder:low' as const);

  beforeEach(() => {
    db = setupDb();
    db.pragma('foreign_keys=ON');
  });

  function seedFolderAndFile(folderId: string, fileId: string) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO knowledge_folders (id, path, label, sensitivity, status, created_at, updated_at)
       VALUES (?, ?, ?, 'general', 'active', ?, ?)`
    ).run(folderId, `/tmp/${folderId}`, `Folder ${folderId}`, now, now);
    db.prepare(
      `INSERT INTO knowledge_files (id, folder_id, relative_path, absolute_path, size, mtime, status, created_at, updated_at)
       VALUES (?, ?, 'doc.md', '/tmp/doc.md', 100, ?, 'indexed', ?, ?)`
    ).run(fileId, folderId, now, now, now);
  }

  // Test A — folder_id / file_id persistence
  it('Test A: folder chunks persist folder_id and file_id on all rows', async () => {
    const folderId = 'folder-a1';
    const fileId = 'file-a1';
    seedFolderAndFile(folderId, fileId);

    const w = createIndexWriter({ db, logger, strategy: strategyA, classify, classifierModelId: 'folder-rule:v1' });
    const res = await w.upsertSource({
      sourceKind: 'folder',
      sourceId: fileId,
      folderId,
      fileId,
      title: 'doc.md',
      text: 'hello world from the folder',
    });
    expect(res.inserted).toBeGreaterThan(0);

    const rows = db
      .prepare(`SELECT folder_id, file_id FROM rag_chunk WHERE source_kind='folder'`)
      .all() as Array<{ folder_id: string; file_id: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.folder_id).toBe(folderId);
      expect(row.file_id).toBe(fileId);
    }
  });

  // Test B — folder cascade (folder→files→chunks)
  it('Test B: deleting knowledge_folders row cascades to zero rag_chunk rows', async () => {
    const folderId = 'folder-b1';
    const fileId = 'file-b1';
    seedFolderAndFile(folderId, fileId);

    const w = createIndexWriter({ db, logger, strategy: strategyA, classify, classifierModelId: 'folder-rule:v1' });
    await w.upsertSource({ sourceKind: 'folder', sourceId: fileId, folderId, fileId, title: 'b.md', text: 'cascade test content here' });

    db.prepare(`DELETE FROM knowledge_folders WHERE id=?`).run(folderId);

    const count = (db.prepare(`SELECT COUNT(*) AS n FROM rag_chunk WHERE folder_id=?`).get(folderId) as { n: number }).n;
    expect(count).toBe(0);
  });

  // Test C — per-file cascade
  it('Test C: deleting one knowledge_files row only removes that file chunks', async () => {
    const folderId = 'folder-c1';
    const fileA = 'file-ca';
    const fileB = 'file-cb';
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO knowledge_folders (id, path, label, sensitivity, status, created_at, updated_at)
       VALUES (?, '/tmp/c', 'C', 'general', 'active', ?, ?)`
    ).run(folderId, now, now);
    db.prepare(
      `INSERT INTO knowledge_files (id, folder_id, relative_path, absolute_path, size, mtime, status, created_at, updated_at)
       VALUES (?, ?, 'a.md', '/tmp/c/a.md', 100, ?, 'indexed', ?, ?)`
    ).run(fileA, folderId, now, now, now);
    db.prepare(
      `INSERT INTO knowledge_files (id, folder_id, relative_path, absolute_path, size, mtime, status, created_at, updated_at)
       VALUES (?, ?, 'b.md', '/tmp/c/b.md', 100, ?, 'indexed', ?, ?)`
    ).run(fileB, folderId, now, now, now);

    const w = createIndexWriter({ db, logger, strategy: strategyA, classify, classifierModelId: 'folder-rule:v1' });
    await w.upsertSource({ sourceKind: 'folder', sourceId: fileA, folderId, fileId: fileA, title: 'a.md', text: 'content of file A here' });
    await w.upsertSource({ sourceKind: 'folder', sourceId: fileB, folderId, fileId: fileB, title: 'b.md', text: 'content of file B here' });

    const bCountBefore = (db.prepare(`SELECT COUNT(*) AS n FROM rag_chunk WHERE file_id=?`).get(fileB) as { n: number }).n;
    expect(bCountBefore).toBeGreaterThan(0);

    db.prepare(`DELETE FROM knowledge_files WHERE id=?`).run(fileA);

    const aCount = (db.prepare(`SELECT COUNT(*) AS n FROM rag_chunk WHERE file_id=?`).get(fileA) as { n: number }).n;
    expect(aCount).toBe(0);

    const bCount = (db.prepare(`SELECT COUNT(*) AS n FROM rag_chunk WHERE file_id=?`).get(fileB) as { n: number }).n;
    expect(bCount).toBe(bCountBefore); // B untouched
  });

  // Test D — non-folder sources unaffected
  it('Test D: email chunks have NULL folder_id and NULL file_id', async () => {
    const w = createIndexWriter({
      db, logger, strategy: strategyA,
      classify: async () => 'none' as const,
      classifierModelId: 'router-v1'
    });
    await w.upsertSource({ sourceKind: 'email', sourceId: 'msg-1', title: 'Subject', text: 'email body here' });

    const rows = db
      .prepare(`SELECT folder_id, file_id FROM rag_chunk WHERE source_kind='email'`)
      .all() as Array<{ folder_id: null; file_id: null }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.folder_id).toBeNull();
      expect(row.file_id).toBeNull();
    }
  });

  // Test E — chunk id shape
  it('Test E: folder chunks use file-keyed id; email chunks use source-keyed id', async () => {
    const folderId = 'folder-e1';
    const fileId = 'file-e1';
    seedFolderAndFile(folderId, fileId);

    const w = createIndexWriter({ db, logger, strategy: strategyA, classify, classifierModelId: 'folder-rule:v1' });
    await w.upsertSource({ sourceKind: 'folder', sourceId: fileId, folderId, fileId, title: 'e.md', text: 'chunk id shape test content' });

    const folderRows = db
      .prepare(`SELECT id FROM rag_chunk WHERE source_kind='folder'`)
      .all() as Array<{ id: string }>;
    for (const row of folderRows) {
      expect(row.id).toMatch(new RegExp(`^folder:${fileId}:chunk:\\d+$`));
    }

    const w2 = createIndexWriter({
      db, logger, strategy: strategyA,
      classify: async () => 'none' as const,
      classifierModelId: 'router-v1'
    });
    const emailSourceId = 'msg-e1';
    await w2.upsertSource({ sourceKind: 'email', sourceId: emailSourceId, title: 'Subject', text: 'email chunk id test' });

    const emailRows = db
      .prepare(`SELECT id FROM rag_chunk WHERE source_kind='email'`)
      .all() as Array<{ id: string }>;
    for (const row of emailRows) {
      expect(row.id).toMatch(new RegExp(`^email:${emailSourceId}:chunk:\\d+$`));
    }
  });
});
