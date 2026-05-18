/**
 * Plan 03-04 Task 3 — Drafting IPC handler.
 *
 * `aria.drafting.replyToMessage({ messageId })` loads the gmail_message row,
 * builds production runLocal / runFrontier dispatchers backed by the active
 * Ollama and frontier providers, calls `draftReply`, and returns the new
 * approvalId. The drafting agent itself enforces the crash-recovery
 * invariant (Pattern 2) — this handler is a thin glue layer.
 *
 * On error the IPC layer returns `{ error: 'DRAFT_FAILED' }`; the row stays
 * in 'generating' so `reapInterruptedOnStartup` (Plan 03-01) sweeps it on
 * next launch.
 */
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import { generateObject } from 'ai';
import { CHANNELS, type DraftReplyRequest, type DraftReplyResponse } from '../../shared/ipc-contract';
import type { DbHolder } from './onboarding';
import type { SchedulerHandle } from '../lifecycle/scheduler';
import {
  draftReply,
  DraftSchema,
  type Draft,
  type GmailMessageRow,
} from '../drafting/email';
import { getLocalModel, getFrontierModel } from '../llm/providers';
import { getActiveProvider } from '../secrets/safeStorage';

export interface DraftingIpcDeps {
  logger: Logger;
  dbHolder: DbHolder;
  scheduler: SchedulerHandle;
}

function notReady(): { error: string } {
  return { error: 'DB_NOT_OPEN' };
}

async function runLocalDraft(prompt: string): Promise<Draft> {
  const model = getLocalModel();
  const result = await generateObject({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model: model as any,
    schema: DraftSchema,
    prompt,
  });
  return result.object as Draft;
}

async function runFrontierDraft(prompt: string): Promise<Draft> {
  const active = await getActiveProvider();
  // Fall back to local if no frontier active — but dispatchHybrid only calls
  // runFrontier when the routing decision says frontier/hybrid, so the active
  // provider should be set. If not, surface a clear error.
  if (!active) {
    throw new Error('no-active-frontier-provider');
  }
  const model = await getFrontierModel(active);
  const result = await generateObject({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model: model as any,
    schema: DraftSchema,
    prompt,
  });
  return result.object as Draft;
}

export function registerDraftingHandlers(
  ipcMain: IpcMain,
  deps: DraftingIpcDeps,
): void {
  const { logger, dbHolder, scheduler } = deps;

  ipcMain.handle(CHANNELS.DRAFTING_REPLY_TO_MESSAGE, async (_e, req: unknown) => {
    const db = dbHolder.db;
    if (!db) return notReady();
    const r = (req ?? {}) as DraftReplyRequest;
    if (typeof r.messageId !== 'string' || !r.messageId) {
      return { error: 'INVALID_REQUEST' };
    }

    const row = db
      .prepare(
        `SELECT id, thread_id, from_addr, subject, snippet, received_at
         FROM gmail_message WHERE id = ?`,
      )
      .get(r.messageId) as GmailMessageRow | undefined;
    if (!row) return { error: 'MESSAGE_NOT_FOUND' };

    const start = Date.now();
    try {
      const { approvalId, routed } = await draftReply(db, row, {
        queue: scheduler.queue,
        runLocal: runLocalDraft,
        runFrontier: runFrontierDraft,
      });
      logger.info(
        {
          scope: 'drafting.replyToMessage',
          messageId: r.messageId,
          approvalId,
          routed,
          latency_ms: Date.now() - start,
        },
        'draft reply generated',
      );
      const resp: DraftReplyResponse = { approvalId };
      return resp;
    } catch (err) {
      logger.warn(
        {
          scope: 'drafting.replyToMessage',
          messageId: r.messageId,
          err: (err as Error).message,
        },
        'draftReply failed; row left in generating state for next-launch sweep',
      );
      return { error: 'DRAFT_FAILED' };
    }
  });
}
