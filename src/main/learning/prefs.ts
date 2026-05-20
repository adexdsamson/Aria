/**
 * Plan 08-03 Task 4 — Learned preferences read/write/per-field-reset.
 *
 * Single-row table (`learned_preferences`, id CHECK = 1) carrying a closed-shape
 * zod-validated JSON payload. Defaults applied lazily on read when no row is
 * present (no INSERT until the aggregator writes one).
 *
 * Per-field reset accepts a dotted path against the schema (e.g.
 * 'voice.terseness') and zeroes that field to its schema default; other fields
 * are preserved. resetAll restores the whole payload to defaults.
 *
 * Signals are intentionally NOT touched by reset operations — the signal log
 * is retained 90d under its own opt-out (Pitfall 8). resetting preferences
 * resets the derived state only; the next aggregator run rebuilds from
 * whatever signals are still in the window.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import { z } from 'zod';

type Db = Database.Database;

/**
 * Closed-shape preferences. Unknown top-level keys are rejected so renderer
 * cannot inject arbitrary fields via the LEARN_RESET_FIELD IPC.
 */
export const PreferencesSchema = z
  .object({
    voice: z
      .object({
        terseness: z.number().min(0).max(1),
        formality: z.number().min(0).max(1),
      })
      .strict(),
    briefing: z
      .object({
        sectionOrder: z.array(z.string()),
      })
      .strict(),
    scheduling: z
      .object({
        preferredMeetingLength: z.number().int().min(15).max(240),
      })
      .strict(),
    triage: z
      .object({
        vipDomains: z.array(z.string()),
      })
      .strict(),
  })
  .strict();

export type Preferences = z.infer<typeof PreferencesSchema>;

export const DEFAULT_PREFERENCES: Preferences = {
  voice: { terseness: 0.5, formality: 0.5 },
  briefing: { sectionOrder: ['open-actions', 'this-week', 'calendar', 'email', 'news'] },
  scheduling: { preferredMeetingLength: 30 },
  triage: { vipDomains: [] },
};

export interface PrefsRow {
  preferences: Preferences;
  updatedAt: string | null;
}

export function readPreferences(db: Db): PrefsRow {
  const row = db
    .prepare(`SELECT payload_json, updated_at FROM learned_preferences WHERE id = 1`)
    .get() as { payload_json: string; updated_at: string } | undefined;
  if (!row) return { preferences: DEFAULT_PREFERENCES, updatedAt: null };
  try {
    const parsed = PreferencesSchema.parse(JSON.parse(row.payload_json));
    return { preferences: parsed, updatedAt: row.updated_at };
  } catch {
    // Corrupted row → fall back to defaults; the next aggregator run upserts a clean row.
    return { preferences: DEFAULT_PREFERENCES, updatedAt: row.updated_at };
  }
}

export interface WritePrefsArgs {
  preferences: Preferences;
  now?: Date;
}

export function writePreferences(db: Db, args: WritePrefsArgs): void {
  const validated = PreferencesSchema.parse(args.preferences);
  const updatedAt = (args.now ?? new Date()).toISOString();
  db.prepare(
    `INSERT INTO learned_preferences (id, payload_json, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
  ).run(JSON.stringify(validated), updatedAt);
}

/**
 * Whitelist of valid dot-paths against PreferencesSchema. Renderer cannot
 * craft arbitrary paths (T-08-13 mitigation).
 */
const ALLOWED_FIELD_PATHS = new Set([
  'voice.terseness',
  'voice.formality',
  'briefing.sectionOrder',
  'scheduling.preferredMeetingLength',
  'triage.vipDomains',
]);

export function resetField(db: Db, fieldPath: string, now?: Date): void {
  if (!ALLOWED_FIELD_PATHS.has(fieldPath)) {
    throw new Error(`unknown-field-path:${fieldPath}`);
  }
  const current = readPreferences(db).preferences;
  const next = applyFieldDefault(current, fieldPath);
  writePreferences(db, { preferences: next, now });
}

export function resetAll(db: Db, now?: Date): void {
  writePreferences(db, { preferences: DEFAULT_PREFERENCES, now });
}

function applyFieldDefault(current: Preferences, fieldPath: string): Preferences {
  // Deep-clone, then overwrite only the targeted path with its DEFAULT_PREFERENCES value.
  const clone: Preferences = JSON.parse(JSON.stringify(current));
  const parts = fieldPath.split('.');
  let curRef: Record<string, unknown> = clone as unknown as Record<string, unknown>;
  let defRef: Record<string, unknown> = DEFAULT_PREFERENCES as unknown as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    curRef = curRef[parts[i]!] as Record<string, unknown>;
    defRef = defRef[parts[i]!] as Record<string, unknown>;
  }
  const leaf = parts[parts.length - 1]!;
  curRef[leaf] = defRef[leaf];
  return clone;
}

/** Read a setting from the canonical Phase-1 `settings` table. */
export function readSetting(db: Db, key: string): string | null {
  try {
    const row = db.prepare(`SELECT v FROM settings WHERE k = ?`).get(key) as { v: string } | undefined;
    return row?.v ?? null;
  } catch {
    return null;
  }
}

export function writeSetting(db: Db, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
  ).run(key, value);
}
