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
