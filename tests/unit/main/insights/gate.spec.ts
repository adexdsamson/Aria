/**
 * Plan 08-01 Task 2 — checkInsightGate tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';
import { checkInsightGate, RECURRING_THEMES_MIN_CHUNKS } from '../../../../src/main/insights/gate';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

function freshDb() {
  const dataDir = createTempUserDataDir('aria-insight-gate');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

function isoDaysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe('checkInsightGate', () => {
  let db: ReturnType<typeof freshDb>;
  const NOW = new Date('2026-05-20T12:00:00.000Z');

  beforeEach(() => { db = freshDb(); });
  afterEach(() => { closeDb(db); });

  it('Case 1 — calendar_load blocked when MIN(start) is <14d ago', () => {
    db.prepare(
      `INSERT INTO calendar_event (id, calendar_id, summary, start_at_utc, end_at_utc, updated_at, fetched_at)
       VALUES (?, 'primary', 'meet', ?, ?, ?, ?)`,
    ).run('e1', isoDaysAgo(NOW, 5), isoDaysAgo(NOW, 5), NOW.toISOString(), NOW.toISOString());
    const r = checkInsightGate(db, { now: NOW, kind: 'calendar_load' });
    expect(r.unlocked).toBe(false);
    expect(r.blockedKinds).toContain('calendar_load');
    expect(r.daysRemaining).toBeGreaterThan(0);
  });

  it('Case 2 — response_time blocked when MIN(received_at) <14d ago', () => {
    db.prepare(
      `INSERT INTO gmail_message (id, thread_id, from_addr, received_at, label_ids, fetched_at)
       VALUES ('m1','t1','a@b.com', ?, '[]', ?)`,
    ).run(isoDaysAgo(NOW, 7), NOW.toISOString());
    const r = checkInsightGate(db, { now: NOW, kind: 'response_time' });
    expect(r.blockedKinds).toContain('response_time');
  });

  it('Case 3 — unlocked when all four corpora satisfy 14-day window + chunk threshold', () => {
    db.prepare(
      `INSERT INTO calendar_event (id, calendar_id, summary, start_at_utc, end_at_utc, updated_at, fetched_at)
       VALUES ('e','primary','x',?,?,?,?)`,
    ).run(isoDaysAgo(NOW, 30), isoDaysAgo(NOW, 30), NOW.toISOString(), NOW.toISOString());
    db.prepare(
      `INSERT INTO gmail_message (id, thread_id, from_addr, received_at, label_ids, fetched_at)
       VALUES ('m','t','a@b.com',?, '[]', ?)`,
    ).run(isoDaysAgo(NOW, 30), NOW.toISOString());
    db.prepare(
      `INSERT INTO approval (id, kind, state, created_at, updated_at, idempotency_key)
       VALUES ('ap','email_send','approved',?,?,?)`,
    ).run(isoDaysAgo(NOW, 30), NOW.toISOString(), 'key1');
    // Seed ≥50 alive email chunks for recurring_themes chunk floor.
    const insertChunk = db.prepare(
      `INSERT INTO rag_chunk (id, source_kind, source_id, text, char_start, char_end, token_count, created_at, updated_at)
       VALUES (?, 'email', 'src', 't', 0, 1, 1, ?, ?)`,
    );
    for (let i = 0; i < RECURRING_THEMES_MIN_CHUNKS + 1; i++) {
      insertChunk.run(`c${i}`, NOW.toISOString(), NOW.toISOString());
    }
    const r = checkInsightGate(db, { now: NOW });
    expect(r.unlocked).toBe(true);
    expect(r.blockedKinds).toEqual([]);
    expect(r.daysRemaining).toBe(0);
  });

  it('Case 4 — recurring_themes blocked with <50 chunks even when corpus age satisfied', () => {
    db.prepare(
      `INSERT INTO gmail_message (id, thread_id, from_addr, received_at, label_ids, fetched_at)
       VALUES ('m','t','a@b.com',?, '[]', ?)`,
    ).run(isoDaysAgo(NOW, 30), NOW.toISOString());
    // No rag_chunk rows -> hardBlocked.
    const r = checkInsightGate(db, { now: NOW, kind: 'recurring_themes' });
    expect(r.blockedKinds).toContain('recurring_themes');
  });

  it('Case 5 — approval_edits blocked when MIN(created_at) <14d', () => {
    db.prepare(
      `INSERT INTO approval (id, kind, state, created_at, updated_at, idempotency_key)
       VALUES ('a1','email_send','approved',?,?,?)`,
    ).run(isoDaysAgo(NOW, 3), NOW.toISOString(), 'k');
    const r = checkInsightGate(db, { now: NOW, kind: 'approval_edits' });
    expect(r.blockedKinds).toContain('approval_edits');
  });

  it('Case 6 — gate is pure SQL: empty fresh DB returns blocked for every kind, never throws', () => {
    const r = checkInsightGate(db, { now: NOW });
    expect(r.unlocked).toBe(false);
    expect(r.blockedKinds.length).toBe(4);
  });
});
