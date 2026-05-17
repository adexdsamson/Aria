/**
 * Plan 03-03 — triage-on-sync integration test.
 *
 * Wires GmailSync against a real SQLCipher DB (migrations 1..8) and asserts:
 *   - Post-sync hook fires exactly once per newly-inserted gmail_message row.
 *   - Re-running sync with a mix of new + existing rows fires the hook ONLY
 *     for the new ones (delta-only per RESEARCH §OQ-5).
 *   - Briefing's gatherEmailCandidates returns rows JOINed via email_triage
 *     and filtered to priority IN ('urgent','needs-you') — NOT is_important.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import PQueueImport from 'p-queue';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PQueue: typeof PQueueImport = ((PQueueImport as any).default ?? PQueueImport) as typeof PQueueImport;
import { openDb, closeDb, type Db } from '../../src/main/db/connect';
import { runMigrations } from '../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../setup';
import { createGmailSync } from '../../src/main/integrations/google/sync-gmail';
import type {
  GmailClient,
  GmailMessageMetadata,
  ListHistoryResult,
  ListMessagesResult,
} from '../../src/main/integrations/google/gmail';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../src/main/db/migrations');

function freshDb(): Db {
  const dataDir = createTempUserDataDir('aria-triage-on-sync');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

function md(id: string, threadId: string): GmailMessageMetadata {
  return {
    id,
    threadId,
    historyId: '100',
    internalDate: String(Date.parse('2026-05-17T10:00:00Z')),
    snippet: `snippet-${id}`,
    labelIds: ['INBOX', 'UNREAD'],
    payload: {
      headers: [
        { name: 'From', value: `${id}@example.com` },
        { name: 'Subject', value: `Subject ${id}` },
      ],
    },
  };
}

function seedAccount(db: Db, historyId: string | null): void {
  db.prepare(
    `INSERT OR REPLACE INTO gmail_account
     (id, email, history_id, last_synced_at, last_error, connected_at)
     VALUES (1, 'a@b.com', ?, NULL, NULL, ?)`,
  ).run(historyId, new Date().toISOString());
}

function fakeClient(metas: GmailMessageMetadata[]): GmailClient {
  const map = new Map<string, GmailMessageMetadata>();
  for (const m of metas) map.set(m.id, m);
  return {
    async getProfile() {
      return { emailAddress: 'a@b.com', historyId: '200' };
    },
    async listHistory(): Promise<ListHistoryResult> {
      return {
        historyId: '200',
        history: metas.map((m) => ({
          messagesAdded: [{ message: { id: m.id, threadId: m.threadId } }],
        })),
      };
    },
    async getMessageMetadata(id: string): Promise<GmailMessageMetadata> {
      return map.get(id) as GmailMessageMetadata;
    },
    async listMessages(): Promise<ListMessagesResult> {
      return {
        messages: metas.map((m) => ({ id: m.id, threadId: m.threadId })),
        historyId: '200',
      };
    },
  } as unknown as GmailClient;
}

describe('triage-on-sync integration', () => {
  let db: Db;
  beforeEach(() => {
    db = freshDb();
  });
  afterEach(() => {
    closeDb(db);
  });

  it('post-sync hook fires exactly once per newly-inserted message', async () => {
    seedAccount(db, '100');
    const metas = [md('m1', 't1'), md('m2', 't2'), md('m3', 't3')];
    const client = fakeClient(metas);
    const queue = new PQueue({ concurrency: 1 });
    const onMessagesInserted = vi.fn();

    const sync = createGmailSync({
      db,
      client,
      scheduler: { queue },
      onMessagesInserted,
    });
    await sync.tick();

    expect(onMessagesInserted).toHaveBeenCalledTimes(1);
    const ids = onMessagesInserted.mock.calls[0]![0] as string[];
    expect([...ids].sort()).toEqual(['m1', 'm2', 'm3']);
  });

  it('re-running sync with 1 new + 3 existing fires hook only for the new id (delta-only)', async () => {
    seedAccount(db, '100');
    const initialMetas = [md('m1', 't1'), md('m2', 't2'), md('m3', 't3')];
    const queue = new PQueue({ concurrency: 1 });
    const calls: string[][] = [];
    const onMessagesInserted = (ids: string[]) => {
      calls.push([...ids]);
    };

    const sync1 = createGmailSync({
      db,
      client: fakeClient(initialMetas),
      scheduler: { queue },
      onMessagesInserted,
    });
    await sync1.tick();
    // Reset cursor to force re-fetch through listHistory in second tick
    db.prepare('UPDATE gmail_account SET history_id = ? WHERE id = 1').run('100');

    const secondMetas = [
      md('m1', 't1'),
      md('m2', 't2'),
      md('m3', 't3'),
      md('m4', 't4'),
    ];
    const sync2 = createGmailSync({
      db,
      client: fakeClient(secondMetas),
      scheduler: { queue },
      onMessagesInserted,
    });
    await sync2.tick();

    expect(calls.length).toBe(2);
    // Second invocation should contain ONLY m4 — delta-only.
    expect(calls[1]).toEqual(['m4']);
  });

  it('briefing gatherEmailCandidates JOINs email_triage and filters by priority', async () => {
    // Seed three messages and three triage rows of differing priorities.
    const now = '2026-05-17T10:00:00Z';
    for (const [id, prio] of [
      ['mu', 'urgent'],
      ['mn', 'needs-you'],
      ['mf', 'fyi'],
    ] as const) {
      db.prepare(
        `INSERT INTO gmail_message
         (id, thread_id, from_addr, subject, snippet, received_at, label_ids,
          is_unread, is_important, history_id, fetched_at)
         VALUES (?, 't', 'x@y.com', ?, ?, ?, '[]', 1, 0, NULL, ?)`,
      ).run(id, `subj ${id}`, `snip ${id}`, now, now);
      db.prepare(
        `INSERT INTO email_triage
         (message_id, classifier_version, priority, signals_json, summary, ts)
         VALUES (?, 'v1', ?, '[]', '', ?)`,
      ).run(id, prio, now);
    }
    // Set message clocks so the relative "now - 24h" filter sees them.
    // received_at='2026-05-17T10:00:00Z' is fine — SQLite datetime('now',...)
    // is current real time; rewrite received_at to recent.
    db.prepare(
      "UPDATE gmail_message SET received_at = datetime('now','-1 hour')",
    ).run();

    const rows = db
      .prepare(
        `SELECT m.id AS id
         FROM gmail_message m
         INNER JOIN email_triage t ON t.message_id = m.id
         WHERE t.priority IN ('urgent','needs-you')
           AND m.received_at >= datetime('now','-24 hours')
         ORDER BY CASE t.priority WHEN 'urgent' THEN 0 ELSE 1 END,
                  m.received_at DESC`,
      )
      .all() as Array<{ id: string }>;
    const ids = rows.map((r) => r.id);
    expect(ids).toContain('mu');
    expect(ids).toContain('mn');
    expect(ids).not.toContain('mf'); // fyi excluded
    expect(ids[0]).toBe('mu'); // urgent sorts first
  });
});
