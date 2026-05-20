import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb } from '../../db/connect';
import { runMigrations } from '../../db/migrations/runner';
import { createTempUserDataDir } from '../../../../tests/setup';
import { categorizeSectionEdit, writeRecapSignals, topEditCategoriesFromSignals } from './recap';
import { listSignals } from '../signal-log';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../db/migrations');

function freshDb() {
  const dataDir = createTempUserDataDir('aria-recap-src');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

describe('recap source', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => {
    db = freshDb();
  });

  it('categorizeSectionEdit: structure / length / factual / tone', () => {
    expect(
      categorizeSectionEdit({ sectionKey: 's', beforeText: 'a\nb\nc', afterText: 'a\nb\nc\nd\ne' }),
    ).toBe('structure');
    expect(
      categorizeSectionEdit({
        sectionKey: 's',
        beforeText: 'short text',
        afterText: 'short text plus much more content here',
      }),
    ).toBe('length');
    expect(
      categorizeSectionEdit({
        sectionKey: 's',
        beforeText: 'Meeting on 2026-05-19 with Alice',
        afterText: 'Meeting on 2026-05-20 with Alice',
      }),
    ).toBe('factual');
    expect(
      categorizeSectionEdit({ sectionKey: 's', beforeText: 'hi friend', afterText: 'hello friend' }),
    ).toBe('tone');
  });

  it('Test 2 — writeRecapSignals emits per-section diff rows', () => {
    const n = writeRecapSignals(db, {
      isoWeek: '2026-W20',
      recapId: 7,
      edits: [
        { sectionKey: 'meetings', beforeText: 'short', afterText: 'short' }, // no-op
        { sectionKey: 'actions', beforeText: 'a'.repeat(100), afterText: 'a'.repeat(50) },
        { sectionKey: 'wins', beforeText: 'one\ntwo', afterText: 'one\ntwo\nthree\nfour' },
      ],
    });
    expect(n).toBe(2);
    const rows = listSignals(db, { limit: 10 });
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.source === 'recap')).toBe(true);
    closeDb(db);
  });

  it('topEditCategoriesFromSignals reads recap + approval categories', () => {
    writeRecapSignals(db, {
      isoWeek: '2026-W20',
      recapId: 1,
      edits: [
        { sectionKey: 'actions', beforeText: 'a'.repeat(100), afterText: 'a'.repeat(50) },
        { sectionKey: 'wins', beforeText: 'a'.repeat(100), afterText: 'a'.repeat(50) },
      ],
    });
    const top = topEditCategoriesFromSignals(db, { windowDays: 30, topN: 3 });
    expect(top).toContain('length');
    closeDb(db);
  });
});
