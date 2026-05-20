import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb } from '../db/connect';
import { runMigrations } from '../db/migrations/runner';
import { createTempUserDataDir } from '../../../tests/setup';
import {
  PreferencesSchema,
  DEFAULT_PREFERENCES,
  readPreferences,
  writePreferences,
  resetField,
  resetAll,
} from './prefs';

const MIGRATIONS_DIR = path.resolve(__dirname, '../db/migrations');

function freshDb() {
  const dataDir = createTempUserDataDir('aria-prefs');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

describe('prefs', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => {
    db = freshDb();
  });

  it('Test 1: PreferencesSchema matches CONTEXT shape', () => {
    expect(() => PreferencesSchema.parse(DEFAULT_PREFERENCES)).not.toThrow();
  });

  it('Test 2: readPreferences returns defaults when row absent', () => {
    const r = readPreferences(db);
    expect(r.preferences).toEqual(DEFAULT_PREFERENCES);
    expect(r.updatedAt).toBeNull();
    closeDb(db);
  });

  it('Test 3: writePreferences rejects unknown fields (closed shape)', () => {
    expect(() =>
      writePreferences(db, {
        preferences: { ...DEFAULT_PREFERENCES, bogus: 'x' } as never,
      }),
    ).toThrow();
    closeDb(db);
  });

  it('Test 4: resetField zeroes ONLY targeted field; lastUpdatedAt bumped', () => {
    writePreferences(db, {
      preferences: {
        voice: { terseness: 0.9, formality: 0.8 },
        briefing: { sectionOrder: ['x'] },
        scheduling: { preferredMeetingLength: 60 },
        triage: { vipDomains: ['acme.com'] },
      },
    });
    resetField(db, 'voice.terseness');
    const r = readPreferences(db);
    expect(r.preferences.voice.terseness).toBe(DEFAULT_PREFERENCES.voice.terseness);
    expect(r.preferences.voice.formality).toBe(0.8); // preserved
    expect(r.preferences.briefing.sectionOrder).toEqual(['x']); // preserved
    expect(r.preferences.triage.vipDomains).toEqual(['acme.com']); // preserved
    expect(r.updatedAt).not.toBeNull();
    closeDb(db);
  });

  it('Test 5: resetAll restores schema defaults', () => {
    writePreferences(db, {
      preferences: {
        voice: { terseness: 0.9, formality: 0.8 },
        briefing: { sectionOrder: ['x'] },
        scheduling: { preferredMeetingLength: 60 },
        triage: { vipDomains: ['acme.com'] },
      },
    });
    resetAll(db);
    const r = readPreferences(db);
    expect(r.preferences).toEqual(DEFAULT_PREFERENCES);
    closeDb(db);
  });

  it('resetField rejects unknown path (T-08-13 mitigation)', () => {
    expect(() => resetField(db, 'voice.__proto__')).toThrow(/unknown-field-path/);
    expect(() => resetField(db, 'bogus.field')).toThrow(/unknown-field-path/);
    closeDb(db);
  });
});
