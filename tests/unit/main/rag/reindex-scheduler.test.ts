import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import pino from 'pino';
import { openDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';
import { createReindexScheduler } from '../../../../src/main/rag/reindex-scheduler';
import { createIndexWriter } from '../../../../src/main/rag/index-writer';
import { BruteForceStore } from '../../../../src/main/rag/vector-store';
import { strategyA } from '../../../../src/main/rag/chunk-strategies';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

function setup() {
  const dataDir = createTempUserDataDir('aria-reindex');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  const logger = pino({ level: 'silent' });
  const writer = createIndexWriter({
    db,
    logger,
    strategy: strategyA,
    classify: async () => 'none' as const,
    classifierModelId: 'router-v1',
  });
  const store = new BruteForceStore(db);
  const sched = createReindexScheduler({
    db,
    logger,
    indexWriter: writer,
    vectorStore: store,
    hasSingleInstanceLock: () => true,
  });
  return { db, sched, writer, store };
}

describe('ReindexScheduler — Plan 07-02 Task 5', () => {
  it('markDirty enqueues a row', () => {
    const { db, sched } = setup();
    sched.markDirty('email', 'm1');
    const row = db
      .prepare(`SELECT source_kind, source_id, target_model_id FROM rag_source_dirty`)
      .all() as Array<{ source_kind: string; source_id: string; target_model_id: string | null }>;
    expect(row).toEqual([{ source_kind: 'email', source_id: 'm1', target_model_id: null }]);
  });

  it('startModelSwap enqueues every chunk source with target_model_id', async () => {
    const { db, sched, writer } = setup();
    await writer.upsertSource({
      sourceKind: 'email',
      sourceId: 'm1',
      title: 'subj',
      text: 'body',
    });
    await writer.upsertSource({
      sourceKind: 'event',
      sourceId: 'e1',
      title: 'evt',
      text: 'agenda',
    });
    const { enqueuedSources } = sched.startModelSwap('nomic-v2', 768);
    expect(enqueuedSources).toBe(2);
    const rows = db
      .prepare(`SELECT source_id, target_model_id FROM rag_source_dirty WHERE target_model_id = 'nomic-v2'`)
      .all() as Array<{ source_id: string; target_model_id: string }>;
    expect(rows.length).toBe(2);
    const state = db
      .prepare(`SELECT rebuild_in_progress, rebuild_target_model_id, rebuild_progress_total FROM rag_index_state WHERE id = 1`)
      .get() as { rebuild_in_progress: number; rebuild_target_model_id: string; rebuild_progress_total: number };
    expect(state.rebuild_in_progress).toBe(1);
    expect(state.rebuild_target_model_id).toBe('nomic-v2');
    expect(state.rebuild_progress_total).toBe(2);
  });

  it('tryCompleteFlip is a no-op when done < total', () => {
    const { sched } = setup();
    sched.startModelSwap('nomic-v2', 768);
    expect(sched.tryCompleteFlip().flipped).toBe(false);
  });

  it('tryCompleteFlip performs atomic flip when done >= total', async () => {
    const { db, sched, writer } = setup();
    await writer.upsertSource({ sourceKind: 'email', sourceId: 'm1', title: 's', text: 'b' });
    sched.startModelSwap('nomic-v2', 768);
    // Simulate worker completion.
    db.prepare(
      `UPDATE rag_index_state SET rebuild_progress_done = rebuild_progress_total WHERE id = 1`,
    ).run();
    const res = sched.tryCompleteFlip();
    expect(res.flipped).toBe(true);
    expect(res.oldModelId).toBe('nomic-embed-text:v1.5');
    const state = db
      .prepare(`SELECT active_model_id, rebuild_in_progress, rebuild_completed_at FROM rag_index_state WHERE id = 1`)
      .get() as { active_model_id: string; rebuild_in_progress: number; rebuild_completed_at: string };
    expect(state.active_model_id).toBe('nomic-v2');
    expect(state.rebuild_in_progress).toBe(0);
    expect(state.rebuild_completed_at).toBeTruthy();
  });

  it('startModelSwap refuses when single-instance lock predicate is false', () => {
    const { db } = setup();
    const sched = createReindexScheduler({
      db,
      logger: pino({ level: 'silent' }),
      indexWriter: createIndexWriter({
        db,
        logger: pino({ level: 'silent' }),
        strategy: strategyA,
        classify: async () => 'none' as const,
        classifierModelId: 'router-v1',
      }),
      vectorStore: new BruteForceStore(db),
      hasSingleInstanceLock: () => false,
    });
    expect(() => sched.startModelSwap('nomic-v2', 768)).toThrow(/single.?instance/i);
  });

  it('sweepOldModel removes embeddings stamped with the old modelId', () => {
    const { db, sched, store } = setup();
    // Seed a chunk + two embeddings (old + new models).
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO rag_chunk (id, source_kind, source_id, text, char_start, char_end, token_count, created_at, updated_at)
       VALUES ('c1', 'email', 's1', 'x', 0, 1, 1, ?, ?)`,
    ).run(now, now);
    const v = new Float32Array(768);
    v[0] = 1;
    store.upsert('c1', v, 'nomic-v1');
    // Manually add a stub for new model so sweep isolates the old.
    db.prepare(
      `INSERT INTO rag_embedding (chunk_id, model_id, dim, vector, embedding_norm, embedded_at)
       VALUES ('c1','nomic-v2',768,?,1,?)`,
    ).run(Buffer.alloc(768 * 4), now);
    sched.sweepOldModel('nomic-v1');
    const left = db.prepare(`SELECT model_id FROM rag_embedding`).all() as Array<{ model_id: string }>;
    expect(left.map((r) => r.model_id)).toEqual(['nomic-v2']);
  });
});
