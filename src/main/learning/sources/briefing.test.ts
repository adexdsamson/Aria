import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb } from '../../db/connect';
import { runMigrations } from '../../db/migrations/runner';
import { createTempUserDataDir } from '../../../../tests/setup';
import {
  recordBriefingFeedback,
  recordBriefingDismiss,
  drainAppMetaDismissBacklog,
} from './briefing';
import { listSignals } from '../signal-log';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../db/migrations');

function freshDb() {
  const dataDir = createTempUserDataDir('aria-briefing-src');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

describe('briefing source', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => {
    db = freshDb();
  });

  it('recordBriefingFeedback writes briefing_feedback + signal in one txn', () => {
    recordBriefingFeedback(db, { briefingDate: '2026-05-20', sectionKey: 'email', thumb: 1 });
    const fb = db.prepare(`SELECT * FROM briefing_feedback`).all();
    expect(fb.length).toBe(1);
    const signals = listSignals(db, { source: 'briefing' });
    expect(signals.length).toBe(1);
    expect(signals[0]!.kind).toBe('briefing.feedback');
    closeDb(db);
  });

  it('recordBriefingDismiss emits briefing.dismiss signal', () => {
    recordBriefingDismiss(db, { briefingDate: '2026-05-20', kind: 'calendar_load' });
    const signals = listSignals(db, { source: 'briefing' });
    expect(signals.length).toBe(1);
    expect(signals[0]!.kind).toBe('briefing.dismiss');
    closeDb(db);
  });

  it('Test 6 (W-4) — drainAppMetaDismissBacklog replays 3 rows then deletes them', () => {
    db.prepare(`INSERT INTO app_meta (k, v) VALUES (?, ?)`).run(
      'briefing_dismiss_log:2026-05-19:calendar_load:abc123',
      '2026-05-19T08:00:00.000Z',
    );
    db.prepare(`INSERT INTO app_meta (k, v) VALUES (?, ?)`).run(
      'briefing_dismiss_log:2026-05-19:response_time:def456',
      '2026-05-19T08:01:00.000Z',
    );
    db.prepare(`INSERT INTO app_meta (k, v) VALUES (?, ?)`).run(
      'briefing_dismiss_log:2026-05-20:approval_edits:ghi789',
      '2026-05-20T08:00:00.000Z',
    );

    const drained = drainAppMetaDismissBacklog(db);
    expect(drained).toBe(3);

    const fb = db.prepare(`SELECT COUNT(*) AS c FROM briefing_feedback`).get() as { c: number };
    expect(fb.c).toBe(3);
    const signals = listSignals(db, { source: 'briefing' });
    expect(signals.length).toBe(3);
    const remaining = db
      .prepare(`SELECT COUNT(*) AS c FROM app_meta WHERE k LIKE 'briefing_dismiss_log:%'`)
      .get() as { c: number };
    expect(remaining.c).toBe(0);

    // Second call is a no-op (idempotent).
    expect(drainAppMetaDismissBacklog(db)).toBe(0);
    closeDb(db);
  });

  it('Test 4 (cross-source) — all writes route through writeSignal chokepoint', () => {
    recordBriefingFeedback(db, { briefingDate: '2026-05-20', sectionKey: 'news', thumb: -1 });
    const all = listSignals(db, { limit: 10 });
    expect(all.length).toBe(1);
    closeDb(db);
  });
});
