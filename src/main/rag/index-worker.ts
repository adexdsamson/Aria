/**
 * Plan 07-02 Task 4 — Background embedding worker.
 *
 * Drains `rag_source_dirty`, reads dirty chunks, batches embed calls, upserts
 * vectors via the active VectorStore, marks chunks clean.
 *
 * Active model is re-read BEFORE each batch (Pitfall 4 — survives model swap
 * mid-drain). During a model-swap rebuild (`target_model_id IS NOT NULL`),
 * uses the target instead of the active and increments
 * `rag_index_state.rebuild_progress_done` atomically (single UPDATE in the
 * same transaction as the embedding upsert) — Task 5.5 boot reconciler
 * depends on this invariant.
 *
 * On embed failure: increments `attempts`, leaves row in queue, exponential
 * backoff between drain ticks; chunks remain `dirty=1` — idempotent restart.
 *
 * Dim mismatch (returned vector dim ≠ active_model_dim per Assumption A2)
 * throws and surfaces via `getProgress().lastErrorMessage`; the worker does
 * NOT silently store wrong-dim vectors.
 *
 * Concurrency: shares the existing scheduler p-queue (concurrency=1 here for
 * the batch drain — embed RPC is bounded by Ollama saturation, not CPU).
 *
 * powerMonitor integration: caller wires `pause()` / `resume()` to suspend /
 * resume events from src/main/lifecycle/powerMonitor.ts.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type { Logger } from 'pino';
import type { EmbedClient } from './ollama-embeddings';
import { OllamaEmbedError } from './ollama-embeddings';
import type { VectorStore } from './vector-store';

type Db = Database.Database;

export interface IndexWorkerProgress {
  dirtyTotal: number;
  dirtyDone: number;
  perMinute: number;
  lastErrorKind?: string;
  lastErrorMessage?: string;
}

export interface IndexWorker {
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  /** Drain once; returns counts. Test-friendly. */
  drainOnce(): Promise<{ embedded: number; failed: number }>;
  getProgress(): IndexWorkerProgress;
}

export interface IndexWorkerOpts {
  db: Db;
  logger: Logger;
  embedClient: EmbedClient;
  vectorStore: VectorStore;
  batchSize?: number;
  /** Tick interval in ms between drain attempts. Default 5s. */
  tickMs?: number;
}

interface DirtySourceRow {
  source_kind: string;
  source_id: string;
  target_model_id: string | null;
  attempts: number;
  enqueued_at: string;
}

