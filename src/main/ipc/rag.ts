/**
 * Plan 07-02 RAG IPC handlers.
 *
 * Surfaces:
 *   - RAG_INDEX_STATUS: backend, active model, dirty/alive counts, rebuild state
 *   - RAG_BACKFILL_STATUS: backfill state + live ETA
 *   - RAG_BACKFILL_START: opt-in start; seeds rag_source_dirty from canonical tables
 *   - RAG_BACKFILL_SKIP: mark skipped (revisitable from Settings)
 *   - RAG_WIPE_ACCOUNT: delete chunks for a disconnected account (RESEARCH §11)
 */
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import type Database from 'better-sqlite3-multiple-ciphers';
import {
  CHANNELS,
  type RagBackfillStatusDto,
  type RagIndexStatusDto,
} from '../../shared/ipc-contract';
import {
  getStatus,
  seedBackfill,
  setBackfillState,
  skipBackfill,
} from '../rag/backfill';
import type { DbHolder } from './onboarding';

type Db = Database.Database;

export interface RagIpcDeps {
  logger: Logger;
  dbHolder: DbHolder;
}

function readIndexStatus(db: Db): RagIndexStatusDto {
  const state = db
    .prepare(
      `SELECT vector_backend, active_model_id, active_model_dim, rebuild_in_progress,
              rebuild_target_model_id, rebuild_progress_done, rebuild_progress_total
         FROM rag_index_state WHERE id = 1`,
    )
    .get() as {
    vector_backend: 'sqlite-vec' | 'fallback';
    active_model_id: string;
    active_model_dim: number;
    rebuild_in_progress: number;
    rebuild_target_model_id: string | null;
    rebuild_progress_done: number;
    rebuild_progress_total: number;
  };
  const alive = (db
    .prepare(`SELECT count(*) AS n FROM rag_chunk WHERE deleted_at IS NULL`)
    .get() as { n: number }).n;
  const dirty = (db
    .prepare(`SELECT count(*) AS n FROM rag_chunk WHERE dirty = 1`)
    .get() as { n: number }).n;
  return {
    vectorBackend: state.vector_backend,
    activeModelId: state.active_model_id,
    activeModelDim: state.active_model_dim,
    rebuildInProgress: state.rebuild_in_progress === 1,
    rebuildTargetModelId: state.rebuild_target_model_id,
    rebuildProgressDone: state.rebuild_progress_done,
    rebuildProgressTotal: state.rebuild_progress_total,
    aliveChunkCount: alive,
    dirtyChunkCount: dirty,
    perMinute: 0,
  };
}

export function registerRagHandlers(ipcMain: IpcMain, deps: RagIpcDeps): void {
  const { logger, dbHolder } = deps;

  function requireDb(): Db {
    if (!dbHolder.db) throw new Error('rag: db not open');
    return dbHolder.db;
  }

  ipcMain.handle(CHANNELS.RAG_INDEX_STATUS, async () => {
    try {
      return readIndexStatus(requireDb());
    } catch (err) {
      logger.warn({ scope: 'ipc.rag', err: (err as Error).message }, 'rag.indexStatus.fail');
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle(CHANNELS.RAG_BACKFILL_STATUS, async (): Promise<RagBackfillStatusDto | { error: string }> => {
    try {
      return getStatus(requireDb());
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle(CHANNELS.RAG_BACKFILL_START, async () => {
    try {
      const db = requireDb();
      setBackfillState(db, 'in_progress');
      const res = seedBackfill(db);
      const total = Object.values(res.enqueuedBySourceKind).reduce((s, n) => s + n, 0);
      if (total === 0) setBackfillState(db, 'done');
      logger.info({ scope: 'ipc.rag', op: 'backfill-start', enqueued: total }, 'rag.backfill.start');
      return res;
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle(CHANNELS.RAG_BACKFILL_SKIP, async () => {
    try {
      skipBackfill(requireDb());
      return { ok: true };
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle(
    CHANNELS.RAG_WIPE_ACCOUNT,
    async (_evt, payload: { providerKey: string; accountId: string }) => {
      try {
        const db = requireDb();
        const res = db
          .prepare(
            `DELETE FROM rag_chunk WHERE provider_key = ? AND account_id = ?`,
          )
          .run(payload.providerKey, payload.accountId);
        return { deletedChunks: res.changes };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  );
}
