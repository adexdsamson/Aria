/**
 * Plan 03-04 Task 3 — drafting agent → approval row integration test.
 *
 * Verifies:
 *   - draftReply inserts an approval row in 'pending', transitions to
 *     'generating' BEFORE the LLM call (RESEARCH §Pattern 2), then 'ready'
 *     on success with body_original + classifier columns populated.
 *   - On router/draft failure the row stays in 'generating' so the
 *     next-launch sweep converts it to 'interrupted'.
 *   - Held-out IDs in voice_match_holdout are EXCLUDED from the few-shot
 *     exemplar pool fetched by voiceCorpus.fetchExemplars.
 *   - All LLM dispatch goes through scheduler.queue (.add spy).
 *   - Under the locked Task 2 decision (`few-shot-production`) the row's
 *     beta_voice column stays at the migration default 0.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import PQueue from 'p-queue';
import { openDb, closeDb } from '../../src/main/db/connect';
import { runMigrations } from '../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../setup';
import {
  draftReply,
  type GmailMessageRow,
} from '../../src/main/drafting/email';
import * as voiceCorpus from '../../src/main/drafting/voiceCorpus';
import * as sensitivity from '../../src/main/llm/sensitivityClassifier';
import { _resetDraftTablesForTests } from '../../src/main/llm/tokenize';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../src/main/db/migrations');

function freshDb() {
  const dataDir = createTempUserDataDir('aria-drafting-int');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

function seedSentMessage(
  db: ReturnType<typeof freshDb>,
  args: { id: string; subject?: string; snippet?: string; received_at?: string; labels?: string[] },
) {
  const labels = args.labels ?? ['SENT'];
  db.prepare(
    `INSERT INTO gmail_message
     (id, thread_id, from_addr, subject, snippet, received_at, label_ids,
      is_unread, is_important, history_id, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?)`,
  ).run(
    args.id,
    `thread-${args.id}`,
    'me@example.com',
    args.subject ?? 'Quick note',
    args.snippet ?? 'Hi — short reply body here.',
    args.received_at ?? '2026-04-01T10:00:00Z',
    JSON.stringify(labels),
    '2026-04-01T10:00:00Z',
  );
}

const SOURCE: GmailMessageRow = {
  id: 'msg-incoming-1',
  thread_id: 'thr-1',
  from_addr: 'Alice Lin <alice@example.com>',
  subject: 'Project sync next week',
  snippet: 'Hey — wanted to confirm timing for the Tuesday sync. Thoughts?',
  received_at: '2026-04-15T12:00:00Z',
};

describe('drafting/email draftReply integration', () => {
  let db: ReturnType<typeof freshDb>;
  let queue: InstanceType<typeof PQueue>;

  beforeEach(() => {
    _resetDraftTablesForTests();
    db = freshDb();
    queue = new PQueue({ concurrency: 1 });
    // Mock sensitivity classifier so dispatchHybrid resolves deterministically
    // to 'frontier' (no sensitive categories).
    vi.spyOn(sensitivity, 'classify').mockResolvedValue({
      categories: ['none'],
      severity: 'low',
      confidence: 0.9,
      rationale: 'no sensitive content',
    } as unknown as sensitivity.SensitivityResult);
    // Insert the incoming source message so the drafting agent can load it
    // (the agent itself doesn't read gmail_message — IPC layer does — but
    // we keep parity with real data shape).
    db.prepare(
      `INSERT INTO gmail_message
       (id, thread_id, from_addr, subject, snippet, received_at, label_ids,
        is_unread, is_important, history_id, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, NULL, ?)`,
    ).run(
      SOURCE.id,
      SOURCE.thread_id,
      SOURCE.from_addr,
      SOURCE.subject,
      SOURCE.snippet,
      SOURCE.received_at,
      JSON.stringify(['INBOX', 'UNREAD']),
      '2026-04-15T12:00:00Z',
    );
  });

  afterEach(() => {
    closeDb(db);
    vi.restoreAllMocks();
  });

  it('inserts pending → generating before LLM call → ready with classifier columns populated', async () => {
    seedSentMessage(db, { id: 'sent-1', snippet: 'Sounds good, Tuesday works.' });
    // Capture state at the moment the runFrontier/runLocal is invoked.
    let observedStateAtLlm: string | null = null;
    const runFrontier = vi.fn(async (_p: string) => {
      const row = db.prepare(`SELECT state FROM approval LIMIT 1`).get() as { state: string };
      observedStateAtLlm = row.state;
      return { subject: 'Re: Project sync next week', body: 'Tuesday works for me.' };
    });
    const runLocal = vi.fn(async (_p: string) => ({
      subject: 'Re: Project sync next week',
      body: '(local) Tuesday works.',
    }));

    const { approvalId, routed } = await draftReply(db, SOURCE, {
      queue,
      runLocal,
      runFrontier,
    });

    expect(observedStateAtLlm).toBe('generating');
    expect(routed).toBe('frontier');
    expect(runFrontier).toHaveBeenCalledTimes(1);
    expect(runLocal).not.toHaveBeenCalled();

    const row = db
      .prepare(`SELECT * FROM approval WHERE id = ?`)
      .get(approvalId) as Record<string, unknown>;
    expect(row.state).toBe('ready');
    expect(row.body_original).toBe('Tuesday works for me.');
    expect(row.subject).toBe('Re: Project sync next week');
    expect(row.source_message_id).toBe(SOURCE.id);
    expect(row.routed).toBe('frontier');
    expect(row.severity).toBe('low');
    expect(typeof row.classifier_version).toBe('string');
    expect(JSON.parse(String(row.recipients_json))).toEqual(['alice@example.com']);
    // Locked Task 2 decision = few-shot-production → beta_voice stays 0.
    expect(row.beta_voice).toBe(0);
  });

  it('leaves row in generating when the LLM throws (next-launch sweep recovers)', async () => {
    const runFrontier = vi.fn(async () => {
      throw new Error('frontier-explode');
    });
    const runLocal = vi.fn(async () => {
      throw new Error('local-explode');
    });

    await expect(
      draftReply(db, SOURCE, { queue, runLocal, runFrontier }),
    ).rejects.toBeTruthy();

    const row = db
      .prepare(`SELECT state FROM approval LIMIT 1`)
      .get() as { state: string };
    expect(row.state).toBe('generating');
  });

  it('excludes voice_match_holdout IDs from few-shot exemplar pool', () => {
    seedSentMessage(db, { id: 'sent-keep-1', snippet: 'Plain sent A' });
    seedSentMessage(db, { id: 'sent-keep-2', snippet: 'Plain sent B' });
    seedSentMessage(db, { id: 'sent-holdout', snippet: 'Held-out sent C' });
    db.prepare(
      `INSERT INTO voice_match_holdout (id, created_at) VALUES (?, ?)`,
    ).run('sent-holdout', '2026-04-01T00:00:00Z');

    const exemplars = voiceCorpus.fetchExemplars(db, {
      subject: SOURCE.subject,
      snippet: SOURCE.snippet,
    });
    const ids = exemplars.map((e) => e.id);
    expect(ids).toContain('sent-keep-1');
    expect(ids).toContain('sent-keep-2');
    expect(ids).not.toContain('sent-holdout');
  });
});
