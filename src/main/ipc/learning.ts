/**
 * Plan 08-03 Task 5 — Learning IPC handlers.
 *
 * Channels:
 *   LEARN_GET_PREFS         — current preferences + signals count + last updated
 *   LEARN_RESET_FIELD       — per-field reset (path whitelisted via prefs.ts)
 *   LEARN_RESET_ALL         — reset all preferences
 *   LEARN_LIST_SIGNALS      — paginated signal log read (renderer Settings sub-page)
 *   BRIEFING_FEEDBACK       — thumbs-up/down on a briefing section
 *   BRIEFING_INSIGHT_DISMISS — dismiss an insight from the briefing
 *   RAG_TURN_FEEDBACK       — thumbs-up/down on a rag_turn
 *
 * Also: on first registration, drains any 08-01 app_meta dismiss-log bridge
 * rows (W-4 backfill) so subsequent dismisses bypass the bridge entirely.
 */
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import { CHANNELS } from '../../shared/ipc-contract';
import type { DbHolder } from './onboarding';
import {
  readPreferences,
  resetField,
  resetAll,
} from '../learning/prefs';
import { listSignals } from '../learning/signal-log';
import {
  recordBriefingFeedback,
  recordBriefingDismiss,
  drainAppMetaDismissBacklog,
  type Thumb,
} from '../learning/sources/briefing';
import { appendTurnFeedback } from '../learning/sources/qa';

export interface LearningHandlerDeps {
  logger: Logger;
  dbHolder: DbHolder;
}

function notReady(): { error: string } {
  return { error: 'DB_NOT_OPEN' };
}

function isThumb(v: unknown): v is Thumb {
  return v === -1 || v === 0 || v === 1;
}

export function registerLearningHandlers(ipcMain: IpcMain, deps: LearningHandlerDeps): void {
  const { logger, dbHolder } = deps;

  // W-4 backfill — drain any 08-01 app_meta dismiss-log rows on first handler
  // registration. Idempotent; subsequent boots find zero rows and no-op.
  try {
    const db = dbHolder.db;
    if (db) {
      const drained = drainAppMetaDismissBacklog(db);
      if (drained > 0) {
        logger.info({ scope: 'learning', event: 'dismiss-backlog-drained', drained }, 'drained app_meta dismiss-log');
      }
    }
  } catch (err) {
    logger.warn({ scope: 'learning', err: (err as Error).message }, 'drain failed (non-fatal)');
  }

  ipcMain.handle(CHANNELS.LEARN_GET_PREFS, async () => {
    const db = dbHolder.db;
    if (!db) return notReady();
    try {
      const r = readPreferences(db);
      const count = db.prepare(`SELECT COUNT(*) AS c FROM learning_signals`).get() as { c: number };
      return {
        preferences: r.preferences,
        signalsCount: count.c,
        lastUpdatedAt: r.updatedAt,
      };
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle(CHANNELS.LEARN_RESET_FIELD, async (_e, req: unknown) => {
    const db = dbHolder.db;
    if (!db) return notReady();
    const r = (req ?? {}) as { fieldPath?: string };
    if (!r.fieldPath || typeof r.fieldPath !== 'string') return { error: 'FIELD_PATH_REQUIRED' };
    try {
      resetField(db, r.fieldPath);
      return { ok: true } as const;
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle(CHANNELS.LEARN_RESET_ALL, async () => {
    const db = dbHolder.db;
    if (!db) return notReady();
    try {
      resetAll(db);
      return { ok: true } as const;
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle(CHANNELS.LEARN_LIST_SIGNALS, async (_e, req: unknown) => {
    const db = dbHolder.db;
    if (!db) return notReady();
    const r = (req ?? {}) as {
      limit?: number;
      offset?: number;
      source?: 'approval' | 'briefing' | 'recap' | 'qa';
    };
    try {
      const rows = listSignals(db, { limit: r.limit, offset: r.offset, source: r.source });
      return { rows };
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle(CHANNELS.BRIEFING_FEEDBACK, async (_e, req: unknown) => {
    const db = dbHolder.db;
    if (!db) return notReady();
    const r = (req ?? {}) as { briefingDate?: string; sectionKey?: string; thumb?: number };
    if (!r.briefingDate || !r.sectionKey || !isThumb(r.thumb)) return { error: 'BAD_ARGS' };
    try {
      recordBriefingFeedback(db, {
        briefingDate: r.briefingDate,
        sectionKey: r.sectionKey,
        thumb: r.thumb,
      });
      return { ok: true } as const;
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle(CHANNELS.BRIEFING_INSIGHT_DISMISS, async (_e, req: unknown) => {
    const db = dbHolder.db;
    if (!db) return notReady();
    const r = (req ?? {}) as { briefingDate?: string; kind?: string };
    if (!r.briefingDate || !r.kind) return { error: 'BAD_ARGS' };
    try {
      recordBriefingDismiss(db, { briefingDate: r.briefingDate, kind: r.kind });
      return { ok: true } as const;
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle(CHANNELS.RAG_TURN_FEEDBACK, async (_e, req: unknown) => {
    const db = dbHolder.db;
    if (!db) return notReady();
    const r = (req ?? {}) as { turnId?: string; thumb?: number };
    if (!r.turnId || !isThumb(r.thumb)) return { error: 'BAD_ARGS' };
    try {
      const res = appendTurnFeedback(db, { turnId: r.turnId, thumb: r.thumb });
      if (!res.ok) return { ok: false as const, error: 'turn-not-found' };
      return { ok: true as const };
    } catch (err) {
      return { error: (err as Error).message };
    }
  });
}
