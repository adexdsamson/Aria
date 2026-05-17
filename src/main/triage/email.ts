/**
 * Plan 03-03 — Email triage (EMAIL-03).
 *
 * `triageMessage(deps)` runs once per newly-ingested gmail_message:
 *   1. Reads existing email_triage row by message_id — if present, returns it
 *      (store-once immutable per CONTEXT decision; no re-classification on
 *      classifier-version upgrade, deferred per CONTEXT §deferred).
 *   2. Dispatches an LLM call through the injected `dispatchFn` (production
 *      wiring uses `dispatchHybrid` + `generateObject` with `TriageSchema`;
 *      tests inject a mock). All dispatch goes through `scheduler.queue`
 *      (p-queue concurrency 1; CONTEXT cross-cutting).
 *   3. Persists exactly one row to `email_triage` with `classifier_version`
 *      stamped. On full failure, persists a fallback row so we never
 *      re-attempt next sync (priority='fyi', signals=['automated'],
 *      summary='triage unavailable').
 *
 * Never throws. The router (Plan 02) is reused — HR/legal/financial≥med stays
 * LOCAL through the same forced-local rules.
 *
 * VIP heuristic: deferred in v1. The `gmail_message` schema (migration 002)
 * has no `direction` column, so the "top-20-replied senders" approximation
 * has nothing to compute against. Phase 6 contacts directory replaces this.
 * Signals are emitted by the LLM only in v1.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type PQueueImport from 'p-queue';
import { z } from 'zod';

type Db = Database.Database;
type PQueueLike = InstanceType<typeof PQueueImport>;

export const TriageSchema = z.object({
  priority: z.enum(['urgent', 'needs-you', 'fyi', 'archive']),
  signals: z
    .array(
      z.enum([
        'from-vip',
        'thread-active',
        'deadline-mentioned',
        'money-amount',
        'awaiting-reply',
        'mention',
        'question-asked',
        'newsletter',
        'automated',
        'reply-needed',
        'attachment',
        'direct-to-me',
      ]),
    )
    .min(0),
  summary: z.string().max(280),
});

export type TriageResult = z.infer<typeof TriageSchema>;

export const TRIAGE_CLASSIFIER_VERSION = 'triage-v1-llama3.1-8b-q4-2026-05';

export interface GmailMessageRow {
  id: string;
  thread_id: string;
  from_addr: string;
  subject: string;
  snippet: string;
  received_at: string;
  is_unread: 0 | 1;
}

/**
 * Production wiring: caller supplies a function that runs the actual LLM
 * dispatch (router → generateObject) and returns a TriageResult-shaped
 * object. Tests mock this seam.
 */
export type TriageDispatchFn = (input: {
  prompt: string;
  message: GmailMessageRow;
}) => Promise<TriageResult>;

export interface TriageMessageDeps {
  db: Db;
  message: GmailMessageRow;
  queue: PQueueLike;
  dispatchFn: TriageDispatchFn;
  now?: () => Date;
}

const FALLBACK_RESULT: TriageResult = {
  priority: 'fyi',
  signals: ['automated'],
  summary: 'triage unavailable',
};

function buildTriagePrompt(m: GmailMessageRow): string {
  return [
    'Classify this email for an executive assistant queue.',
    'Output JSON with: priority (urgent|needs-you|fyi|archive), signals (array), summary (≤280 chars).',
    '',
    `From: ${m.from_addr}`,
    `Subject: ${m.subject}`,
    `Received: ${m.received_at}`,
    `Thread: ${m.thread_id}`,
    `Unread: ${m.is_unread ? 'yes' : 'no'}`,
    `Snippet: ${m.snippet}`,
  ].join('\n');
}

function getExisting(db: Db, messageId: string): TriageResult | null {
  const row = db
    .prepare(
      'SELECT priority, signals_json, summary FROM email_triage WHERE message_id = ?',
    )
    .get(messageId) as
    | { priority: string; signals_json: string; summary: string }
    | undefined;
  if (!row) return null;
  let signals: TriageResult['signals'];
  try {
    const parsed = JSON.parse(row.signals_json) as unknown;
    signals = Array.isArray(parsed)
      ? (parsed as TriageResult['signals'])
      : [];
  } catch {
    signals = [];
  }
  return {
    priority: row.priority as TriageResult['priority'],
    signals,
    summary: row.summary,
  };
}

function persist(
  db: Db,
  messageId: string,
  result: TriageResult,
  nowIso: string,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO email_triage
     (message_id, classifier_version, priority, signals_json, summary, ts)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    messageId,
    TRIAGE_CLASSIFIER_VERSION,
    result.priority,
    JSON.stringify(result.signals),
    result.summary,
    nowIso,
  );
}

/**
 * Triage one message. Store-once immutable. Never throws.
 *
 * Dispatch is wrapped in `queue.add` so concurrency is bounded to 1
 * (scheduler-wide). Returns the persisted result on success or fallback.
 */
export async function triageMessage(
  deps: TriageMessageDeps,
): Promise<TriageResult> {
  const { db, message, queue, dispatchFn } = deps;
  const now = (deps.now ?? (() => new Date()))();

  // Idempotency: if a row already exists, return it without re-dispatching.
  const existing = getExisting(db, message.id);
  if (existing) return existing;

  const prompt = buildTriagePrompt(message);

  let result: TriageResult;
  try {
    const dispatched = await queue.add(() => dispatchFn({ prompt, message }));
    // p-queue's add() may return void on overflow; treat undefined as failure.
    if (!dispatched) {
      result = FALLBACK_RESULT;
    } else {
      const parsed = TriageSchema.safeParse(dispatched);
      result = parsed.success ? parsed.data : FALLBACK_RESULT;
    }
  } catch {
    result = FALLBACK_RESULT;
  }

  // Persist exactly one row (UNIQUE on message_id via PRIMARY KEY). If a
  // concurrent insert raced us, INSERT OR IGNORE leaves the prior row intact.
  try {
    persist(db, message.id, result, now.toISOString());
  } catch {
    /* persistence failure must not throw — fallback already covers the
     * caller; a future sync will re-attempt (race; rare). */
  }
  // Re-read to return whatever is actually persisted (handles INSERT OR
  // IGNORE collision case).
  return getExisting(db, message.id) ?? result;
}
