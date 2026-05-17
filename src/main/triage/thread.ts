/**
 * Plan 03-03 — On-demand thread summarization (EMAIL-04).
 *
 * `summarizeThread(deps)` reads every gmail_message row belonging to a
 * thread, concatenates them, dispatches through the injected router/LLM
 * seam (production wiring reuses Plan 02's `dispatchHybrid` so HR/legal/
 * financial≥med threads stay LOCAL), and returns a structured
 * ThreadSummary. The result is NOT persisted — per-request only.
 *
 * Dispatch always flows through `scheduler.queue` (p-queue concurrency 1)
 * matching the cross-cutting CONTEXT decision. Caller is expected to wire
 * a per-request token table id of the form
 * `thread-summary-${threadId}-${randomUUID()}` and to call
 * `disposeDraftTable(id)` in finally; that wiring lives in `ipc/triage.ts`
 * (see plan §interfaces). The pure function here is router-agnostic to
 * keep the unit test surface clean.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type PQueueImport from 'p-queue';
import { z } from 'zod';

type Db = Database.Database;
type PQueueLike = InstanceType<typeof PQueueImport>;

export const ThreadSummarySchema = z.object({
  summary: z.string().max(800),
  decisions: z.array(z.string()).max(10),
  open_questions: z.array(z.string()).max(10),
  participants: z.array(z.string()).max(20),
});

export type ThreadSummary = z.infer<typeof ThreadSummarySchema>;

export interface ThreadMessageRow {
  id: string;
  from_addr: string;
  received_at: string;
  subject: string;
  snippet: string;
}

export type ThreadSummaryDispatchFn = (input: {
  prompt: string;
  threadId: string;
  messages: ThreadMessageRow[];
}) => Promise<ThreadSummary>;

export interface SummarizeThreadDeps {
  db: Db;
  threadId: string;
  queue: PQueueLike;
  dispatchFn: ThreadSummaryDispatchFn;
}

const FALLBACK_SUMMARY: ThreadSummary = {
  summary: 'thread summary unavailable',
  decisions: [],
  open_questions: [],
  participants: [],
};

function readMessages(db: Db, threadId: string): ThreadMessageRow[] {
  return db
    .prepare(
      `SELECT id, from_addr, received_at, subject, snippet
       FROM gmail_message
       WHERE thread_id = ?
       ORDER BY received_at ASC`,
    )
    .all(threadId) as ThreadMessageRow[];
}

function buildThreadPrompt(messages: ThreadMessageRow[]): string {
  const lines: string[] = [
    'Summarize this email thread for an executive.',
    'Output JSON with: summary (≤800 chars), decisions (≤10), open_questions (≤10), participants (≤20).',
    '',
  ];
  for (const m of messages) {
    lines.push(`[from] ${m.from_addr} (${m.received_at}): ${m.snippet}`);
    lines.push('---');
  }
  return lines.join('\n');
}

/**
 * Summarize one thread. Result is request-scoped (not persisted). Never
 * throws — returns FALLBACK_SUMMARY on dispatch failure.
 */
export async function summarizeThread(
  deps: SummarizeThreadDeps,
): Promise<ThreadSummary> {
  const { db, threadId, queue, dispatchFn } = deps;
  const messages = readMessages(db, threadId);
  if (messages.length === 0) {
    return {
      summary: 'thread has no messages',
      decisions: [],
      open_questions: [],
      participants: [],
    };
  }

  const prompt = buildThreadPrompt(messages);
  try {
    const dispatched = await queue.add(() =>
      dispatchFn({ prompt, threadId, messages }),
    );
    if (!dispatched) return FALLBACK_SUMMARY;
    const parsed = ThreadSummarySchema.safeParse(dispatched);
    return parsed.success ? parsed.data : FALLBACK_SUMMARY;
  } catch {
    return FALLBACK_SUMMARY;
  }
}
