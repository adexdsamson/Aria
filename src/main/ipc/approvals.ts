/**
 * Plan 03-01 Task 2 — Approval queue IPC handlers.
 *
 * Every state mutation goes through `persist.transitionTo`, which invokes
 * `assertTransition` inside a SQLite transaction. The IPC layer NEVER issues
 * raw UPDATEs — that's the chokepoint guarantee.
 */
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import {
  CHANNELS,
  type ApprovalRowDto,
  type ApprovalUiState,
} from '../../shared/ipc-contract';
import type { DbHolder } from './onboarding';
import {
  listApprovals,
  transitionTo,
  getApproval,
} from '../approvals/persist';

export interface ApprovalsDeps {
  logger: Logger;
  dbHolder: DbHolder;
}

const DEFAULT_LIST_STATES: ApprovalUiState[] = [
  'pending',
  'generating',
  'ready',
  'interrupted',
  'snoozed',
];

function notReady(): { error: string } {
  return { error: 'DB_NOT_OPEN' };
}

function asDto(row: unknown): ApprovalRowDto {
  // persist.ApprovalRow shape is identical to ApprovalRowDto by design; we
  // assert here to keep the shared module decoupled from main internals.
  return row as ApprovalRowDto;
}

const ARIA_E2E_INSERT_GENERATING = 'aria:approvals:__e2e_insert_generating__';

export function registerApprovalsHandlers(
  ipcMain: IpcMain,
  deps: ApprovalsDeps,
): void {
  const { logger, dbHolder } = deps;

  // E2E hook — gated by env var so production cannot insert approvals.
  if (process.env.ARIA_E2E === '1') {
    ipcMain.handle(ARIA_E2E_INSERT_GENERATING, async (_e, req: unknown) => {
      const db = dbHolder.db;
      if (!db) return notReady();
      const r = (req ?? {}) as { subject?: string };
      // Insert directly with state='generating' (bypassing transitionTo,
      // which would reject pending->generating without setup). Used by the
      // crash-recovery e2e ONLY.
      const id = (await import('node:crypto')).randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO approval (id, kind, state, created_at, updated_at, approval_path, subject)
         VALUES (?, 'email_send', 'generating', ?, ?, 'explicit', ?)`,
      ).run(id, now, now, r.subject ?? 'E2E pending draft');
      return { id };
    });
  }

  ipcMain.handle(CHANNELS.APPROVALS_LIST, async (_e, req: unknown) => {
    const db = dbHolder.db;
    if (!db) return notReady();
    const r = (req ?? {}) as { states?: ApprovalUiState[]; limit?: number };
    const states = r.states && r.states.length > 0 ? r.states : DEFAULT_LIST_STATES;
    const rows = listApprovals(db, { states, limit: r.limit });
    return { rows: rows.map(asDto) };
  });

  ipcMain.handle(CHANNELS.APPROVALS_APPROVE, async (_e, req: unknown) => {
    const db = dbHolder.db;
    if (!db) return notReady();
    const r = req as { id?: string; edited?: { body?: string; subject?: string } };
    if (!r?.id) return { error: 'ID_REQUIRED' };
    try {
      const patch: Record<string, unknown> = { approval_path: 'explicit' };
      if (r.edited?.body !== undefined) patch.body_edited = r.edited.body;
      if (r.edited?.subject !== undefined) patch.subject = r.edited.subject;
      transitionTo(db, r.id, 'approved', patch);
      logger.info({ event: 'approvals.approve', id: r.id, edited: Boolean(r.edited) });
      return { ok: true };
    } catch (err) {
      logger.warn({
        event: 'approvals.approve.failed',
        id: r.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(CHANNELS.APPROVALS_REJECT, async (_e, req: unknown) => {
    const db = dbHolder.db;
    if (!db) return notReady();
    const r = req as { id?: string; reason?: string };
    if (!r?.id) return { error: 'ID_REQUIRED' };
    try {
      transitionTo(db, r.id, 'rejected', {
        rejection_reason: r.reason ?? null,
      });
      logger.info({ event: 'approvals.reject', id: r.id });
      return { ok: true };
    } catch (err) {
      logger.warn({
        event: 'approvals.reject.failed',
        id: r.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(CHANNELS.APPROVALS_SNOOZE, async (_e, req: unknown) => {
    const db = dbHolder.db;
    if (!db) return notReady();
    const r = req as { id?: string; until?: string };
    if (!r?.id || !r?.until) return { error: 'ID_AND_UNTIL_REQUIRED' };
    try {
      transitionTo(db, r.id, 'snoozed', { snooze_until: r.until });
      logger.info({ event: 'approvals.snooze', id: r.id, until: r.until });
      return { ok: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(CHANNELS.APPROVALS_BATCH_APPROVE, async (_e, req: unknown) => {
    const db = dbHolder.db;
    if (!db) return notReady();
    const r = req as { ids?: string[] };
    if (!Array.isArray(r?.ids) || r.ids.length === 0) {
      return { error: 'IDS_REQUIRED' };
    }
    try {
      // Single db.transaction wraps every transition; if any throws (state
      // not 'ready', missing row), the entire batch rolls back per
      // RESEARCH T-03-01-02 mitigation.
      const tx = db.transaction((ids: string[]) => {
        for (const id of ids) {
          // Read current state inside the txn so we use the latest value.
          const row = getApproval(db, id);
          if (!row) throw new Error(`approval-not-found:${id}`);
          if (row.state !== 'ready') {
            throw new Error(`invalid-batch-state:${id}:${row.state}`);
          }
          transitionTo(db, id, 'approved', { approval_path: 'explicit' });
        }
      });
      tx(r.ids);
      logger.info({ event: 'approvals.batch-approve', count: r.ids.length });
      return { ok: true, count: r.ids.length };
    } catch (err) {
      logger.warn({
        event: 'approvals.batch-approve.failed',
        error: err instanceof Error ? err.message : String(err),
      });
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
