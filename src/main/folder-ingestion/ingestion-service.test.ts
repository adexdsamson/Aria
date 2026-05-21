/**
 * Plan 10-01 Task 4 — FolderIngestionService tests.
 *
 * Integration tests using in-memory SQLite with migration 132 applied,
 * stub parser registry, and a real createIndexWriter.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import pino from 'pino';
import { openDb, closeDb } from '../db/connect';
import { runMigrations } from '../db/migrations/runner';
import { createFolderRegistry } from './folder-registry';
import { createFolderIngestionService } from './ingestion-service';
import { strategyA } from '../rag/chunk-strategies';
import { createTempUserDataDir } from '../../../tests/setup';

const MIGRATIONS_DIR = path.resolve(__dirname, '../db/migrations');
const logger = pino({ level: 'silent' });

function setupDb() {
  const dataDir = createTempUserDataDir('aria-ingestion');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  db.pragma('foreign_keys=ON');
  return db;
}

function seedFolder(
  db: ReturnType<typeof setupDb>,
  id: string,
  sensitivity: 'general' | 'sensitive',
) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO knowledge_folders (id, path, label, sensitivity, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`
  ).run(id, `/tmp/${id}`, id, sensitivity, now, now);
}

function seedFile(
  db: ReturnType<typeof setupDb>,
  id: string,
  folderId: string,
  relativePath: string,
) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO knowledge_files (id, folder_id, relative_path, absolute_path, size, mtime, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 100, ?, 'pending', ?, ?)`
  ).run(id, folderId, relativePath, `/tmp/${folderId}/${relativePath}`, now, now, now);
}

// Stub parser that returns canned text
function makeStubParser(text: string) {
  return {
    parse: vi.fn(async () => ({
      text,
      sectionLocators: [],
      truncated: false,
    })),
  };
}

describe('FolderIngestionService', () => {
  let db: ReturnType<typeof setupDb>;

  beforeEach(() => {
    db = setupDb();
  });

  it('assertion 1: produces rag_chunk rows with source_kind=folder, folder_id, file_id, sensitivity', async () => {
    seedFolder(db, 'f-sensitive', 'sensitive');
    seedFolder(db, 'f-general', 'general');
    seedFile(db, 'file-s1', 'f-sensitive', 'doc.md');
    seedFile(db, 'file-g1', 'f-general', 'note.txt');
    seedFile(db, 'file-g2', 'f-general', 'data.csv');

    const registry = createFolderRegistry(db);
    const parsers: Record<string, ReturnType<typeof makeStubParser>> = {
      '.md': makeStubParser('sensitive folder content'),
      '.txt': makeStubParser('general note content'),
      '.csv': makeStubParser('general csv content'),
    };

    const svc = createFolderIngestionService({ db, logger, registry, parsers, strategy: strategyA });

    await svc.ingestFolderOnce('f-sensitive');
    await svc.ingestFolderOnce('f-general');

    const rows = db.prepare(
      `SELECT source_kind, folder_id, file_id, sensitivity, sensitivity_model FROM rag_chunk`
    ).all() as Array<{
      source_kind: string;
      folder_id: string;
      file_id: string;
      sensitivity: string;
      sensitivity_model: string;
    }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.source_kind).toBe('folder');
    }

    const sensitiveChunk = rows.find((r) => r.folder_id === 'f-sensitive');
    expect(sensitiveChunk).toBeDefined();
    expect(sensitiveChunk!.file_id).toBe('file-s1');
    expect(sensitiveChunk!.sensitivity).toBe('folder:high');
    expect(sensitiveChunk!.sensitivity_model).toBe('folder-rule:v1');

    const generalChunk = rows.find((r) => r.folder_id === 'f-general');
    expect(generalChunk).toBeDefined();
    expect(generalChunk!.sensitivity).toBe('folder:low');
  });

  it('assertion 2: sensitivity_model=folder-rule:v1 on all produced rows', async () => {
    seedFolder(db, 'f-m', 'general');
    seedFile(db, 'file-m1', 'f-m', 'a.md');
    const registry = createFolderRegistry(db);
    const svc = createFolderIngestionService({
      db, logger, registry,
      parsers: { '.md': makeStubParser('content') },
      strategy: strategyA,
    });
    await svc.ingestFolderOnce('f-m');
    const rows = db.prepare(`SELECT sensitivity_model FROM rag_chunk WHERE source_kind='folder'`)
      .all() as Array<{ sensitivity_model: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.sensitivity_model).toBe('folder-rule:v1');
    }
  });

  it('assertion 3: deleting file cascades to zero rag_chunk rows for that file', async () => {
    seedFolder(db, 'f-cas', 'general');
    seedFile(db, 'file-cas1', 'f-cas', 'b.txt');
    const registry = createFolderRegistry(db);
    const svc = createFolderIngestionService({
      db, logger, registry,
      parsers: { '.txt': makeStubParser('cascade test') },
      strategy: strategyA,
    });
    await svc.ingestFolderOnce('f-cas');
    const before = (db.prepare(`SELECT COUNT(*) AS n FROM rag_chunk WHERE file_id='file-cas1'`).get() as { n: number }).n;
    expect(before).toBeGreaterThan(0);

    db.prepare(`DELETE FROM knowledge_files WHERE id='file-cas1'`).run();
    const after = (db.prepare(`SELECT COUNT(*) AS n FROM rag_chunk WHERE file_id='file-cas1'`).get() as { n: number }).n;
    expect(after).toBe(0);
  });

  it('assertion 4: list-folders bytesIndexed includes error-status files', () => {
    seedFolder(db, 'f-bytes', 'general');
    const now = new Date().toISOString();
    // Seed one indexed + one error file
    db.prepare(
      `INSERT INTO knowledge_files (id, folder_id, relative_path, absolute_path, size, mtime, status, created_at, updated_at)
       VALUES ('file-bi1', 'f-bytes', 'good.txt', '/tmp/good.txt', 2000, ?, 'indexed', ?, ?)`
    ).run(now, now, now);
    db.prepare(
      `INSERT INTO knowledge_files (id, folder_id, relative_path, absolute_path, size, mtime, status, created_at, updated_at)
       VALUES ('file-bi2', 'f-bytes', 'bad.pdf', '/tmp/bad.pdf', 1000, ?, 'error', ?, ?)`
    ).run(now, now, now);

    const registry = createFolderRegistry(db);
    const bytes = registry.sumBytesForFolder('f-bytes');
    expect(bytes).toBe(3000);
  });
});
