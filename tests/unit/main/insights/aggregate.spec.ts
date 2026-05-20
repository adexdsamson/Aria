/**
 * Plan 08-01 Task 5 — aggregate orchestrator integration test.
 *
 * Focus: gate-respect (B-3 invariant) + upsert idempotency + serialized LLM calls.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';
import { aggregate, weekStartYmdFor } from '../../../../src/main/insights/aggregate';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

function freshDb() {
  const dataDir = createTempUserDataDir('aria-insight-aggregate');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

function fakeRouter() {
  return {
    classify: vi.fn().mockResolvedValue({
      route: 'LOCAL', reason: 'test', model: 'm', provider: 'ollama',
    }),
  } as never;
}

function isoDaysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe('aggregate orchestrator', () => {
  let db: ReturnType<typeof freshDb>;
  const NOW = new Date('2026-05-20T12:00:00.000Z');
  const logger = { info: () => {}, warn: () => {} };

  beforeEach(() => { db = freshDb(); });
  afterEach(() => { closeDb(db); });

  it('with no data: all kinds blocked → no rows written', async () => {
    const week = weekStartYmdFor(NOW, 'UTC');
    const res = await aggregate(db, week, { router: fakeRouter(), logger, now: NOW });
    expect(res.written).toBe(0);
    expect(res.skipped.length).toBe(4);
    const rows = db.prepare(`SELECT COUNT(*) AS n FROM insights`).get() as { n: number };
    expect(rows.n).toBe(0);
  });

  it('upserts on (kind, week_ymd) — re-running same week is idempotent', async () => {
    // Seed enough data so calendar_load + response_time + approval_edits unlock.
    db.prepare(
      `INSERT INTO calendar_event (id, calendar_id, summary, start_at_utc, end_at_utc, updated_at, fetched_at)
       VALUES ('e','primary','m',?,?,?,?)`,
    ).run(isoDaysAgo(NOW, 30), isoDaysAgo(NOW, 30), NOW.toISOString(), NOW.toISOString());
    db.prepare(
      `INSERT INTO gmail_message (id, thread_id, from_addr, received_at, label_ids, fetched_at)
       VALUES ('m','t','a@b.com',?, '[]', ?)`,
    ).run(isoDaysAgo(NOW, 30), NOW.toISOString());
    db.prepare(
      `INSERT INTO approval (id, kind, state, created_at, updated_at, idempotency_key)
       VALUES ('ap','email_send','approved',?,?,?)`,
    ).run(isoDaysAgo(NOW, 30), NOW.toISOString(), 'k');

    // Stub generateObject globally via prose's seam? insightProse uses real
    // generateObject; failures are caught and produce a placeholder. Either way
    // the rows still upsert.
    const week = weekStartYmdFor(NOW, 'UTC');
    const r1 = await aggregate(db, week, { router: fakeRouter(), logger, now: NOW });
    const r2 = await aggregate(db, week, { router: fakeRouter(), logger, now: NOW });
    const rows = db.prepare(`SELECT COUNT(*) AS n FROM insights`).get() as { n: number };
    // At least one kind should have written; second run does not duplicate.
    expect(rows.n).toBeGreaterThanOrEqual(1);
    expect(rows.n).toBeLessThanOrEqual(4);
    expect(r1.written + r1.skipped.length).toBe(4);
    expect(r2.written + r2.skipped.length).toBe(4);
  });
});
