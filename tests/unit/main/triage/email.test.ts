/**
 * Plan 03-03 Task 1 — triage/email unit tests.
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
  triageMessage,
  TriageSchema,
  TRIAGE_CLASSIFIER_VERSION,
  type GmailMessageRow,
  type TriageResult,
} from '../../../../src/main/triage/email';

const MIGRATIONS_DIR = path.resolve(
  __dirname,
  '../../../../src/main/db/migrations',
);

function freshDb(): Db {
  const dataDir = createTempUserDataDir('aria-triage-email');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

function makeMessage(overrides: Partial<GmailMessageRow> = {}): GmailMessageRow {
  return {
    id: 'msg-1',
    thread_id: 'thr-1',
    from_addr: 'alice@example.com',
    subject: 'Status update',
    snippet: 'Quick note on the Q3 numbers.',
    received_at: '2026-05-17T10:00:00Z',
    is_unread: 1,
    ...overrides,
  };
}

function insertGmailMessage(db: Db, m: GmailMessageRow): void {
  db.prepare(
    `INSERT INTO gmail_message
     (id, thread_id, from_addr, subject, snippet, received_at, label_ids,
      is_unread, is_important, history_id, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, '[]', ?, 0, NULL, ?)`,
  ).run(
    m.id,
    m.thread_id,
    m.from_addr,
    m.subject,
    m.snippet,
    m.received_at,
    m.is_unread,
    m.received_at,
  );
}

describe('triage/email TriageSchema', () => {
  it('rejects unknown priority', () => {
    const r = TriageSchema.safeParse({
      priority: 'super-urgent',
      signals: [],
      summary: 'x',
    });
    expect(r.success).toBe(false);
  });

  it('accepts empty signals array', () => {
    const r = TriageSchema.safeParse({
      priority: 'fyi',
      signals: [],
      summary: '',
    });
    expect(r.success).toBe(true);
  });

  it('caps summary at 280 chars', () => {
    const r = TriageSchema.safeParse({
      priority: 'fyi',
      signals: [],
      summary: 'x'.repeat(281),
    });
    expect(r.success).toBe(false);
  });
});

describe('triage/email triageMessage', () => {
  let db: Db;
  beforeEach(() => {
    db = freshDb();
  });
  afterEach(() => {
    closeDb(db);
  });

  it('persists row with classifier_version stamped and returns result', async () => {
    const m = makeMessage({ id: 'msg-happy' });
    insertGmailMessage(db, m);
    const queue = new PQueue({ concurrency: 1 });
    const queueSpy = vi.spyOn(queue, 'add');
    const dispatchFn = vi.fn(async (): Promise<TriageResult> => ({
      priority: 'urgent',
      signals: ['question-asked', 'direct-to-me'],
      summary: 'Asks for sign-off on the contract by EOD.',
    }));

    const res = await triageMessage({ db, message: m, queue, dispatchFn });
    expect(res.priority).toBe('urgent');
    expect(res.signals).toContain('question-asked');
    expect(queueSpy).toHaveBeenCalledTimes(1);
    expect(dispatchFn).toHaveBeenCalledTimes(1);

    const row = db
      .prepare(
        'SELECT classifier_version, priority, signals_json, summary FROM email_triage WHERE message_id = ?',
      )
      .get(m.id) as
      | {
          classifier_version: string;
          priority: string;
          signals_json: string;
          summary: string;
        }
      | undefined;
    expect(row).toBeDefined();
    expect(row!.classifier_version).toBe(TRIAGE_CLASSIFIER_VERSION);
    expect(row!.priority).toBe('urgent');
    expect(JSON.parse(row!.signals_json)).toEqual([
      'question-asked',
      'direct-to-me',
    ]);
  });

  it('persists fallback row when dispatch throws (no re-attempt next sync)', async () => {
    const m = makeMessage({ id: 'msg-fail' });
    insertGmailMessage(db, m);
    const queue = new PQueue({ concurrency: 1 });
    const dispatchFn = vi.fn(async () => {
      throw new Error('router down');
    });

    const res = await triageMessage({ db, message: m, queue, dispatchFn });
    expect(res.priority).toBe('fyi');
    expect(res.signals).toEqual(['automated']);
    expect(res.summary).toBe('triage unavailable');

    const row = db
      .prepare('SELECT priority FROM email_triage WHERE message_id = ?')
      .get(m.id) as { priority: string } | undefined;
    expect(row?.priority).toBe('fyi');
  });

  it('second call for same message is idempotent (no second dispatch)', async () => {
    const m = makeMessage({ id: 'msg-idem' });
    insertGmailMessage(db, m);
    const queue = new PQueue({ concurrency: 1 });
    const dispatchFn = vi.fn(async (): Promise<TriageResult> => ({
      priority: 'needs-you',
      signals: ['reply-needed'],
      summary: 'Awaiting reply.',
    }));

    const a = await triageMessage({ db, message: m, queue, dispatchFn });
    const b = await triageMessage({ db, message: m, queue, dispatchFn });
    expect(dispatchFn).toHaveBeenCalledTimes(1);
    expect(a.priority).toBe(b.priority);
    expect(a.summary).toBe(b.summary);

    const count = db
      .prepare('SELECT COUNT(*) AS n FROM email_triage WHERE message_id = ?')
      .get(m.id) as { n: number };
    expect(count.n).toBe(1);
  });

  it('dispatch goes through scheduler.queue (p-queue serialization)', async () => {
    const m = makeMessage({ id: 'msg-queue' });
    insertGmailMessage(db, m);
    const queue = new PQueue({ concurrency: 1 });
    const queueSpy = vi.spyOn(queue, 'add');
    const dispatchFn = vi.fn(async (): Promise<TriageResult> => ({
      priority: 'fyi',
      signals: [],
      summary: 'ok',
    }));
    await triageMessage({ db, message: m, queue, dispatchFn });
    expect(queueSpy).toHaveBeenCalled();
  });

  it('rejects malformed dispatch output via Zod and falls back', async () => {
    const m = makeMessage({ id: 'msg-bad' });
    insertGmailMessage(db, m);
    const queue = new PQueue({ concurrency: 1 });
    const dispatchFn = vi.fn(
      // intentionally wrong shape
      async () =>
        ({
          priority: 'not-a-priority',
          signals: [],
          summary: 'x',
        }) as unknown as TriageResult,
    );
    const res = await triageMessage({ db, message: m, queue, dispatchFn });
    expect(res.priority).toBe('fyi');
    expect(res.summary).toBe('triage unavailable');
  });
});
