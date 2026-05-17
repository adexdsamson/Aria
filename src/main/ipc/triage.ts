/**
 * Plan 03-03 Task 2 — Triage IPC handlers.
 *
 *   - `aria.triage.summarizeThread({ threadId })` — on-demand thread summary
 *     (EMAIL-04). Routes through Plan 02's `dispatchHybrid` so HR/legal/
 *     financial≥med threads stay LOCAL. Per-request approvalId of the form
 *     `thread-summary-${threadId}-${uuid}` so token tables don't leak
 *     across concurrent requests (T-03-03-03).
 *   - `aria.triage.getForMessage({ messageId })` — read-only fetch of a
 *     persisted email_triage row.
 */
import * as crypto from 'node:crypto';
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import { generateObject } from 'ai';
import { CHANNELS } from '../../shared/ipc-contract';
import type {
  ThreadSummaryDto,
  TriageResultDto,
  SummarizeThreadRequest,
  GetTriageForMessageRequest,
  TriageSignal,
  TriagePriority,
} from '../../shared/ipc-contract';
import type { DbHolder } from './onboarding';
import type { SchedulerHandle } from '../lifecycle/scheduler';
import {
  summarizeThread,
  ThreadSummarySchema,
  type ThreadSummary,
  type ThreadMessageRow,
} from '../triage/thread';
import { decideHybridRoute } from '../llm/router';
import { getLocalModel, getFrontierModel } from '../llm/providers';
import {
  tokenizeForFrontier,
  rehydrate,
  disposeDraftTable,
} from '../llm/tokenize';

export interface TriageIpcDeps {
  logger: Logger;
  dbHolder: DbHolder;
  scheduler: SchedulerHandle;
}

function notReady(): { error: string } {
  return { error: 'DB_NOT_OPEN' };
}

function buildPromptFromMessages(messages: ThreadMessageRow[]): string {
  const lines: string[] = [
    'Summarize this email thread for an executive.',
    'Output JSON with: summary (≤800 chars), decisions, open_questions, participants.',
    '',
  ];
  for (const m of messages) {
    lines.push(`[from] ${m.from_addr} (${m.received_at}): ${m.snippet}`);
    lines.push('---');
  }
  return lines.join('\n');
}

/**
 * Build the production dispatchFn: runs hybrid routing, tokenizes when
 * routed='hybrid' (PII path), forces LOCAL when HR/legal/financial≥med,
 * disposes token table in finally.
 */
function makeProductionDispatch(
  scheduler: SchedulerHandle,
): import('../triage/thread').ThreadSummaryDispatchFn {
  return async ({ prompt, threadId }) => {
    const approvalId = `thread-summary-${threadId}-${crypto.randomUUID()}`;
    const decision = await decideHybridRoute({
      approvalId,
      prompt,
      queue: scheduler.queue,
    });
    try {
      const runLocal = async (p: string): Promise<ThreadSummary> => {
        const model = getLocalModel();
        const result = await generateObject({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          model: model as any,
          schema: ThreadSummarySchema,
          prompt: p,
        });
        return result.object as ThreadSummary;
      };
      const runFrontier = async (p: string): Promise<ThreadSummary> => {
        const provider =
          decision.classifier.categories.includes('hr') ||
          decision.classifier.categories.includes('legal') ||
          decision.classifier.categories.includes('financial')
            ? null
            : 'anthropic';
        if (!provider) return runLocal(p);
        const model = await getFrontierModel(provider);
        const result = await generateObject({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          model: model as any,
          schema: ThreadSummarySchema,
          prompt: p,
        });
        return result.object as ThreadSummary;
      };

      if (decision.routed === 'local') {
        return await runLocal(prompt);
      }
      if (decision.routed === 'frontier') {
        try {
          return await runFrontier(prompt);
        } catch {
          return await runLocal(prompt);
        }
      }
      // routed === 'hybrid'
      const { prompt: tokenized } = tokenizeForFrontier(approvalId, prompt);
      try {
        const obj = await runFrontier(tokenized);
        // Rehydrate string fields. ThreadSummary's strings are user-facing.
        const rehydrated: ThreadSummary = {
          summary: rehydrate(approvalId, obj.summary),
          decisions: obj.decisions.map((d) => rehydrate(approvalId, d)),
          open_questions: obj.open_questions.map((q) =>
            rehydrate(approvalId, q),
          ),
          participants: obj.participants.map((p) => rehydrate(approvalId, p)),
        };
        return rehydrated;
      } catch {
        return await runLocal(prompt);
      }
    } finally {
      disposeDraftTable(approvalId);
    }
  };
}

interface TriageRow {
  message_id: string;
  classifier_version: string;
  priority: string;
  signals_json: string;
  summary: string;
}

function toTriageDto(row: TriageRow): TriageResultDto {
  let signals: TriageSignal[];
  try {
    const v = JSON.parse(row.signals_json) as unknown;
    signals = Array.isArray(v) ? (v as TriageSignal[]) : [];
  } catch {
    signals = [];
  }
  return {
    priority: row.priority as TriagePriority,
    signals,
    summary: row.summary,
    classifier_version: row.classifier_version,
  };
}

export function registerTriageHandlers(
  ipcMain: IpcMain,
  deps: TriageIpcDeps,
): void {
  const { logger, dbHolder, scheduler } = deps;
  const dispatchFn = makeProductionDispatch(scheduler);

  ipcMain.handle(CHANNELS.TRIAGE_SUMMARIZE_THREAD, async (_e, req: unknown) => {
    const db = dbHolder.db;
    if (!db) return notReady();
    const r = (req ?? {}) as SummarizeThreadRequest;
    if (typeof r.threadId !== 'string' || !r.threadId) {
      return { error: 'INVALID_REQUEST' };
    }
    const start = Date.now();
    try {
      const result: ThreadSummaryDto = await summarizeThread({
        db,
        threadId: r.threadId,
        queue: scheduler.queue,
        dispatchFn,
      });
      logger.info(
        {
          scope: 'triage.summarizeThread',
          threadId: r.threadId,
          latency_ms: Date.now() - start,
        },
        'thread summary generated',
      );
      return result;
    } catch (err) {
      logger.warn(
        {
          scope: 'triage.summarizeThread',
          err: (err as Error).message,
        },
        'summarizeThread failed',
      );
      return { error: 'SUMMARIZE_FAILED' };
    }
  });

  ipcMain.handle(CHANNELS.TRIAGE_GET_FOR_MESSAGE, async (_e, req: unknown) => {
    const db = dbHolder.db;
    if (!db) return notReady();
    const r = (req ?? {}) as GetTriageForMessageRequest;
    if (typeof r.messageId !== 'string' || !r.messageId) {
      return { error: 'INVALID_REQUEST' };
    }
    try {
      const row = db
        .prepare(
          `SELECT message_id, classifier_version, priority, signals_json, summary
           FROM email_triage WHERE message_id = ? LIMIT 1`,
        )
        .get(r.messageId) as TriageRow | undefined;
      return row ? toTriageDto(row) : null;
    } catch (err) {
      logger.warn(
        {
          scope: 'triage.getForMessage',
          err: (err as Error).message,
        },
        'getForMessage failed',
      );
      return null;
    }
  });
}
