/**
 * Plan 08-02 Task 3 — persist tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb } from '../db/connect';
import { runMigrations } from '../db/migrations/runner';
import { createTempUserDataDir } from '../../../tests/setup';
import {
  saveWeeklyRecap,
  getWeeklyRecap,
  finalizeRecap,
  listSectionEdits,
} from './persist';
import type { RecapCanonical } from './schema';

const MIGRATIONS_DIR = path.resolve(__dirname, '../db/migrations');

function freshDb() {
  const dataDir = createTempUserDataDir('aria-recap-persist');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

const canonical: RecapCanonical = {
  isoWeek: '2026-W20',
  weekStartYmd: '2026-05-11',
  meetings: { heading: 'M', blocks: [] },
  actions: { heading: 'A', blocks: [] },
  wins: { heading: 'W', blocks: [] },
  upcoming: { heading: 'U', blocks: [] },
  whatAriaDid: { heading: 'WAD', narrative: 'n', auditRowRefs: [], blocks: [] },
};

describe('weekly_recap persist', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => { db = freshDb(); });
  afterEach(() => { closeDb(db); });

  it('Test 4: saveWeeklyRecap upserts on iso_week', () => {
    saveWeeklyRecap(db, { isoWeek: '2026-W20', weekStartYmd: '2026-05-11', canonical });
    const r = getWeeklyRecap(db, '2026-W20');
    expect(r).not.toBeNull();
    expect(r!.canonical.isoWeek).toBe('2026-W20');
  });

  it('Test 5: same iso_week regeneration replaces canonical_json', () => {
    saveWeeklyRecap(db, { isoWeek: '2026-W20', weekStartYmd: '2026-05-11', canonical });
    saveWeeklyRecap(db, {
      isoWeek: '2026-W20',
      weekStartYmd: '2026-05-11',
      canonical: { ...canonical, whatAriaDid: { ...canonical.whatAriaDid, narrative: 'updated' } },
    });
    const r = getWeeklyRecap(db, '2026-W20');
    expect(r!.canonical.whatAriaDid.narrative).toBe('updated');
    const all = db.prepare(`SELECT COUNT(*) AS c FROM weekly_recap`).get() as { c: number };
    expect(all.c).toBe(1);
  });

  it('finalizeRecap stamps finalized_at + writes section edit diffs', () => {
    saveWeeklyRecap(db, { isoWeek: '2026-W20', weekStartYmd: '2026-05-11', canonical });
    const res = finalizeRecap(db, {
      isoWeek: '2026-W20',
      sectionEdits: [
        { sectionKey: 'wins', beforeText: 'old', afterText: 'new', category: 'tone' },
        { sectionKey: 'meetings', beforeText: 'same', afterText: 'same' }, // dropped (no diff)
      ],
    });
    expect(res.editsWritten).toBe(1);
    const r = getWeeklyRecap(db, '2026-W20');
    expect(r!.finalizedAt).not.toBeNull();
    const edits = listSectionEdits(db, res.recapId);
    expect(edits).toHaveLength(1);
    expect(edits[0].sectionKey).toBe('wins');
  });
});
