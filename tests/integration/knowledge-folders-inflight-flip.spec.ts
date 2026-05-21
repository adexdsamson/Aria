/**
 * Plan 10-03 Task 2 — Knowledge Folders in-flight sensitivity flip spec.
 *
 * Tests Case 5 of the sensitivity test contract: a pending answer-service call
 * completes with the pre-flip snapshot; the next call respects the new value.
 *
 * Mechanism:
 *   - chunk retrieval is synchronous (DB read returns folder:low snapshot)
 *   - routeAnswer is called with that snapshot -> FRONTIER decision
 *   - flipFolderSensitivity is called while LLM dispatch is "in-flight"
 *     (simulated by a deferred Promise that we control)
 *   - the first call resolves against its PRE-flip snapshot (FRONTIER)
 *   - a second retrieval reads the DB and gets folder:high -> LOCAL
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import pino from 'pino';
import { openDb } from '../../src/main/db/connect';
import { runMigrations } from '../../src/main/db/migrations/runner';
import { createFolderRegistry } from '../../src/main/folder-ingestion/folder-registry';
import { createFolderIngestionService } from '../../src/main/folder-ingestion/ingestion-service';
import { flipFolderSensitivity } from '../../src/main/folder-ingestion/folder-flip';
import { strategyA } from '../../src/main/rag/chunk-strategies';
import { routeAnswer, type RouterChunk } from '../../src/main/rag/answer-router';
import { createTempUserDataDir } from '../setup';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../src/main/db/migrations');
const logger = pino({ level: 'silent' });

function setupDb() {
  const dataDir = createTempUserDataDir('aria-inflight-flip');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  db.pragma('foreign_keys=ON');
  return db;
}

function makeTempFolder(): string {
  const dir = path.join(os.tmpdir(), `aria-kf-flip-${crypto.randomBytes(8).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Deferred promise helper — lets us control when the "LLM dispatch" resolves.
 */
function deferred<T>(): { promise: Promise<T>; resolve(v: T): void; reject(e: unknown): void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Read all rag_chunk rows for a folder and convert to RouterChunk format.
 * This represents a "retrieval snapshot" taken at a point in time.
 */
function snapshotChunks(db: ReturnType<typeof setupDb>, folderId: string): RouterChunk[] {
  const rows = db.prepare(
    `SELECT id, text, source_kind, folder_id, sensitivity FROM rag_chunk WHERE folder_id = ?`
  ).all(folderId) as Array<{ id: string; text: string; source_kind: string; folder_id: string; sensitivity: string }>;

  return rows.map((c) => ({
    id: c.id,
    text: c.text,
    sourceKind: c.source_kind as 'folder',
    sourceId: c.folder_id,
    title: 'test',
    sensitivity: c.sensitivity,
  }));
}

describe('Knowledge Folders in-flight flip: case 5 sensitivity contract', () => {
  let db: ReturnType<typeof setupDb>;
  let tmpDir: string;
  let folderId: string;

  beforeEach(async () => {
    db = setupDb();
    tmpDir = makeTempFolder();
    fs.writeFileSync(path.join(tmpDir, 'doc.md'), '# Doc\n\nContent for in-flight flip test.');
    fs.writeFileSync(path.join(tmpDir, 'note.txt'), 'Note content for in-flight flip test.');

    // Setup folder and ingest
    const registry = createFolderRegistry(db);
    const folder = registry.addFolder({ path: tmpDir, label: 'In-Flight Test', sensitivity: 'general' });
    folderId = folder.id;

    for (const f of ['doc.md', 'note.txt']) {
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
      },
      strategy: strategyA,
    });

    await svc.ingestFolderOnce(folder.id);
  });

  it('pre-condition: folder starts as general (folder:low)', () => {
    const rows = db.prepare(
      `SELECT sensitivity FROM rag_chunk WHERE folder_id = ?`
    ).all(folderId) as Array<{ sensitivity: string }>;

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.sensitivity).toBe('folder:low');
    }
  });

  it('case 5: in-flight call uses pre-flip snapshot (FRONTIER); post-flip call sees folder:high (LOCAL)', async () => {
    // 1. Take the pre-flip chunk snapshot (simulates retrieval step of answer-service)
    const preFlipSnapshot = snapshotChunks(db, folderId);
    expect(preFlipSnapshot.length).toBeGreaterThan(0);

    // All chunks in snapshot should be folder:low
    for (const c of preFlipSnapshot) {
      expect(c.sensitivity).toBe('folder:low');
    }

    // 2. Route decision is made from the snapshot (FRONTIER)
    const preFlipDecision = routeAnswer('test question', preFlipSnapshot);
    expect(preFlipDecision.route).toBe('FRONTIER');

    // 3. Create a deferred "LLM dispatch" to simulate an in-flight async call
    const llmDeferred = deferred<string>();
    // This represents the LLM call that is pending...
    const inflightCall = llmDeferred.promise.then((answer) => ({
      answer,
      route: preFlipDecision.route, // decision was already made from snapshot
    }));

    // 4. While the LLM call is "in-flight", flip the folder to sensitive
    const flipResult = flipFolderSensitivity(db, folderId, 'sensitive');
    expect(flipResult.chunksUpdated).toBeGreaterThan(0);

    // Verify DB now has folder:high
    const dbRows = db.prepare(
      `SELECT sensitivity FROM rag_chunk WHERE folder_id = ?`
    ).all(folderId) as Array<{ sensitivity: string }>;
    for (const row of dbRows) {
      expect(row.sensitivity).toBe('folder:high');
    }

    // 5. Resolve the deferred LLM stub
    llmDeferred.resolve('This is the answer from the in-flight call.');
    const inflightResult = await inflightCall;

    // The in-flight call completed with FRONTIER (pre-flip route, not affected by DB change)
    expect(inflightResult.route).toBe('FRONTIER');
    expect(inflightResult.answer).toContain('in-flight call');

    // 6. A second retrieval (fresh snapshot) sees folder:high -> LOCAL
    const postFlipSnapshot = snapshotChunks(db, folderId);
    const postFlipDecision = routeAnswer('test question', postFlipSnapshot);
    expect(postFlipDecision.route).toBe('LOCAL');
    expect(postFlipDecision.reason).toBe('rag-answer:sensitivity-folder:high');
  });
});
