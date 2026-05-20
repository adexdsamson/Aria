/**
 * Plan 08-01 Task 3 — compute.ts tests.
 *
 * Snapshot/shape checks against seeded DB fixtures. Heavy emphasis on the
 * T-08-02 invariant: recurringThemes label-gen must receive cluster TERMS,
 * never raw chunk text. We assert this via a spy.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';
import {
  computeCalendarLoadDelta,
  computeResponseTimeTrend,
  computeRecurringThemes,
  computeApprovalEditPattern,
} from '../../../../src/main/insights/compute';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

function freshDb() {
  const dataDir = createTempUserDataDir('aria-insight-compute');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

/** Tuesday week-start. */
const WEEK = '2026-05-11';

describe('computeCalendarLoadDelta', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => { db = freshDb(); });
  afterEach(() => { closeDb(db); });

  it('returns numeric aggregate matching schema; deltaPct = 100 when last week is 0', () => {
    db.prepare(
      `INSERT INTO calendar_event (id, calendar_id, summary, start_at_utc, end_at_utc, updated_at, fetched_at)
       VALUES ('e1','primary','meet','2026-05-12T10:00:00.000Z','2026-05-12T11:00:00.000Z',?,?)`,
    ).run(new Date().toISOString(), new Date().toISOString());
    const out = computeCalendarLoadDelta(db, WEEK);
    expect(out.kind).toBe('calendar_load');
    expect(out.meetingHoursThisWeek).toBeGreaterThan(0);
    expect(out.meetingHoursLastWeek).toBe(0);
    expect(out.deltaPct).toBe(100);
    expect(typeof out.focusBlockCount).toBe('number');
  });

  it('returns zeros against an empty DB without throwing', () => {
    const out = computeCalendarLoadDelta(db, WEEK);
    expect(out.meetingHoursThisWeek).toBe(0);
    expect(out.meetingHoursLastWeek).toBe(0);
    expect(out.deltaPct).toBe(0);
  });
});

describe('computeResponseTimeTrend', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => { db = freshDb(); });
  afterEach(() => { closeDb(db); });

  it('produces typed payload over an empty corpus', () => {
    const out = computeResponseTimeTrend(db, WEEK);
    expect(out.kind).toBe('response_time');
    expect(out.medianMinutesThisWeek).toBe(0);
    expect(out.medianMinutesLastWeek).toBe(0);
    expect(out.perPersonTop3).toEqual([]);
  });
});

describe('computeApprovalEditPattern', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => { db = freshDb(); });
  afterEach(() => { closeDb(db); });

  it('counts edited drafts; sharePct = 100 when every approval has body_edited != body_original', () => {
    const insert = db.prepare(
      `INSERT INTO approval (id, kind, state, created_at, updated_at, idempotency_key, body_original, body_edited)
       VALUES (?,?,?,?,?,?,?,?)`,
    );
    insert.run('a1','email_send','approved','2026-05-12T10:00:00.000Z','2026-05-12T10:00:00.000Z','k1','hello','hello edited');
    insert.run('a2','email_send','sent','2026-05-12T11:00:00.000Z','2026-05-12T11:00:00.000Z','k2','x','y');
    const out = computeApprovalEditPattern(db, WEEK);
    expect(out.kind).toBe('approval_edits');
    expect(out.editedDraftSharePct).toBe(100);
  });

  it('returns 0 share against an empty DB', () => {
    const out = computeApprovalEditPattern(db, WEEK);
    expect(out.editedDraftSharePct).toBe(0);
    expect(out.topEditCategories).toEqual([]);
  });
});

describe('computeRecurringThemes (T-08-02 invariant)', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => { db = freshDb(); });
  afterEach(() => { closeDb(db); });

  it('returns empty themes when no embeddings exist', async () => {
    const out = await computeRecurringThemes(db, WEEK);
    expect(out.kind).toBe('recurring_themes');
    expect(out.topThemes).toEqual([]);
  });

  it('label-gen callback receives top-N TERMS only, never raw chunk text', async () => {
    // Seed 3 chunks with embeddings. Vectors are 4-d Float32Array buffers.
    const ts = new Date().toISOString();
    const insertChunk = db.prepare(
      `INSERT INTO rag_chunk (id, source_kind, source_id, text, char_start, char_end, token_count, created_at, updated_at)
       VALUES (?, 'email', 'src', ?, 0, 100, 10, ?, ?)`,
    );
    const insertEmb = db.prepare(
      `INSERT INTO rag_embedding (chunk_id, model_id, dim, vector, embedded_at) VALUES (?, 'm', 4, ?, ?)`,
    );
    const raw1 = 'invoice payment from BIG_SECRET_CLIENT_NAME at confidential dot com';
    const raw2 = 'invoice billing summary BIG_SECRET_CLIENT_NAME terms';
    const raw3 = 'invoice draft attachments BIG_SECRET_CLIENT_NAME quarterly';
    const v1 = Buffer.from(new Float32Array([1, 0, 0, 0]).buffer);
    const v2 = Buffer.from(new Float32Array([0.9, 0.1, 0, 0]).buffer);
    const v3 = Buffer.from(new Float32Array([0.95, 0.05, 0, 0]).buffer);
    insertChunk.run('c1', raw1, ts, ts);
    insertChunk.run('c2', raw2, ts, ts);
    insertChunk.run('c3', raw3, ts, ts);
    insertEmb.run('c1', v1, ts);
    insertEmb.run('c2', v2, ts);
    insertEmb.run('c3', v3, ts);

    const labelSpy = vi.fn(async (terms: string[]) => terms.slice(0, 2).join('-'));
    const out = await computeRecurringThemes(db, WEEK, { labelFromTerms: labelSpy });

    expect(labelSpy).toHaveBeenCalled();
    // Critical invariant: every call's terms array contains short tokens, never raw text fragments.
    for (const call of labelSpy.mock.calls) {
      const terms = call[0] as string[];
      expect(Array.isArray(terms)).toBe(true);
      for (const t of terms) {
        expect(typeof t).toBe('string');
        expect(t.length).toBeLessThanOrEqual(40);
        expect(t).not.toContain(' '); // top-terms are single tokens
        // explicit raw-secret guard
        expect(t.toLowerCase()).not.toContain('big_secret_client_name');
      }
    }
    expect(out.kind).toBe('recurring_themes');
  });
});
