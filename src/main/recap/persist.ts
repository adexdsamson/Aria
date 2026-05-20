/**
 * Plan 08-02 Task 3 — Weekly recap persistence helpers.
 *
 * `saveWeeklyRecap` upserts on iso_week (idempotent regeneration).
 * `finalizeRecap` writes `finalized_at` + emits per-section diff rows that
 * Stream 3 (learning pipeline) consumes.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import { RecapCanonicalSchema, type RecapCanonical, type RecapSectionKey } from './schema';

type Db = Database.Database;

export interface WeeklyRecapRow {
  id: number;
  isoWeek: string;
  weekStartYmd: string;
  generatedAt: string;
  finalizedAt: string | null;
  canonical: RecapCanonical;
}

export interface SaveWeeklyRecapArgs {
  isoWeek: string;
  weekStartYmd: string;
  canonical: RecapCanonical;
  now?: Date;
}

export function saveWeeklyRecap(db: Db, args: SaveWeeklyRecapArgs): WeeklyRecapRow {
  const validated = RecapCanonicalSchema.parse(args.canonical);
  const generatedAt = (args.now ?? new Date()).toISOString();
  db.prepare(
    `INSERT INTO weekly_recap (iso_week, week_start_ymd, generated_at, canonical_json)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(iso_week) DO UPDATE SET
       week_start_ymd = excluded.week_start_ymd,
       generated_at   = excluded.generated_at,
       canonical_json = excluded.canonical_json,
       finalized_at   = NULL`,
  ).run(args.isoWeek, args.weekStartYmd, generatedAt, JSON.stringify(validated));
  return getWeeklyRecap(db, args.isoWeek)!;
}

export function getWeeklyRecap(db: Db, isoWeek: string): WeeklyRecapRow | null {
  const row = db.prepare(
    `SELECT id, iso_week, week_start_ymd, generated_at, finalized_at, canonical_json
       FROM weekly_recap WHERE iso_week = ?`,
  ).get(isoWeek) as {
    id: number;
    iso_week: string;
    week_start_ymd: string;
    generated_at: string;
    finalized_at: string | null;
    canonical_json: string;
  } | undefined;
  if (!row) return null;
  return {
    id: row.id,
    isoWeek: row.iso_week,
    weekStartYmd: row.week_start_ymd,
    generatedAt: row.generated_at,
    finalizedAt: row.finalized_at,
    canonical: JSON.parse(row.canonical_json) as RecapCanonical,
  };
}

export interface ListRecapsOpts {
  limit?: number;
}

export function listWeeklyRecaps(db: Db, opts: ListRecapsOpts = {}): WeeklyRecapRow[] {
  const limit = Math.max(1, Math.min(200, Math.round(opts.limit ?? 26)));
  const rows = db.prepare(
    `SELECT id, iso_week, week_start_ymd, generated_at, finalized_at, canonical_json
       FROM weekly_recap
       ORDER BY week_start_ymd DESC LIMIT ?`,
  ).all(limit) as Array<{
    id: number; iso_week: string; week_start_ymd: string;
    generated_at: string; finalized_at: string | null; canonical_json: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    isoWeek: r.iso_week,
    weekStartYmd: r.week_start_ymd,
    generatedAt: r.generated_at,
    finalizedAt: r.finalized_at,
    canonical: JSON.parse(r.canonical_json) as RecapCanonical,
  }));
}

export interface SectionEditInput {
  sectionKey: RecapSectionKey;
  beforeText: string;
  afterText: string;
  category?: string | null;
}

export interface FinalizeRecapArgs {
  isoWeek: string;
  sectionEdits: SectionEditInput[];
  now?: Date;
}

/** Mark finalized_at and append per-section diff rows for Stream 3 learning. */
export function finalizeRecap(db: Db, args: FinalizeRecapArgs): { recapId: number; editsWritten: number } {
  const recap = getWeeklyRecap(db, args.isoWeek);
  if (!recap) throw new Error(`recap-not-found:${args.isoWeek}`);
  const now = (args.now ?? new Date()).toISOString();
  db.prepare(`UPDATE weekly_recap SET finalized_at = ? WHERE id = ?`).run(now, recap.id);
  const insert = db.prepare(
    `INSERT INTO weekly_recap_section_edit
       (recap_id, section_key, before_text, after_text, category, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  let editsWritten = 0;
  for (const e of args.sectionEdits) {
    if (e.beforeText === e.afterText) continue;
    insert.run(recap.id, e.sectionKey, e.beforeText, e.afterText, e.category ?? null, now);
    editsWritten++;
  }
  return { recapId: recap.id, editsWritten };
}

export function listSectionEdits(db: Db, recapId: number): Array<{
  id: number;
  sectionKey: string;
  beforeText: string;
  afterText: string;
  category: string | null;
  createdAt: string;
}> {
  const rows = db.prepare(
    `SELECT id, section_key, before_text, after_text, category, created_at
       FROM weekly_recap_section_edit WHERE recap_id = ? ORDER BY id ASC`,
  ).all(recapId) as Array<{
    id: number; section_key: string; before_text: string; after_text: string;
    category: string | null; created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    sectionKey: r.section_key,
    beforeText: r.before_text,
    afterText: r.after_text,
    category: r.category,
    createdAt: r.created_at,
  }));
}
