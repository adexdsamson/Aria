/**
 * Phase 15 / Plan 15-01 Task 2 — voice model-readiness KV prefs (TDD).
 *
 * Tests the behavior cases specified in the plan:
 *   1. getVoiceModelStatus(null) → default { ready: false, path: null, state: 0 }
 *   2. getVoiceModelStatus(db) with no rows → default
 *   3. setVoiceModelReady(db, path) then getVoiceModelStatus(db) → { ready: true, path, state: 1 }
 *   4. setVoiceModelDownloading(db) → state: 2, ready: false
 *   5. writing with db === null throws
 *
 * Uses an in-memory DB (openDb pattern from voice/confirm.spec.ts) with only
 * the settings table — no full migration chain needed, but we use the real
 * openDb so the native ABI binary is correctly swapped first.
 *
 * No new migration — correction 1: model-readiness is stored in settings(k,v).
 */
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createTempUserDataDir } from '../../../tests/setup';
import { openDb, closeDb, type Db } from '../db/connect';
import { runMigrations } from '../db/migrations/runner';
import {
  getVoiceModelStatus,
  setVoiceModelReady,
  setVoiceModelDownloading,
} from './prefs';

const MIGRATIONS_DIR = path.resolve(__dirname, '../db/migrations');

describe('voice model-readiness prefs (settings KV — no migration, correction 1)', () => {
  let db: Db;

  beforeEach(() => {
    const dataDir = createTempUserDataDir('aria-voice-prefs');
    const dbKey = crypto.randomBytes(32);
    db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });
  });

  afterEach(() => {
    closeDb(db);
  });

  it('getVoiceModelStatus(null) returns default when db is null (pre-unlock tolerance)', () => {
    const status = getVoiceModelStatus(null);
    expect(status).toEqual({ ready: false, path: null, state: 0 });
  });

  it('getVoiceModelStatus(db) returns default when no rows present', () => {
    const status = getVoiceModelStatus(db);
    expect(status).toEqual({ ready: false, path: null, state: 0 });
  });

  it('setVoiceModelReady + getVoiceModelStatus returns ready state (state: 1)', () => {
    const modelPath = '/home/user/.local/share/aria/models/ggml-large-v3-turbo-q5_0.bin';
    setVoiceModelReady(db, modelPath);
    const status = getVoiceModelStatus(db);
    expect(status).toEqual({ ready: true, path: modelPath, state: 1 });
  });

  it('setVoiceModelDownloading sets state:2 and ready:false', () => {
    setVoiceModelDownloading(db);
    const status = getVoiceModelStatus(db);
    expect(status).toEqual({ ready: false, path: null, state: 2 });
  });

  it('setVoiceModelReady with db === null throws (vault sealed)', () => {
    expect(() => setVoiceModelReady(null, '/some/path')).toThrow();
  });

  it('setVoiceModelDownloading with db === null throws (vault sealed)', () => {
    expect(() => setVoiceModelDownloading(null)).toThrow();
  });
});
