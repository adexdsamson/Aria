/**
 * Phase 15 / Plan 15-01 — Voice model-readiness KV preferences.
 *
 * Mirrors src/main/background/prefs.ts EXACTLY — namespaced keys in the
 * existing `settings(k, v)` KV table from migration 001.
 *
 * Correction 1 (PATTERNS.md): CONTEXT D-08 referenced `user_prefs` (ALTER
 * TABLE) but that table does NOT exist in the schema. Model-readiness is
 * stored here via the settings KV pattern — no migration created, no
 * ALTER TABLE anywhere in this file.
 *
 * Key namespace: 'voice.' (e.g. 'voice.modelReady', 'voice.modelPath',
 * 'voice.modelState') — cohabits cleanly with existing 'backgroundActivity.*'
 * and 'briefing.*' rows.
 */
import type { Database as Db } from 'better-sqlite3';
import type { VoiceModelStatus } from '../../shared/voice-types';

const KEY_PREFIX = 'voice.';

type VoicePrefKey = 'modelReady' | 'modelPath' | 'modelState';

function fullKey(key: VoicePrefKey): string {
  return KEY_PREFIX + key;
}

/** Default state: no model on disk, not downloading. */
const DEFAULT_STATUS: VoiceModelStatus = {
  ready: false,
  path: null,
  state: 0,
};

function readStr(db: Db, key: VoicePrefKey): string | undefined {
  try {
    const row = db
      .prepare('SELECT v FROM settings WHERE k = ?')
      .get(fullKey(key)) as { v?: string } | undefined;
    return row?.v;
  } catch {
    return undefined;
  }
}

function writeStr(db: Db, key: VoicePrefKey, value: string): void {
  db.prepare(
    `INSERT INTO settings (k, v) VALUES (?, ?)
     ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
  ).run(fullKey(key), value);
}

/**
 * Read the voice model readiness state from the settings KV table.
 *
 * Returns the default { ready: false, path: null, state: 0 } when:
 *   - db is null (pre-unlock / vault sealed)
 *   - rows are missing
 *   - the underlying query throws
 *
 * db-null tolerant — safe to call before unlock.
 */
export function getVoiceModelStatus(db: Db | null): VoiceModelStatus {
  if (!db) return { ...DEFAULT_STATUS };

  try {
    const readyRaw = readStr(db, 'modelReady');
    const pathRaw = readStr(db, 'modelPath');
    const stateRaw = readStr(db, 'modelState');

    if (readyRaw === undefined && stateRaw === undefined) {
      return { ...DEFAULT_STATUS };
    }

    const ready = readyRaw === '1';
    const path = pathRaw ?? null;
    const stateNum = stateRaw !== undefined ? parseInt(stateRaw, 10) : 0;
    const state = (stateNum === 0 || stateNum === 1 || stateNum === 2
      ? stateNum
      : 0) as 0 | 1 | 2;

    return { ready, path, state };
  } catch {
    return { ...DEFAULT_STATUS };
  }
}

/**
 * Persist the model as ready and record its path.
 * Sets state=1 (ready), ready=true.
 *
 * Throws if db is null (vault sealed) — callers must gate on db !== null.
 */
export function setVoiceModelReady(db: Db | null, modelPath: string): void {
  if (!db) {
    throw new Error('setVoiceModelReady: db is null (vault sealed)');
  }
  writeStr(db, 'modelReady', '1');
  writeStr(db, 'modelPath', modelPath);
  writeStr(db, 'modelState', '1');
}

/**
 * Mark the model download as in-progress.
 * Sets state=2 (downloading), ready=false, clears path.
 *
 * Throws if db is null (vault sealed) — callers must gate on db !== null.
 */
export function setVoiceModelDownloading(db: Db | null): void {
  if (!db) {
    throw new Error('setVoiceModelDownloading: db is null (vault sealed)');
  }
  writeStr(db, 'modelReady', '0');
  writeStr(db, 'modelState', '2');
  // Clear path when downloading starts (model isn't usable yet).
  db.prepare(
    `DELETE FROM settings WHERE k = ?`,
  ).run(fullKey('modelPath'));
}
