/**
 * Plan 10-02 Task 1 — knowledge-folders IPC set-sensitivity test.
 *
 * Tests the IPC handler's delegation to flipFolderSensitivity by exercising
 * the function end-to-end with a real in-memory DB and a synthetic ipcMain stub.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb } from '../db/connect';
import { runMigrations } from '../db/migrations/runner';
import { createFolderRegistry } from '../folder-ingestion/folder-registry';
import { createFolderIngestionService } from '../folder-ingestion/ingestion-service';
import { PARSERS } from '../folder-ingestion/parsers/index';
import { strategyC } from '../rag/chunk-strategies';
import { registerKnowledgeFolderIpc } from './knowledge-folders';
import { CHANNELS } from '../../shared/ipc-contract';
import { createTempUserDataDir } from '../../../tests/setup';

const MIGRATIONS_DIR = path.resolve(__dirname, '../db/migrations');

describe('aria:knowledge:set-sensitivity IPC', () => {
  let db: ReturnType<typeof openDb>;
  let handlers: Map<string, (event: unknown, req: unknown) => Promise<unknown>>;

  beforeEach(() => {
    const dataDir = createTempUserDataDir('aria-ipc-sensitivity-test');
    const dbKey = crypto.randomBytes(32);
    db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });
    db.pragma('foreign_keys=ON');
    handlers = new Map();
  });

  function buildDeps() {
    const registry = createFolderRegistry(db);
    const ingestionService = createFolderIngestionService({
      db,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as import('pino').Logger,
      registry,
      parsers: PARSERS,
      strategy: strategyC,
    });
    const ipcMainStub = {
      handle: (channel: string, handler: (event: unknown, req: unknown) => Promise<unknown>) => {
        handlers.set(channel, handler);
      },
    };
    const dialogStub = {
      showOpenDialog: vi.fn(),
    };
    registerKnowledgeFolderIpc({
      ipcMain: ipcMainStub as unknown as import('electron').IpcMain,
      registry,
      ingestionService,
      dialog: dialogStub,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as import('pino').Logger,
      db,
    });
    return { registry };
  }

  it('set-sensitivity handler delegates to flipFolderSensitivity (not registry.setSensitivity)', async () => {
    const { registry } = buildDeps();
    const folder = registry.addFolder({ path: '/tmp/test', label: 'Test', sensitivity: 'general' });

    // Insert a rag_chunk row with folder_id set
    db.prepare(
      `INSERT INTO rag_chunk (id, source_kind, source_id, title, text, char_start, char_end, token_count,
        sensitivity, sensitivity_model, sensitivity_at, folder_id, file_id)
       VALUES (?, 'folder', ?, 'test', 'text', 0, 4, 1, 'folder:low', 'folder-rule:v1', ?, ?, NULL)`
    ).run(`${folder.id}:chunk:0`, folder.id, new Date().toISOString(), folder.id);

    const handler = handlers.get(CHANNELS.KNOWLEDGE_SET_SENSITIVITY)!;
    expect(handler).toBeTruthy();

    const result = await handler({}, { folderId: folder.id, sensitivity: 'sensitive' }) as {
      ok: boolean;
      folderUpdated: number;
      chunksUpdated: number;
    };

    expect(result.ok).toBe(true);
    expect(result.folderUpdated).toBe(1);
    expect(result.chunksUpdated).toBe(1);

    // Verify the chunk row was updated
    const chunkRow = db
      .prepare(`SELECT sensitivity FROM rag_chunk WHERE folder_id = ?`)
      .get(folder.id) as { sensitivity: string };
    expect(chunkRow.sensitivity).toBe('folder:high');
  });
});
