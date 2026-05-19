import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import pino from 'pino';
import { openDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';
import { createIndexWorker } from '../../../../src/main/rag/index-worker';
import { BruteForceStore } from '../../../../src/main/rag/vector-store';
import type { EmbedClient } from '../../../../src/main/rag/ollama-embeddings';
import { OllamaEmbedError } from '../../../../src/main/rag/ollama-embeddings';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

function setupDb() {
  const dataDir = createTempUserDataDir('aria-iw-worker');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

function rand768(): Float32Array {
  const v = new Float32Array(768);
  let s = 0;
  for (let i = 0; i < 768; i++) {
    v[i] = Math.random();
    s += v[i]! * v[i]!;
  }
  const n = Math.sqrt(s);
  for (let i = 0; i < 768; i++) v[i] = v[i]! / n;
  return v;
}

function seedDirty(db: ReturnType<typeof setupDb>, n: number) {
  const now = new Date().toISOString();
  for (let i = 0; i < n; i++) {
    db.prepare(
      `INSERT INTO rag_chunk (id, source_kind, source_id, text, char_start, char_end, token_count, dirty, created_at, updated_at)
       VALUES (?, 'email', ?, 'hello', 0, 5, 1, 1, ?, ?)`,
    ).run(`c${i}`, `s${i}`, now, now);
    db.prepare(
      `INSERT INTO rag_source_dirty (source_kind, source_id, target_model_id, enqueued_at, attempts)
       VALUES ('email', ?, NULL, ?, 0)`,
    ).run(`s${i}`, now);
  }
}

function makeEmbedClient(opts: { failBatch?: number; dim?: number } = {}): EmbedClient {
  let call = 0;
  return {
    modelId: 'nomic-embed-text:v1.5',
    dim: opts.dim ?? 768,
    async embed(inputs: string[]) {
      call++;
      if (opts.failBatch === call) {
        throw new OllamaEmbedError('connection_refused', 'ECONNREFUSED');
      }
      return inputs.map(() => rand768());
    },
  };
}

describe('IndexWorker — Plan 07-02 Task 4', () => {
  let db: ReturnType<typeof setupDb>;
  const logger = pino({ level: 'silent' });

  beforeEach(() => {
    db = setupDb();
  });

  it('drains the queue and marks chunks clean', async () => {
    seedDirty(db, 5);
    const store = new BruteForceStore(db);
    const worker = createIndexWorker({
      db,
      logger,
      embedClient: makeEmbedClient(),
      vectorStore: store,
    });
    const { embedded } = await worker.drainOnce();
    expect(embedded).toBe(5);
    const dirty = db.prepare(`SELECT count(*) AS n FROM rag_chunk WHERE dirty = 1`).get() as { n: number };
    expect(dirty.n).toBe(0);
    const queue = db.prepare(`SELECT count(*) AS n FROM rag_source_dirty`).get() as { n: number };
    expect(queue.n).toBe(0);
    const emb = db.prepare(`SELECT count(*) AS n FROM rag_embedding`).get() as { n: number };
    expect(emb.n).toBe(5);
  });

  it('failure increments attempts and leaves the row dirty (idempotent restart)', async () => {
    seedDirty(db, 3);
    const store = new BruteForceStore(db);
    const worker = createIndexWorker({
      db,
      logger,
      embedClient: makeEmbedClient({ failBatch: 1 }),
      vectorStore: store,
    });
    await worker.drainOnce();
    const attemptsRows = db
      .prepare(`SELECT attempts FROM rag_source_dirty`)
      .all() as Array<{ attempts: number }>;
    const totalAttempts = attemptsRows.reduce((s, r) => s + r.attempts, 0);
    expect(totalAttempts).toBeGreaterThan(0);
    // At least one source remained dirty.
    const dirty = db.prepare(`SELECT count(*) AS n FROM rag_chunk WHERE dirty = 1`).get() as { n: number };
    expect(dirty.n).toBeGreaterThan(0);
    const progress = worker.getProgress();
    expect(progress.lastErrorKind).toBe('connection_refused');
  });

  it('dim mismatch surfaces in lastError and never stores wrong-dim vector', async () => {
    seedDirty(db, 1);
    const store = new BruteForceStore(db);
    const badClient: EmbedClient = {
      modelId: 'nomic',
      dim: 512,
      async embed(inputs) {
        return inputs.map(() => new Float32Array(512));
      },
    };
    const worker = createIndexWorker({
      db,
      logger,
      embedClient: badClient,
      vectorStore: store,
    });
    await worker.drainOnce();
    const emb = db.prepare(`SELECT count(*) AS n FROM rag_embedding`).get() as { n: number };
    expect(emb.n).toBe(0);
    const progress = worker.getProgress();
    expect(progress.lastErrorMessage).toContain('dim mismatch');
  });

  it('model-swap rebuild path increments rebuild_progress_done atomically', async () => {
    // One source enqueued with a target_model_id (rebuild against new model).
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO rag_chunk (id, source_kind, source_id, text, char_start, char_end, token_count, dirty, created_at, updated_at)
       VALUES ('c1', 'email', 's1', 'x', 0, 1, 1, 1, ?, ?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO rag_source_dirty (source_kind, source_id, target_model_id, enqueued_at)
       VALUES ('email', 's1', 'nomic-embed-text:v2', ?)`,
    ).run(now);
    db.prepare(
      `UPDATE rag_index_state SET rebuild_in_progress = 1, rebuild_target_model_id = 'nomic-embed-text:v2', rebuild_target_dim = 768, rebuild_progress_done = 0, rebuild_progress_total = 1, updated_at = ? WHERE id = 1`,
    ).run(now);

    const store = new BruteForceStore(db);
    const worker = createIndexWorker({ db, logger, embedClient: makeEmbedClient(), vectorStore: store });
    await worker.drainOnce();
    const row = db
      .prepare(`SELECT rebuild_progress_done FROM rag_index_state WHERE id = 1`)
      .get() as { rebuild_progress_done: number };
    expect(row.rebuild_progress_done).toBe(1);
  });
});
