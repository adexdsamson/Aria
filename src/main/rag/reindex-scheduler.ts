/**
 * Plan 07-02 Task 5 — Reindex scheduler.
 *
 * Two ingest hooks for Phase 2/5/6 callers:
 *   - `indexInline(doc)`: synchronous upsert via IndexWriter (used for
 *     transcripts / notes / recent mail ≤7d).
 *   - `markDirty(kind, id)`: enqueue-only (used for older mail / calendar
 *     edits; embedding worker drains on next cron tick).
 *
 * Model swap state machine:
 *   - `startModelSwap(newModelId, newDim)`: sets rag_index_state.rebuild_*,
 *     enqueues every existing chunk's source with target_model_id=<new>.
 *   - `tryCompleteFlip()`: caller-watched (heartbeat + queue-empty); when
 *     `rebuild_progress_done >= rebuild_progress_total` runs the atomic flip
 *     (single UPDATE) so active_model_id swings to the target.
 *   - `sweepOldModel(oldId)`: deletes vectors for the old model from the
 *     active VectorStore (run after the flip; not blocking).
 *
 * Concurrency invariant: model swap depends on Phase 5
 * `app.requestSingleInstanceLock()` already holding — `startModelSwap` asserts
 * this via an injected predicate (`hasSingleInstanceLock`) and throws when
 * absent. Tests pass `() => true`.
 *
 * Task 5.5 reconciler recovers from a crash between `done == total` and the
 * flip UPDATE (see model-swap-reconciler.ts).
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type { Logger } from 'pino';
import type { IndexWriter } from './index-writer';
import type { SourceDoc, SourceKind } from './chunk-types';
import type { VectorStore } from './vector-store';

type Db = Database.Database;

export interface ReindexScheduler {
  /** Called inline by callers writing transcripts / notes / recent mail. */
  indexInline(doc: SourceDoc): Promise<void>;
  /** Called by older-mail / calendar edit paths; worker picks up on next tick. */
  markDirty(kind: SourceKind, id: string): void;
  /** Begin a model swap rebuild. */
  startModelSwap(newModelId: string, newDim: number): { enqueuedSources: number };
  /** Check if the swap reached done==total; if so, perform the atomic flip. */
  tryCompleteFlip(): { flipped: boolean; oldModelId?: string };
  /** Remove vectors stamped with the old model after a successful flip. */
  sweepOldModel(oldModelId: string): void;
}

export interface ReindexSchedulerDeps {
  db: Db;
  logger: Logger;
  indexWriter: IndexWriter;
  vectorStore: VectorStore;
  /**
   * Predicate asserting we hold the Phase-5 single-instance lock (so no
   * sibling Aria process can race the swap).
   */
  hasSingleInstanceLock: () => boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createReindexScheduler(deps: ReindexSchedulerDeps): ReindexScheduler {
  const { db, logger, indexWriter, vectorStore, hasSingleInstanceLock } = deps;

  async function indexInline(doc: SourceDoc): Promise<void> {
    await indexWriter.upsertSource(doc);
  }

  function markDirty(kind: SourceKind, id: string): void {
    db.prepare(
      `INSERT OR REPLACE INTO rag_source_dirty (source_kind, source_id, target_model_id, enqueued_at)
       VALUES (?, ?, NULL, ?)`,
    ).run(kind, id, nowIso());
  }

  function startModelSwap(newModelId: string, newDim: number): { enqueuedSources: number } {
    if (!hasSingleInstanceLock()) {
      throw new Error(
        'startModelSwap: refusing to swap without app.requestSingleInstanceLock() (Phase 5 invariant)',
      );
    }
    const now = nowIso();
    const total = (db
      .prepare(`SELECT count(*) AS n FROM rag_chunk WHERE deleted_at IS NULL`)
      .get() as { n: number }).n;
    const sources = db
      .prepare(
        `SELECT DISTINCT source_kind, source_id FROM rag_chunk WHERE deleted_at IS NULL`,
      )
      .all() as Array<{ source_kind: string; source_id: string }>;
    const txn = db.transaction(() => {
      db.prepare(
        `UPDATE rag_index_state
            SET rebuild_in_progress = 1,
                rebuild_target_model_id = ?,
                rebuild_target_dim = ?,
                rebuild_started_at = ?,
                rebuild_progress_total = ?,
                rebuild_progress_done = 0,
                rebuild_completed_at = NULL,
                updated_at = ?
          WHERE id = 1`,
      ).run(newModelId, newDim, now, total, now);
      const ins = db.prepare(
        `INSERT OR REPLACE INTO rag_source_dirty (source_kind, source_id, target_model_id, enqueued_at)
         VALUES (?, ?, ?, ?)`,
      );
      for (const s of sources) {
        ins.run(s.source_kind, s.source_id, newModelId, now);
      }
    });
    txn();
    logger.info(
      { scope: 'rag.reindex', op: 'startModelSwap', newModelId, newDim, total },
      'rag.reindex.startModelSwap',
    );
    return { enqueuedSources: sources.length };
  }

  function tryCompleteFlip(): { flipped: boolean; oldModelId?: string } {
    const state = db
      .prepare(
        `SELECT active_model_id, rebuild_in_progress, rebuild_target_model_id,
                rebuild_target_dim, rebuild_progress_done, rebuild_progress_total
           FROM rag_index_state WHERE id = 1`,
      )
      .get() as {
      active_model_id: string;
      rebuild_in_progress: number;
      rebuild_target_model_id: string | null;
      rebuild_target_dim: number | null;
      rebuild_progress_done: number;
      rebuild_progress_total: number;
    };
    if (
      state.rebuild_in_progress !== 1 ||
      !state.rebuild_target_model_id ||
      state.rebuild_target_dim == null ||
      state.rebuild_progress_total === 0 ||
      state.rebuild_progress_done < state.rebuild_progress_total
    ) {
      return { flipped: false };
    }
    const oldModelId = state.active_model_id;
    const now = nowIso();
    db.prepare(
      `UPDATE rag_index_state
          SET active_model_id = ?,
              active_model_dim = ?,
              rebuild_in_progress = 0,
              rebuild_completed_at = ?,
              updated_at = ?
        WHERE id = 1`,
    ).run(state.rebuild_target_model_id, state.rebuild_target_dim, now, now);
    logger.info(
      { scope: 'rag.reindex', op: 'flip', oldModelId, newModelId: state.rebuild_target_model_id },
      'rag.reindex.flip',
    );
    return { flipped: true, oldModelId };
  }

  function sweepOldModel(oldModelId: string): void {
    vectorStore.deleteByModelId(oldModelId);
    db.prepare(`DELETE FROM rag_embedding WHERE model_id = ?`).run(oldModelId);
    logger.info({ scope: 'rag.reindex', op: 'sweep', oldModelId }, 'rag.reindex.sweep');
  }

  return { indexInline, markDirty, startModelSwap, tryCompleteFlip, sweepOldModel };
}
