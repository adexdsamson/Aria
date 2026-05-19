import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import pino from 'pino';
import { openDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';
import { reconcileModelSwap } from '../../../../src/main/rag/model-swap-reconciler';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

function setupDb() {
  const dataDir = createTempUserDataDir('aria-rec');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

function seedChunks(db: ReturnType<typeof setupDb>, n: number) {
  const now = new Date().toISOString();
  for (let i = 0; i < n; i++) {
    db.prepare(
      `INSERT INTO rag_chunk (id, source_kind, source_id, text, char_start, char_end, token_count, created_at, updated_at)
       VALUES (?, 'email', ?, 'x', 0, 1, 1, ?, ?)`,
    ).run(`c${i}`, `s${i}`, now, now);
  }
}

function seedEmbeddings(db: ReturnType<typeof setupDb>, count: number, modelId: string) {
  const now = new Date().toISOString();
  for (let i = 0; i < count; i++) {
    db.prepare(
      `INSERT INTO rag_embedding (chunk_id, model_id, dim, vector, embedding_norm, embedded_at)
       VALUES (?, ?, 768, ?, 1, ?)`,
    ).run(`c${i}`, modelId, Buffer.alloc(768 * 4), now);
  }
}

function setRebuildState(db: ReturnType<typeof setupDb>, target: string, dim = 768) {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE rag_index_state
       SET rebuild_in_progress = 1,
           rebuild_target_model_id = ?,
           rebuild_target_dim = ?,
           rebuild_started_at = ?,
           updated_at = ?
     WHERE id = 1`,
  ).run(target, dim, now, now);
}

describe('reconcileModelSwap — REVIEWS C3', () => {
  let db: ReturnType<typeof setupDb>;
  const logger = pino({ level: 'silent' });

  beforeEach(() => {
    db = setupDb();
  });

  it('Case A: crash AFTER done==total, BEFORE flip UPDATE → flips + schedules sweep', async () => {
    seedChunks(db, 3);
    setRebuildState(db, 'nomic-v2');
    seedEmbeddings(db, 3, 'nomic-v2');
    const scheduleSweep = vi.fn();
    const res = await reconcileModelSwap({ db, logger, scheduleSweep });
    expect(res.recovered).toBe('completed-flip');
    const state = db
      .prepare(`SELECT active_model_id, rebuild_in_progress FROM rag_index_state WHERE id = 1`)
      .get() as { active_model_id: string; rebuild_in_progress: number };
    expect(state.active_model_id).toBe('nomic-v2');
    expect(state.rebuild_in_progress).toBe(0);
    expect(scheduleSweep).toHaveBeenCalledWith('nomic-embed-text:v1.5');
  });

  it('Case B: crash with done < total → leaves state intact, returns resumed-drain', async () => {
    seedChunks(db, 5);
    setRebuildState(db, 'nomic-v2');
    seedEmbeddings(db, 4, 'nomic-v2'); // 4 of 5
    const res = await reconcileModelSwap({ db, logger });
    expect(res.recovered).toBe('resumed-drain');
    const state = db
      .prepare(`SELECT rebuild_in_progress, active_model_id FROM rag_index_state WHERE id = 1`)
      .get() as { rebuild_in_progress: number; active_model_id: string };
    expect(state.rebuild_in_progress).toBe(1);
    expect(state.active_model_id).toBe('nomic-embed-text:v1.5');
  });

  it('Case B (done==0): full queue still pending → resumed-drain', async () => {
    seedChunks(db, 3);
    setRebuildState(db, 'nomic-v2');
    const res = await reconcileModelSwap({ db, logger });
    expect(res.recovered).toBe('resumed-drain');
  });

  it('Case C: rebuild_in_progress=1 but total==0 → ambiguous-noop, no state change', async () => {
    setRebuildState(db, 'nomic-v2');
    const res = await reconcileModelSwap({ db, logger });
    expect(res.recovered).toBe('ambiguous-noop');
    const state = db
      .prepare(`SELECT rebuild_in_progress FROM rag_index_state WHERE id = 1`)
      .get() as { rebuild_in_progress: number };
    expect(state.rebuild_in_progress).toBe(1);
  });

  it('Case D: no rebuild in flight → noop', async () => {
    const res = await reconcileModelSwap({ db, logger });
    expect(res.recovered).toBe('noop');
  });
});
