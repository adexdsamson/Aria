/**
 * Phase 15 / Plan 15-01 — Voice model-readiness KV preferences.
 * Phase 17 / Plan 17-01 — Extended with D-16 voice settings keys.
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
import type { VoicePrefsDto } from '../../shared/ipc-contract';

const KEY_PREFIX = 'voice.';

export type VoicePrefKey =
  | 'modelReady' | 'modelPath' | 'modelState'   // Phase 15 (unchanged)
  | 'speed'                                       // Phase 17 D-16: TTS speed ('0.75'|'1.0'|'1.25'|'1.5')
  | 'voiceId'                                     // Phase 17 D-16: Kokoro voice name
  | 'useCloud'                                    // Phase 17 D-16: cloud STT/TTS enabled ('1'|'0')
  | 'cloudAudio.consented'                        // Phase 17 D-14: cloud consent ('1'|'0')
  | 'cloudAudio.consentedAt';                     // Phase 17 D-14: consent ISO timestamp

/** Defaults for the Phase 17 D-16 voice prefs. */
export const VOICE_PREF_DEFAULTS: VoicePrefsDto = {
  speed: 1.0,
  voiceId: '',
  useCloud: false,
};

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

// ---------------------------------------------------------------------------
// Phase 17 / Plan 17-01 — D-16 voice prefs (speed / voiceId / useCloud)
// ---------------------------------------------------------------------------

/**
 * Read the current voice prefs from the settings KV table.
 *
 * Returns VOICE_PREF_DEFAULTS when:
 *   - db is null (pre-unlock / vault sealed)
 *   - rows are missing (first run)
 *   - the underlying query throws
 *
 * db-null tolerant — safe to call before unlock.
 */
export function getVoicePrefs(db: Db | null): VoicePrefsDto {
  if (!db) return { ...VOICE_PREF_DEFAULTS };

  try {
    const speedRaw = readStr(db, 'speed');
    const voiceIdRaw = readStr(db, 'voiceId');
    const useCloudRaw = readStr(db, 'useCloud');

    return {
      speed: speedRaw !== undefined ? parseFloat(speedRaw) : VOICE_PREF_DEFAULTS.speed,
      voiceId: voiceIdRaw !== undefined ? voiceIdRaw : VOICE_PREF_DEFAULTS.voiceId,
      useCloud: useCloudRaw === '1',
    };
  } catch {
    return { ...VOICE_PREF_DEFAULTS };
  }
}

/**
 * Write a single voice preference KV entry.
 *
 * Thin wrapper over writeStr — exposes the VoicePrefKey type to callers
 * so that the Phase-15 keys and Phase-17 keys share one write surface.
 *
 * Throws if db is null (vault sealed) — callers must gate on db !== null.
 */
export function writeVoicePref(db: Db | null, key: VoicePrefKey, value: string): void {
  if (!db) {
    throw new Error('writeVoicePref: db is null (vault sealed)');
  }
  writeStr(db, key, value);
}

/**
 * Read a single voice preference KV entry as a raw string.
 *
 * Returns undefined when db is null (pre-unlock) or the key is absent.
 * db-null tolerant — safe to call before unlock.
 *
 * Used by handlers that need to read a single key (e.g. cloudAudio.consented
 * for the D-14 consent audit) without fetching the full VoicePrefsDto.
 */
export function readVoicePref(db: Db | null, key: VoicePrefKey): string | undefined {
  if (!db) return undefined;
  return readStr(db, key);
}
