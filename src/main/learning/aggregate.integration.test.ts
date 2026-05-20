import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb } from '../db/connect';
import { runMigrations } from '../db/migrations/runner';
import { createTempUserDataDir } from '../../../tests/setup';
import { aggregatePreferences } from './aggregate';
import { readPreferences, DEFAULT_PREFERENCES } from './prefs';
import { writeSignal } from './signal-log';

const MIGRATIONS_DIR = path.resolve(__dirname, '../db/migrations');

function freshDb() {
  const dataDir = createTempUserDataDir('aria-aggregate');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

describe('aggregate', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => {
    db = freshDb();
  });

  it('Test 6: aggregatePreferences reads last windowDays of signals and upserts', () => {
    writeSignal(db, {
      source: 'approval',
      kind: 'approval.edit',
      payload: { editCategory: 'length-shorter' },
    });
    const r = aggregatePreferences(db, { windowDays: 30 });
    expect(r.signalsCounted).toBe(1);
    const after = readPreferences(db);
    expect(after.updatedAt).not.toBeNull();
    closeDb(db);
  });

  it('Test 7: with zero signals, aggregator writes defaults (row exists)', () => {
    const r = aggregatePreferences(db, { windowDays: 30 });
    expect(r.signalsCounted).toBe(0);
    const after = readPreferences(db);
    expect(after.preferences).toEqual(DEFAULT_PREFERENCES);
    expect(after.updatedAt).not.toBeNull();
    closeDb(db);
  });

  it('Test 8: ≥60% length-shorter signals nudge voice.terseness toward 1.0', () => {
    // seed 6 shorter + 4 longer = 60% shorter
    for (let i = 0; i < 6; i++) {
      writeSignal(db, {
        source: 'approval',
        kind: 'approval.edit',
        payload: { editCategory: 'length-shorter' },
      });
    }
    for (let i = 0; i < 4; i++) {
      writeSignal(db, {
        source: 'approval',
        kind: 'approval.edit',
        payload: { editCategory: 'length-longer' },
      });
    }
    aggregatePreferences(db, { windowDays: 30 });
    const after = readPreferences(db);
    expect(after.preferences.voice.terseness).toBeGreaterThan(DEFAULT_PREFERENCES.voice.terseness);
    closeDb(db);
  });

  it('idempotent: re-running on same signals returns deterministic prefs', () => {
    writeSignal(db, { source: 'approval', kind: 'approval.edit', payload: { editCategory: 'length-shorter' } });
    const a = aggregatePreferences(db, { windowDays: 30 });
    const b = aggregatePreferences(db, { windowDays: 30 });
    expect(a.preferences).toEqual(b.preferences);
    closeDb(db);
  });

  it('signals outside windowDays are excluded', () => {
    const now = new Date('2026-05-20T12:00:00.000Z');
    writeSignal(db, {
      source: 'approval',
      kind: 'approval.edit',
      payload: { editCategory: 'length-shorter' },
      now: new Date('2026-01-01T00:00:00.000Z'), // ~5 months ago
    });
    const r = aggregatePreferences(db, { windowDays: 30, now });
    expect(r.signalsCounted).toBe(0);
    closeDb(db);
  });
});
