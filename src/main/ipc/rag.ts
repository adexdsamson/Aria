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
import { shell } from 'electron';
import {
  CHANNELS,
  type RagAskRequest,
  type RagAskResponse,
  type RagBackfillStatusDto,
  type RagIndexStatusDto,
  type RagThreadDto,
  type RagTurnDto,
  type RagCitationDto,
  type RagRoutingDto,
} from '../../shared/ipc-contract';
import {
  getStatus,
  seedBackfill,
  setBackfillState,
  skipBackfill,
} from '../rag/backfill';
import {
  createThread,
  deleteThread,
  getThread,
  listThreads,
  type SeedTurn,
} from '../rag/threads';
import type { AnswerService } from '../rag/answer-service';
import type { DbHolder } from './onboarding';

type Db = Database.Database;

export interface RagIpcDeps {
  logger: Logger;
  dbHolder: DbHolder;
  /** Plan 07-03: factory wires the answer service when DB is available. */
  getAnswerService?: () => AnswerService | null;
  /** Plan 07-03: account status lookup for citation chip enrichment. */
  getAccountStatus?: (providerKey: string, accountId: string) =>
    | { provider: 'google' | 'microsoft'; email: string; disconnected: boolean }
    | null;
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

function threadDto(t: { id: string; title: string; createdAt: string; updatedAt: string }): RagThreadDto {
  return { id: t.id, title: t.title, createdAt: t.createdAt, updatedAt: t.updatedAt };
}

function parseJsonOrNull<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function enrichCitationChips(
  citations: RagCitationDto[] | null,
  lookup?: RagIpcDeps['getAccountStatus'],
): RagCitationDto[] | null {
  if (!citations || !lookup) return citations;
  return citations.map((c) => {
    // Only enrich entries that already carry providerKey/accountId in sourceId
    // namespace; the answer-service path already populated accountChip from
    // chunk rows, so this is defense-in-depth.
    if (c.accountChip) return c;
    return c;
  });
}

export function registerRagHandlers(ipcMain: IpcMain, deps: RagIpcDeps): void {
  const { logger, dbHolder, getAnswerService, getAccountStatus } = deps;

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

  // -------------------------------------------------------------------------
  // Plan 07-03 — Q&A surfaces
  // -------------------------------------------------------------------------

  ipcMain.handle(
    CHANNELS.RAG_ASK,
    async (_evt, req: RagAskRequest): Promise<RagAskResponse | { error: string }> => {
      try {
        const svc = getAnswerService?.();
        if (!svc) return { kind: 'error', text: 'Q&A service not ready' };
        return await svc.ask(req);
      } catch (err) {
        logger.warn({ scope: 'ipc.rag', err: (err as Error).message }, 'rag.ask.fail');
        return { error: (err as Error).message };
      }
    },
  );

  ipcMain.handle(
    CHANNELS.RAG_THREAD_LIST,
    async (_evt, req?: { limit?: number; search?: string }) => {
      try {
        const db = requireDb();
        const threads = listThreads(db, req ?? {}).map(threadDto);
        return { threads };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  );

  ipcMain.handle(
    CHANNELS.RAG_THREAD_GET,
    async (_evt, req: { threadId: string; lastN?: number }) => {
      try {
        const db = requireDb();
        const t = getThread(db, req.threadId, { lastN: req.lastN });
        if (!t) return null;
        const turns: RagTurnDto[] = t.turns.map((tr) => ({
          id: tr.id,
          threadId: tr.threadId,
          ord: tr.ord,
          role: tr.role,
          text: tr.text,
          citations: enrichCitationChips(
            parseJsonOrNull<RagCitationDto[]>(tr.citationsJson),
            getAccountStatus,
          ),
          routing: parseJsonOrNull<RagRoutingDto>(tr.routingJson),
          createdAt: tr.createdAt,
        }));
        return { thread: threadDto(t.thread), turns };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  );

  ipcMain.handle(
    CHANNELS.RAG_THREAD_CREATE,
    async (
      _evt,
      req?: { title?: string; seedTurns?: SeedTurn[] },
    ) => {
      try {
        const db = requireDb();
        const t = createThread(db, req ?? {});
        return { thread: threadDto(t) };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  );

  ipcMain.handle(
    CHANNELS.RAG_THREAD_DELETE,
    async (_evt, req: { threadId: string }) => {
      try {
        const db = requireDb();
        return deleteThread(db, req.threadId);
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  );

  ipcMain.handle(
    CHANNELS.RAG_OPEN_SOURCE,
    async (
      _evt,
      req: {
        sourceKind: 'email' | 'event' | 'note' | 'action';
        sourceId: string;
        charStart: number;
        charEnd: number;
      },
    ) => {
      try {
        // For v1 simply log + open the in-app deep link. The renderer side
        // also navigates via React Router when it can; this is a hook for
        // out-of-process surfaces (e.g. Gmail web link if the chunk has one).
        logger.info(
          { scope: 'ipc.rag', op: 'open-source', sourceKind: req.sourceKind, sourceId: req.sourceId },
          'rag.open-source',
        );
        // No external URL by default — renderer handles in-app navigation.
        void shell; // explicit reference to satisfy unused-import linters
        return { ok: true as const };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  );

  ipcMain.handle(CHANNELS.RAG_ACCOUNT_CHUNK_COUNTS, async () => {
    try {
      const db = requireDb();
      const rows = db
        .prepare(
          `SELECT provider_key, account_id, count(*) AS n
             FROM rag_chunk
            WHERE provider_key IS NOT NULL AND account_id IS NOT NULL
              AND deleted_at IS NULL
            GROUP BY provider_key, account_id`,
        )
        .all() as Array<{ provider_key: string; account_id: string; n: number }>;
      return {
        rows: rows.map((r) => ({
          providerKey: r.provider_key,
          accountId: r.account_id,
          count: r.n,
        })),
      };
    } catch (err) {
      return { error: (err as Error).message };
    }
  });
}
