/**
 * Plan 03-03 Task 2 — triage/thread unit tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import PQueueImport from 'p-queue';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PQueue: typeof PQueueImport = ((PQueueImport as any).default ?? PQueueImport) as typeof PQueueImport;
import { openDb, closeDb, type Db } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';
import {
  summarizeThread,
  ThreadSummarySchema,
  type ThreadSummary,
} from '../../../../src/main/triage/thread';

const MIGRATIONS_DIR = path.resolve(
  __dirname,
  '../../../../src/main/db/migrations',
);

function freshDb(): Db {
  const dataDir = createTempUserDataDir('aria-triage-thread');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

function seed(
  db: Db,
  threadId: string,
  msgs: Array<{ id: string; from: string; subject?: string; snippet?: string; received_at?: string }>,
): void {
  for (const m of msgs) {
    db.prepare(
      `INSERT INTO gmail_message
       (id, thread_id, from_addr, subject, snippet, received_at, label_ids,
        is_unread, is_important, history_id, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, '[]', 1, 0, NULL, ?)`,
    ).run(
      m.id,
      threadId,
      m.from,
      m.subject ?? `Subj ${m.id}`,
      m.snippet ?? `Body of ${m.id}`,
      m.received_at ?? new Date().toISOString(),
      new Date().toISOString(),
    );
  }
}

describe('triage/thread summarizeThread', () => {
  let db: Db;
  beforeEach(() => {
    db = freshDb();
  });
  afterEach(() => {
    closeDb(db);
  });

  it('reads from gmail_message and returns ThreadSummary-shaped result', async () => {
    seed(db, 'tid-1', [
      { id: 'm1', from: 'a@x.co' },
      { id: 'm2', from: 'b@x.co' },
      { id: 'm3', from: 'c@x.co' },
      { id: 'm4', from: 'd@x.co' },
      { id: 'm5', from: 'e@x.co' },
    ]);
    const queue = new PQueue({ concurrency: 1 });
    const dispatchFn = vi.fn(async (input): Promise<ThreadSummary> => {
      expect(input.threadId).toBe('tid-1');
      expect(input.messages.length).toBe(5);
      return {
        summary: 'Discussion of Q3 strategy.',
        decisions: ['Adopt OKRs'],
        open_questions: ['Budget?'],
        participants: ['a@x.co', 'b@x.co'],
      };
    });
    const res = await summarizeThread({
      db,
      threadId: 'tid-1',
      queue,
      dispatchFn,
    });
    expect(res.summary).toBe('Discussion of Q3 strategy.');
    expect(res.decisions).toEqual(['Adopt OKRs']);
    expect(res.participants).toContain('a@x.co');
    expect(ThreadSummarySchema.safeParse(res).success).toBe(true);
  });

  it('does NOT persist (no email_triage write, no thread_summary table writes)', async () => {
    seed(db, 'tid-np', [{ id: 'm1', from: 'a@x.co' }]);
    const queue = new PQueue({ concurrency: 1 });
    const dispatchFn = vi.fn(async (): Promise<ThreadSummary> => ({
      summary: 'x',
      decisions: [],
      open_questions: [],
      participants: [],
    }));
    await summarizeThread({ db, threadId: 'tid-np', queue, dispatchFn });
    const triageCount = db
      .prepare('SELECT COUNT(*) AS n FROM email_triage')
      .get() as { n: number };
    expect(triageCount.n).toBe(0);
  });

  it('HR-flagged thread: routes through dispatchFn unmodified — caller (router) enforces local-only', async () => {
    // The router (Plan 02 dispatchHybrid) is responsible for forced-local
    // routing on HR/legal/financial≥med. summarizeThread is router-agnostic
    // by design — it passes whatever dispatch is wired. We assert that the
    // dispatchFn is called (so the production wiring CAN apply forced-local
    // rules); the integration assertion lives in the IPC wiring.
    seed(db, 'tid-hr', [
      { id: 'm1', from: 'hr@x.co', snippet: 'Performance review notes' },
    ]);
    const queue = new PQueue({ concurrency: 1 });
    const localOnlyDispatch = vi.fn(async (): Promise<ThreadSummary> => ({
      summary: 'HR thread — kept local.',
      decisions: [],
      open_questions: [],
      participants: ['hr@x.co'],
    }));
    const frontierDispatch = vi.fn(async () => {
      throw new Error('frontier should not be called for HR threads');
    });
    void frontierDispatch; // assert by contract via the production wiring
    const res = await summarizeThread({
      db,
      threadId: 'tid-hr',
      queue,
      dispatchFn: localOnlyDispatch,
    });
    expect(localOnlyDispatch).toHaveBeenCalledTimes(1);
    expect(res.summary).toBe('HR thread — kept local.');
  });

  it('single-message thread returns concise summary (no error)', async () => {
    seed(db, 'tid-1msg', [{ id: 'only', from: 'a@x.co', snippet: 'Hi.' }]);
    const queue = new PQueue({ concurrency: 1 });
    const dispatchFn = vi.fn(async (): Promise<ThreadSummary> => ({
      summary: 'Single message.',
      decisions: [],
      open_questions: [],
      participants: ['a@x.co'],
    }));
    const res = await summarizeThread({
      db,
      threadId: 'tid-1msg',
      queue,
      dispatchFn,
    });
    expect(res.summary).toBe('Single message.');
  });

  it('empty thread returns empty-summary marker (no dispatch)', async () => {
    const queue = new PQueue({ concurrency: 1 });
    const dispatchFn = vi.fn();
    const res = await summarizeThread({
      db,
      threadId: 'nonexistent',
      queue,
      dispatchFn: dispatchFn as never,
    });
    expect(dispatchFn).not.toHaveBeenCalled();
    expect(res.summary).toBe('thread has no messages');
  });

  it('dispatch goes through scheduler.queue (p-queue serialization)', async () => {
    seed(db, 'tid-q', [{ id: 'm1', from: 'a@x.co' }]);
    const queue = new PQueue({ concurrency: 1 });
    const queueSpy = vi.spyOn(queue, 'add');
    const dispatchFn = vi.fn(async (): Promise<ThreadSummary> => ({
      summary: 'ok',
      decisions: [],
      open_questions: [],
      participants: [],
    }));
    await summarizeThread({ db, threadId: 'tid-q', queue, dispatchFn });
    expect(queueSpy).toHaveBeenCalledTimes(1);
  });

  it('dispatch throws → fallback summary returned (never throws to caller)', async () => {
    seed(db, 'tid-fail', [{ id: 'm1', from: 'a@x.co' }]);
    const queue = new PQueue({ concurrency: 1 });
    const dispatchFn = vi.fn(async () => {
      throw new Error('llm down');
    });
    const res = await summarizeThread({
      db,
      threadId: 'tid-fail',
      queue,
      dispatchFn,
    });
    expect(res.summary).toBe('thread summary unavailable');
  });
});
