/**
 * Plan 07-02 Task 5.5 — Boot reconciler for the model-swap flip window (REVIEWS C3).
 *
 * The model-swap state machine (Task 5) has a "hot window" between the
 * moment the worker drains the last chunk and the moment `tryCompleteFlip()`
 * runs the atomic UPDATE. If Aria crashes inside that window, the next boot
 * MUST recover deterministically:
 *
 *   Case A (completed-flip): done >= total > 0 — worker had finished but the
 *     UPDATE never ran. Run the UPDATE now. Schedule a sweep of the old model
 *     on the next tick (do not block boot).
 *   Case B (resumed-drain): done < total — the worker was mid-drain. Leave
 *     state intact; IndexWorker will pick up rag_source_dirty on next start.
 *   Case C (ambiguous-noop): rebuild_in_progress=1 BUT total==0 — corrupt
 *     state. Log error; do not touch state; require operator decision.
 *   Case D (noop): no rebuild in flight.
 *
 * Same architectural pattern as the Phase 5 single-instance + boot-time
 * reconciliation (C4 lesson). Called from src/main/index.ts AFTER openDb +
 * runMigrations + acquireSingleInstanceLock and BEFORE IndexWorker.start.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type { Logger } from 'pino';

type Db = Database.Database;

export type ReconcileResult =
  | { recovered: 'completed-flip'; detail: string }
  | { recovered: 'resumed-drain'; detail: string }
  | { recovered: 'ambiguous-noop' }
  | { recovered: 'noop' };

export interface ReconcileDeps {
  db: Db;
  logger: Logger;
  /**
   * Caller injects a sweep scheduler so the reconciler can ASK for an
   * old-model sweep on next tick without blocking boot. Tests pass a spy.
   */
  scheduleSweep?: (oldModelId: string) => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function reconcileModelSwap(deps: ReconcileDeps): Promise<ReconcileResult> {
  const { db, logger, scheduleSweep } = deps;
  const state = db
    .prepare(
      `SELECT active_model_id, rebuild_in_progress, rebuild_target_model_id,
              rebuild_target_dim
         FROM rag_index_state WHERE id = 1`,
    )
    .get() as {
    active_model_id: string;
    rebuild_in_progress: number;
    rebuild_target_model_id: string | null;
    rebuild_target_dim: number | null;
  } | undefined;

  if (!state || state.rebuild_in_progress !== 1 || !state.rebuild_target_model_id) {
    return { recovered: 'noop' };
  }

  const progressDone = (db
    .prepare(`SELECT count(*) AS n FROM rag_embedding WHERE model_id = ?`)
    .get(state.rebuild_target_model_id) as { n: number }).n;
  const progressTotal = (db
    .prepare(`SELECT count(*) AS n FROM rag_chunk WHERE deleted_at IS NULL`)
    .get() as { n: number }).n;

  if (progressTotal === 0) {
    logger.error(
      {
        scope: 'rag.reconciler',
        event: 'model-swap-recovery-ambiguous',
        active_model_id: state.active_model_id,
        rebuild_target_model_id: state.rebuild_target_model_id,
      },
      'rag.reconciler.ambiguous',
    );
    return { recovered: 'ambiguous-noop' };
  }

  if (progressDone >= progressTotal) {
    // Case A — finish the flip.
    const oldModel = state.active_model_id;
    const now = nowIso();
    db.prepare(
      `UPDATE rag_index_state
          SET active_model_id = rebuild_target_model_id,
              active_model_dim = rebuild_target_dim,
              rebuild_in_progress = 0,
              rebuild_completed_at = ?,
              updated_at = ?
        WHERE id = 1`,
    ).run(now, now);
    if (scheduleSweep) {
      try {
        scheduleSweep(oldModel);
      } catch (err) {
        logger.warn(
          { scope: 'rag.reconciler', err: err instanceof Error ? err.message : String(err) },
          'rag.reconciler.sweepSchedule.fail',
        );
      }
    }
    logger.info(
      {
        scope: 'rag.reconciler',
        event: 'model-swap-recovery-completed-flip',
        oldModel,
        newModel: state.rebuild_target_model_id,
        total: progressTotal,
      },
      'rag.reconciler.completed-flip',
    );
    return {
      recovered: 'completed-flip',
      detail: `flipped ${oldModel} → ${state.rebuild_target_model_id} (total=${progressTotal})`,
    };
  }

  // Case B — worker mid-drain.
  logger.info(
    {
      scope: 'rag.reconciler',
      event: 'model-swap-recovery-resumed-drain',
      progressDone,
      progressTotal,
    },
    'rag.reconciler.resumed-drain',
  );
  return {
    recovered: 'resumed-drain',
    detail: `drain in progress ${progressDone}/${progressTotal}`,
  };
}
