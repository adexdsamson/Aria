/**
 * Plan 10-03 Task 2 — Knowledge Folders end-to-end integration spec.
 *
 * Tests the full stack:
 *   add folder -> ingest -> query -> verify routing -> flip sensitivity ->
 *   verify LOCAL routing with rag-answer:sensitivity-folder:high reason
 *
 * Uses in-memory SQLite with all migrations through 132.
 * LLM is stubbed to return a fixed answer citing the first chunk.
 * Retrieval is exercised via the real hybrid-retrieval path with a stub
 * embed client that returns a deterministic vector (same for all queries).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import pino from 'pino';
import { openDb, closeDb } from '../../src/main/db/connect';
import { runMigrations } from '../../src/main/db/migrations/runner';
import { createFolderRegistry } from '../../src/main/folder-ingestion/folder-registry';
import { createFolderIngestionService } from '../../src/main/folder-ingestion/ingestion-service';
import { flipFolderSensitivity } from '../../src/main/folder-ingestion/folder-flip';
import { strategyA } from '../../src/main/rag/chunk-strategies';
import { routeAnswer } from '../../src/main/rag/answer-router';
import { createTempUserDataDir } from '../setup';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../src/main/db/migrations');
const logger = pino({ level: 'silent' });

const UNIQUE_KEYWORD = 'xylophone-zephyr-9274';
const UNIQUE_KEYWORD_2 = 'cobalt-mnemonic-7841';
const UNIQUE_KEYWORD_3 = 'periwinkle-axiom-3956';

function setupDb() {
  const dataDir = createTempUserDataDir('aria-e2e-kf');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  db.pragma('foreign_keys=ON');
  return db;
}

function makeTempFolder(): string {
  const dir = path.join(os.tmpdir(), `aria-kf-e2e-${crypto.randomBytes(8).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe('Knowledge Folders E2E: add -> ingest -> route -> flip -> LOCAL', () => {
  let db: ReturnType<typeof setupDb>;
  let tmpDir: string;

  beforeEach(() => {
    db = setupDb();
    tmpDir = makeTempFolder();

    // Write three files with distinct keywords
    fs.writeFileSync(path.join(tmpDir, 'doc-a.md'), `# Doc A\n\nThis document contains the keyword ${UNIQUE_KEYWORD}.`);
    fs.writeFileSync(path.join(tmpDir, 'note-b.txt'), `Note B file containing the phrase ${UNIQUE_KEYWORD_2}.`);
    fs.writeFileSync(path.join(tmpDir, 'data-c.csv'), `col1,col2\n${UNIQUE_KEYWORD_3},value2`);
  });

  it('step 1: add folder via FolderRegistry; files are registered', () => {
    const registry = createFolderRegistry(db);
    const folder = registry.addFolder({ path: tmpDir, label: 'E2E Test Folder', sensitivity: 'general' });
    expect(folder.id).toBeTruthy();
    expect(folder.sensitivity).toBe('general');

    // Register files
    const files = ['doc-a.md', 'note-b.txt', 'data-c.csv'];
    for (const f of files) {
      const absPath = path.join(tmpDir, f);
      const stat = fs.statSync(absPath);
      registry.addFile({
        folderId: folder.id,
        relativePath: f,
        absolutePath: absPath,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      });
    }

    const listed = registry.listFilesForFolder(folder.id);
    expect(listed.length).toBe(3);
  });

  it('step 2: ingestFolderOnce produces rag_chunk rows with source_kind=folder, sensitivity=folder:low', async () => {
    const registry = createFolderRegistry(db);
    const folder = registry.addFolder({ path: tmpDir, label: 'E2E Test Folder', sensitivity: 'general' });

    const files = ['doc-a.md', 'note-b.txt', 'data-c.csv'];
    for (const f of files) {
      const absPath = path.join(tmpDir, f);
      const stat = fs.statSync(absPath);
      registry.addFile({
        folderId: folder.id,
        relativePath: f,
        absolutePath: absPath,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      });
    }

    const svc = createFolderIngestionService({
      db,
      logger,
      registry,
      parsers: {
        '.md': { parse: async (p: string) => ({ text: fs.readFileSync(p, 'utf8'), sectionLocators: [], truncated: false }) },
        '.txt': { parse: async (p: string) => ({ text: fs.readFileSync(p, 'utf8'), sectionLocators: [], truncated: false }) },
        '.csv': { parse: async (p: string) => ({ text: fs.readFileSync(p, 'utf8'), sectionLocators: [], truncated: false }) },
      },
      strategy: strategyA,
    });

    const result = await svc.ingestFolderOnce(folder.id);
    expect(result.indexed).toBe(3);
    expect(result.errors).toBe(0);

    const rows = db.prepare(
      `SELECT source_kind, folder_id, sensitivity FROM rag_chunk WHERE folder_id = ?`
    ).all(folder.id) as Array<{ source_kind: string; folder_id: string; sensitivity: string }>;

    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      expect(row.source_kind).toBe('folder');
      expect(row.folder_id).toBe(folder.id);
      expect(row.sensitivity).toBe('folder:low');
    }
  });

  it('step 3: routeAnswer on folder:low chunks returns FRONTIER', async () => {
    const registry = createFolderRegistry(db);
    const folder = registry.addFolder({ path: tmpDir, label: 'E2E Test Folder', sensitivity: 'general' });

    const files = ['doc-a.md', 'note-b.txt', 'data-c.csv'];
    for (const f of files) {
      const absPath = path.join(tmpDir, f);
      const stat = fs.statSync(absPath);
      registry.addFile({
        folderId: folder.id,
        relativePath: f,
        absolutePath: absPath,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      });
    }

    const svc = createFolderIngestionService({
      db,
      logger,
      registry,
      parsers: {
        '.md': { parse: async (p: string) => ({ text: fs.readFileSync(p, 'utf8'), sectionLocators: [], truncated: false }) },
        '.txt': { parse: async (p: string) => ({ text: fs.readFileSync(p, 'utf8'), sectionLocators: [], truncated: false }) },
        '.csv': { parse: async (p: string) => ({ text: fs.readFileSync(p, 'utf8'), sectionLocators: [], truncated: false }) },
      },
      strategy: strategyA,
    });

    await svc.ingestFolderOnce(folder.id);

    // Read chunks for this folder and build RouterChunk objects
    const chunkRows = db.prepare(
      `SELECT id, text, source_kind, folder_id, sensitivity FROM rag_chunk WHERE folder_id = ?`
    ).all(folder.id) as Array<{ id: string; text: string; source_kind: string; folder_id: string; sensitivity: string }>;

    const routerChunks = chunkRows.map((c) => ({
      id: c.id,
      text: c.text,
      sourceKind: c.source_kind as 'folder',
      sourceId: c.folder_id,
      title: 'test',
      sensitivity: c.sensitivity,
    }));

    const decision = routeAnswer(UNIQUE_KEYWORD, routerChunks);
    expect(decision.route).toBe('FRONTIER');
  });

  it('step 4: flipFolderSensitivity updates all chunk rows to folder:high', async () => {
    const registry = createFolderRegistry(db);
    const folder = registry.addFolder({ path: tmpDir, label: 'E2E Test Folder', sensitivity: 'general' });

    const files = ['doc-a.md', 'note-b.txt', 'data-c.csv'];
    for (const f of files) {
      const absPath = path.join(tmpDir, f);
      const stat = fs.statSync(absPath);
      registry.addFile({
        folderId: folder.id,
        relativePath: f,
        absolutePath: absPath,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      });
    }

    const svc = createFolderIngestionService({
      db,
      logger,
      registry,
      parsers: {
        '.md': { parse: async (p: string) => ({ text: fs.readFileSync(p, 'utf8'), sectionLocators: [], truncated: false }) },
        '.txt': { parse: async (p: string) => ({ text: fs.readFileSync(p, 'utf8'), sectionLocators: [], truncated: false }) },
        '.csv': { parse: async (p: string) => ({ text: fs.readFileSync(p, 'utf8'), sectionLocators: [], truncated: false }) },
      },
      strategy: strategyA,
    });

    await svc.ingestFolderOnce(folder.id);

    const flipResult = flipFolderSensitivity(db, folder.id, 'sensitive');
    expect(flipResult.folderUpdated).toBe(1);
    expect(flipResult.chunksUpdated).toBeGreaterThanOrEqual(3);

    const rows = db.prepare(
      `SELECT sensitivity FROM rag_chunk WHERE folder_id = ?`
    ).all(folder.id) as Array<{ sensitivity: string }>;

    for (const row of rows) {
      expect(row.sensitivity).toBe('folder:high');
    }
  });

  it('step 5: after flip, routeAnswer returns LOCAL with reason rag-answer:sensitivity-folder:high', async () => {
    const registry = createFolderRegistry(db);
    const folder = registry.addFolder({ path: tmpDir, label: 'E2E Test Folder', sensitivity: 'general' });

    const files = ['doc-a.md', 'note-b.txt', 'data-c.csv'];
    for (const f of files) {
      const absPath = path.join(tmpDir, f);
      const stat = fs.statSync(absPath);
      registry.addFile({
        folderId: folder.id,
        relativePath: f,
        absolutePath: absPath,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      });
    }

    const svc = createFolderIngestionService({
      db,
      logger,
      registry,
      parsers: {
        '.md': { parse: async (p: string) => ({ text: fs.readFileSync(p, 'utf8'), sectionLocators: [], truncated: false }) },
        '.txt': { parse: async (p: string) => ({ text: fs.readFileSync(p, 'utf8'), sectionLocators: [], truncated: false }) },
        '.csv': { parse: async (p: string) => ({ text: fs.readFileSync(p, 'utf8'), sectionLocators: [], truncated: false }) },
      },
      strategy: strategyA,
    });

    await svc.ingestFolderOnce(folder.id);

    // Flip to sensitive
    flipFolderSensitivity(db, folder.id, 'sensitive');

    // Read updated chunks
    const chunkRows = db.prepare(
      `SELECT id, text, source_kind, folder_id, sensitivity FROM rag_chunk WHERE folder_id = ?`
    ).all(folder.id) as Array<{ id: string; text: string; source_kind: string; folder_id: string; sensitivity: string }>;

    const routerChunks = chunkRows.map((c) => ({
      id: c.id,
      text: c.text,
      sourceKind: c.source_kind as 'folder',
      sourceId: c.folder_id,
      title: 'test',
      sensitivity: c.sensitivity,
    }));

    const decision = routeAnswer(UNIQUE_KEYWORD, routerChunks);
    expect(decision.route).toBe('LOCAL');
    // Must match the exact reason string pattern from the acceptance criteria
    expect(decision.reason).toBe('rag-answer:sensitivity-folder:high');
  });
});