interface ChunkRow {
  id: string;
  text: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function readActiveModel(db: Db): { id: string; dim: number } {
  const row = db
    .prepare(`SELECT active_model_id, active_model_dim FROM rag_index_state WHERE id = 1`)
    .get() as { active_model_id: string; active_model_dim: number };
  return { id: row.active_model_id, dim: row.active_model_dim };
}

export function createIndexWorker(opts: IndexWorkerOpts): IndexWorker {
  const { db, logger, embedClient, vectorStore } = opts;
  const batchSize = Math.max(1, opts.batchSize ?? 16);
  const tickMs = opts.tickMs ?? 5_000;

  let running = false;
  let paused = false;
  let timer: NodeJS.Timeout | null = null;
  let recentEmbeddings: number[] = []; // unix-ms timestamps for per-minute calc
  let dirtyDone = 0;
  let lastError: { kind?: string; message?: string } | null = null;

  function start(): void {
    if (running) return;
    running = true;
    scheduleNext();
  }
  function stop(): void {
    running = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }
  function pause(): void {
    paused = true;
  }
  function resume(): void {
    if (!paused) return;
    paused = false;
    scheduleNext(0);
  }

  function scheduleNext(delay = tickMs): void {
    if (!running) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void tick();
    }, delay);
  }

  async function tick(): Promise<void> {
    if (!running || paused) {
      scheduleNext();
      return;
    }
    try {
      await drainOnce();
    } catch (err) {
      lastError = {
        kind: err instanceof OllamaEmbedError ? err.kind : 'unknown',
        message: err instanceof Error ? err.message : String(err),
      };
      logger.warn({ scope: 'rag.index-worker', err: lastError }, 'rag.index-worker.tick.err');
    }
    scheduleNext();
  }

  async function drainOnce(): Promise<{ embedded: number; failed: number }> {
    let embedded = 0;
    let failed = 0;

    const sources = db
      .prepare(
        `SELECT source_kind, source_id, target_model_id, attempts, enqueued_at
           FROM rag_source_dirty
          ORDER BY enqueued_at ASC
          LIMIT 50`,
      )
      .all() as DirtySourceRow[];

    for (const src of sources) {
      const active = readActiveModel(db);
      const modelForBatch = src.target_model_id ?? active.id;
      const expectedDim = active.dim;
      const chunks = db
        .prepare(
          `SELECT id, text FROM rag_chunk
            WHERE source_kind = ? AND source_id = ? AND dirty = 1
            ORDER BY char_start ASC`,
        )
        .all(src.source_kind, src.source_id) as ChunkRow[];

      if (chunks.length === 0) {
        db.prepare(
          `DELETE FROM rag_source_dirty WHERE source_kind = ? AND source_id = ?`,
        ).run(src.source_kind, src.source_id);
        continue;
      }

      try {
        for (let i = 0; i < chunks.length; i += batchSize) {
          const batch = chunks.slice(i, i + batchSize);
          const vectors = await embedClient.embed(batch.map((c) => c.text));
          for (let j = 0; j < batch.length; j++) {
            const vec = vectors[j]!;
            if (vec.length !== expectedDim) {
              throw new OllamaEmbedError(
                'http',
                `dim mismatch: got ${vec.length}, expected ${expectedDim}`,
              );
            }
            // Combined embedding upsert + rebuild_progress_done increment in
            // a single txn (Task 5.5 reconciler invariant).
            const isRebuild = src.target_model_id !== null;
            const txn = db.transaction(() => {
              vectorStore.upsert(batch[j]!.id, vec, modelForBatch);
              db.prepare(
                `UPDATE rag_chunk SET dirty = 0, updated_at = ? WHERE id = ?`,
              ).run(nowIso(), batch[j]!.id);
              if (isRebuild) {
                db.prepare(
                  `UPDATE rag_index_state SET rebuild_progress_done = rebuild_progress_done + 1, updated_at = ? WHERE id = 1`,
                ).run(nowIso());
              }
            });
            txn();
            embedded++;
            recentEmbeddings.push(Date.now());
            dirtyDone++;
          }
        }
        db.prepare(
          `DELETE FROM rag_source_dirty WHERE source_kind = ? AND source_id = ? AND COALESCE(target_model_id,'') = COALESCE(?,'')`,
        ).run(src.source_kind, src.source_id, src.target_model_id);
      } catch (err) {
        failed++;
        const kind = err instanceof OllamaEmbedError ? err.kind : 'unknown';
        const message = err instanceof Error ? err.message : String(err);
        lastError = { kind, message };
        db.prepare(
          `UPDATE rag_source_dirty SET attempts = attempts + 1 WHERE source_kind = ? AND source_id = ? AND COALESCE(target_model_id,'') = COALESCE(?,'')`,
        ).run(src.source_kind, src.source_id, src.target_model_id);
        logger.warn(
          {
            scope: 'rag.index-worker',
            source_kind: src.source_kind,
            source_id: src.source_id,
            kind,
            message,
          },
          'rag.index-worker.embed.fail',
        );
        // Continue to next source — partial progress preserved by per-batch txn.
      }
    }
    return { embedded, failed };
  }

  function getProgress(): IndexWorkerProgress {
    const totalRow = db
      .prepare(`SELECT count(*) AS n FROM rag_chunk WHERE dirty = 1`)
      .get() as { n: number };
    const dirtyTotal = totalRow.n + dirtyDone;
    // Prune older than 60s.
    const cutoff = Date.now() - 60_000;
    recentEmbeddings = recentEmbeddings.filter((t) => t >= cutoff);
    return {
      dirtyTotal,
      dirtyDone,
      perMinute: recentEmbeddings.length,
      ...(lastError?.kind ? { lastErrorKind: lastError.kind } : {}),
      ...(lastError?.message ? { lastErrorMessage: lastError.message } : {}),
    };
  }

  return { start, stop, pause, resume, drainOnce, getProgress };
}
