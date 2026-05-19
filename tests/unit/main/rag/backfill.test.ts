import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';
import {
  getStatus,
  readBackfillState,
  recordEtaProbe,
  seedBackfill,
  setBackfillState,
  skipBackfill,
} from '../../../../src/main/rag/backfill';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

function setupDb() {
  const dataDir = createTempUserDataDir('aria-backfill');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

function seedGmail(db: ReturnType<typeof setupDb>, n: number) {
  const now = '2026-05-15T10:00:00Z';
  for (let i = 0; i < n; i++) {
    db.prepare(
      `INSERT INTO gmail_message (
         id, thread_id, from_addr, subject, snippet, received_at, label_ids,
         is_unread, is_important, history_id, fetched_at
       ) VALUES (?, ?, 'a@b', 'subj', 'body', ?, '[]', 0, 0, NULL, ?)`,
    ).run(`m${i}`, `t${i}`, now, now);
  }
}

describe('backfill — Plan 07-02 Task 6', () => {
  let db: ReturnType<typeof setupDb>;

  beforeEach(() => {
    db = setupDb();
  });

  it('initial state is "pending"', () => {
    expect(readBackfillState(db)).toBe('pending');
  });

  it('seedBackfill enqueues all gmail rows in batches; resumable', () => {
    seedGmail(db, 1200);
    const res = seedBackfill(db, { batchSize: 500 });
    expect(res.enqueuedBySourceKind.email).toBe(1200);
    const n = (db.prepare(`SELECT count(*) AS n FROM rag_source_dirty`).get() as { n: number }).n;
    expect(n).toBe(1200);

    // Re-run: PRIMARY KEY collision means no double-enqueue (INSERT OR IGNORE).
    const res2 = seedBackfill(db, { batchSize: 500 });
    expect(res2.enqueuedBySourceKind.email).toBe(1200); // all candidates considered
    const n2 = (db.prepare(`SELECT count(*) AS n FROM rag_source_dirty`).get() as { n: number }).n;
    expect(n2).toBe(1200);
  });

  it('seedBackfill skips rows already chunked (resume from mid-run)', () => {
    seedGmail(db, 5);
    // Pre-populate rag_chunk for m0..m2 — those should be skipped.
    const now = new Date().toISOString();
    for (let i = 0; i < 3; i++) {
      db.prepare(
        `INSERT INTO rag_chunk (id, source_kind, source_id, text, char_start, char_end, token_count, created_at, updated_at)
         VALUES (?, 'email', ?, 'x', 0, 1, 1, ?, ?)`,
      ).run(`c${i}`, `m${i}`, now, now);
    }
    const res = seedBackfill(db);
    expect(res.enqueuedBySourceKind.email).toBe(2); // m3, m4
  });

  it('getStatus exposes state + counts + ETA derived from probe', () => {
    seedGmail(db, 3);
    seedBackfill(db);
    recordEtaProbe(db, 0.5); // 0.5s per chunk
    const status = getStatus(db);
    expect(status.state).toBe('in_progress');
    expect(status.enqueuedBySourceKind.email).toBe(3);
    expect(status.etaSecondsRemaining).toBeGreaterThan(0);
  });

  it('skipBackfill sets state to "skipped"', () => {
    skipBackfill(db);
    expect(readBackfillState(db)).toBe('skipped');
  });

  it('setBackfillState round-trips through app_meta', () => {
    setBackfillState(db, 'done');
    expect(readBackfillState(db)).toBe('done');
  });
});
