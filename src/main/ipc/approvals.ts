/**
 * Plan 03-01 Task 2 — Approval queue IPC handlers.
 *
 * Every state mutation goes through `persist.transitionTo`, which invokes
 * `assertTransition` inside a SQLite transaction. The IPC layer NEVER issues
 * raw UPDATEs — that's the chokepoint guarantee.
 */
import type { IpcMain } from 'electron';
import { randomUUID } from 'node:crypto';
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
  insertApproval,
} from '../approvals/persist';
import { applyCalendarChange, type ApplyCalendarChangeDeps } from '../integrations/write-event';

export interface ApprovalsDeps {
  logger: Logger;
  dbHolder: DbHolder;
  /** Override calendar-write deps for tests / E2E. */
  applyCalendarChangeDeps?: ApplyCalendarChangeDeps;
}

const DEFAULT_LIST_STATES: ApprovalUiState[] = [
  'pending',
  'generating',
  'ready',
  'approved',
  'sending',
  'failed',
  'needs-operator-decision',
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
const ARIA_E2E_SEED_READY = 'aria:approvals:__e2e_seed_ready__';
const ARIA_E2E_READ_ROW = 'aria:approvals:__e2e_read_row__';
const ARIA_E2E_READ_SEND_LOG = 'aria:approvals:__e2e_read_send_log__';

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
      const id = randomUUID();
      const now = new Date().toISOString();
      const idempotencyKey = randomUUID().replace(/-/g, '').toLowerCase();
      db.prepare(
        `INSERT INTO approval (id, kind, state, created_at, updated_at, approval_path, subject, idempotency_key, last_error_message)
         VALUES (?, 'email_send', 'generating', ?, ?, 'explicit', ?, ?, NULL)`,
      ).run(id, now, now, r.subject ?? 'E2E pending draft', idempotencyKey);
      return { id };
    });

    // Plan 03-04 Task 5 — seed an approval row in 'ready' state with
    // classifier columns populated, then run the approve+send e2e flow.
    // Optional overrides expose severity / approval_path / state shortcuts
    // for the bypass-attempt and forced-explicit sub-tests.
    ipcMain.handle(ARIA_E2E_SEED_READY, async (_e, req: unknown) => {
      const db = dbHolder.db;
      if (!db) return notReady();
      const r = (req ?? {}) as {
        recipients?: string[];
        subject?: string;
        body?: string;
        sourceMessageId?: string;
        severity?: 'low' | 'med' | 'high';
        categories?: string[];
        finalState?: 'ready' | 'approved';
        approvalPath?: 'explicit' | 'silent';
      };
      try {
        const id = insertApproval(db, {
          kind: 'email_send',
          source_message_id: r.sourceMessageId ?? 'incoming-msg-e2e',
          recipients_json: JSON.stringify(r.recipients ?? ['alice@example.com']),
          subject: r.subject ?? 'Re: Project sync',
          severity: r.severity ?? 'low',
          categories_json: JSON.stringify(r.categories ?? ['none']),
          classifier_version: 'e2e-v1',
          classifier_rationale: 'seeded by e2e harness',
          confidence: 0.9,
          routed: 'local',
          approval_path: r.approvalPath ?? 'explicit',
        });
        transitionTo(db, id, 'generating');
        transitionTo(db, id, 'ready', {
          body_original: r.body ?? 'Tuesday works for me.',
        });
        if (r.finalState === 'approved') {
          transitionTo(db, id, 'approved', {
            approval_path: r.approvalPath ?? 'explicit',
          });
        }
        return { id };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    ipcMain.handle(ARIA_E2E_READ_ROW, async (_e, req: unknown) => {
      const db = dbHolder.db;
      if (!db) return notReady();
      const r = (req ?? {}) as { id?: string };
      if (!r.id) return { error: 'ID_REQUIRED' };
      const row = getApproval(db, r.id);
      return { row };
    });

    ipcMain.handle(ARIA_E2E_READ_SEND_LOG, async (_e, req: unknown) => {
      const db = dbHolder.db;
      if (!db) return notReady();
      const r = (req ?? {}) as { approvalId?: string };
      if (!r.approvalId) return { error: 'APPROVAL_ID_REQUIRED' };
      const rows = db
        .prepare(
          `SELECT * FROM send_log WHERE approval_id = ? ORDER BY ts DESC`,
        )
        .all(r.approvalId);
      return { rows };
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
    const r = req as {
      id?: string;
      edited?: { body?: string; subject?: string };
      calendarOverrides?: {
        scope?: 'this' | 'future' | 'all';
        overrideReasons?: string[];
        afterJson?: string;
      };
    };
    if (!r?.id) return { error: 'ID_REQUIRED' };
    try {
      const patch: Record<string, unknown> = { approval_path: 'explicit' };
      if (r.edited?.body !== undefined) patch.body_edited = r.edited.body;
      if (r.edited?.subject !== undefined) patch.subject = r.edited.subject;
      if (r.calendarOverrides?.scope) {
        patch.recurring_scope = r.calendarOverrides.scope;
      }
      if (r.calendarOverrides?.afterJson) {
        patch.after_json = r.calendarOverrides.afterJson;
      }
      if (r.calendarOverrides?.overrideReasons && r.calendarOverrides.overrideReasons.length) {
        patch.rule_overrides_json = JSON.stringify(
          r.calendarOverrides.overrideReasons.map((reason) => ({
            reason,
            ts: new Date().toISOString(),
          })),
        );
      }
      transitionTo(db, r.id, 'approved', patch);
      logger.info({ event: 'approvals.approve', id: r.id, edited: Boolean(r.edited) });

      // Plan 04-03 — dispatch to applyCalendarChange chokepoint when this is
      // a calendar_change row. Mirrors the email_send → sendApprovedEmail
      // dispatch in ApprovalsScreen.runApprove but main-side so the renderer
      // doesn't need a second IPC roundtrip.
      const row = getApproval(db, r.id);
      if (row && row.kind === 'calendar_change') {
        try {
          const applyDeps = deps.applyCalendarChangeDeps ?? {};
          // E2E harness: reuse the in-memory CalendarClient mock from
          // src/main/ipc/scheduling.ts so a single mock surface drives both
          // freebusyQuery (propose) and patchEvent/insertEvent (apply).
          if (process.env.ARIA_E2E === '1' && !applyDeps.buildCalendarClient) {
            const sched = await import('./scheduling');
            // buildE2eCalendarClient is not exported; we rely on the same
            // module-level state via a small public accessor.
            applyDeps.buildCalendarClient = sched.buildE2eCalendarClientForApproveDispatch;
          }
          await applyCalendarChange(db, r.id, applyDeps);
        } catch (err) {
          logger.warn({
            event: 'approvals.calendar-apply.failed',
            id: r.id,
            error: err instanceof Error ? err.message : String(err),
          });
          return {
            error: `calendar-apply:${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }
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

  ipcMain.handle(CHANNELS.APPROVALS_CANCEL_STUCK, async (_e, req: unknown) => {
    const db = dbHolder.db;
    if (!db) return notReady();
    const r = req as { id?: string };
    if (!r?.id) return { error: 'ID_REQUIRED' };
    try {
      transitionTo(db, r.id, 'needs-operator-decision', {
        last_error_message: 'User cancelled stuck send',
      });
      logger.info({ event: 'approvals.cancel-stuck', id: r.id });
      return { ok: true as const };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
