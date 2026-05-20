/**
 * Plan 08-01 Task 2 — 14-day-per-corpus gate.
 *
 * `checkInsightGate(db, { now, kind? })` returns `{ unlocked, blockedKinds, daysRemaining }`.
 *
 * Per-kind corpus map (research §Pattern 3):
 *   calendar_load     → MIN(start_at_utc OR start_date) FROM calendar_event must be ≤ now-14d
 *   response_time     → MIN(received_at) FROM gmail_message must be ≤ now-14d
 *   recurring_themes  → (gmail OR meeting_note has 14d data) AND
 *                       (SELECT COUNT(*) FROM rag_chunk WHERE source_kind IN ('email','note')
 *                          AND deleted_at IS NULL) >= 50
 *   approval_edits    → MIN(created_at) FROM approval must be ≤ now-14d
 *
 * Pure SQL — no LLM calls. Per research Open Question #6 the gate is enforced at
 * BOTH query-time (briefing read path) and write-time (aggregate orchestrator).
 *
 * Robust against schema absence (older test DBs): every probe is wrapped in
 * try/catch and treated as "no data available" → blocked.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import { INSIGHT_KINDS, type InsightKind } from './schema';

type Db = Database.Database;

export interface InsightGateResult {
  unlocked: boolean;
  blockedKinds: InsightKind[];
  /** Worst-case days remaining across all blocked kinds (0 when unlocked). */
  daysRemaining: number;
}

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
/** Research §Pattern 3 / Assumption A2 — k-means stability threshold. */
export const RECURRING_THEMES_MIN_CHUNKS = 50;

interface MinTsRow {
  min_ts: string | null;
}

function safeGet<T = MinTsRow>(db: Db, sql: string, ...params: unknown[]): T | undefined {
  try {
    return db.prepare(sql).get(...(params as never[])) as T | undefined;
  } catch {
    return undefined;
  }
}

/** Days between `from` and `to` (positive if `to` is later). */
function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Returns days-remaining-until-14d-window-met for a given oldest-row ISO.
 * - null oldest → 14 days remaining (no data at all)
 * - oldest ≤ now-14d → 0 days remaining (corpus is ready)
 */
function daysRemainingFor(oldestIso: string | null | undefined, now: Date): number {
  if (!oldestIso) return 14;
  const oldest = new Date(oldestIso);
  if (Number.isNaN(oldest.getTime())) return 14;
  const ageMs = now.getTime() - oldest.getTime();
  if (ageMs >= FOURTEEN_DAYS_MS) return 0;
  return Math.max(0, 14 - daysBetween(oldest, now));
}

interface KindProbe {
  /** Days remaining until the 14d window is reached for this corpus. */
  daysRemaining: number;
  /** Extra failure condition (e.g. <50 chunks for recurring_themes). */
  hardBlocked?: boolean;
}

function probeCalendarLoad(db: Db, now: Date): KindProbe {
  const row = safeGet<MinTsRow>(
    db,
    `SELECT MIN(COALESCE(start_at_utc, start_date)) AS min_ts FROM calendar_event`,
  );
  return { daysRemaining: daysRemainingFor(row?.min_ts ?? null, now) };
}

function probeResponseTime(db: Db, now: Date): KindProbe {
  const row = safeGet<MinTsRow>(
    db,
    `SELECT MIN(received_at) AS min_ts FROM gmail_message`,
  );
  return { daysRemaining: daysRemainingFor(row?.min_ts ?? null, now) };
}

function probeRecurringThemes(db: Db, now: Date): KindProbe {
  const gmail = safeGet<MinTsRow>(
    db,
    `SELECT MIN(received_at) AS min_ts FROM gmail_message`,
  );
  const notes = safeGet<MinTsRow>(
    db,
    `SELECT MIN(ingested_at) AS min_ts FROM meeting_note`,
  );
  // unlocked-corpus condition: gmail OR meeting_note has 14d.
  const gmailDr = daysRemainingFor(gmail?.min_ts ?? null, now);
  const notesDr = daysRemainingFor(notes?.min_ts ?? null, now);
  const corpusDr = Math.min(gmailDr, notesDr);

  // chunk-count condition: ≥50 alive email/note chunks.
  const chunkCount = safeGet<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM rag_chunk
        WHERE source_kind IN ('email','note')
          AND deleted_at IS NULL`,
  );
  const hasEnoughChunks = (chunkCount?.n ?? 0) >= RECURRING_THEMES_MIN_CHUNKS;

  return {
    daysRemaining: corpusDr,
    hardBlocked: !hasEnoughChunks,
  };
}

function probeApprovalEdits(db: Db, now: Date): KindProbe {
  const row = safeGet<MinTsRow>(
    db,
    `SELECT MIN(created_at) AS min_ts FROM approval`,
  );
  return { daysRemaining: daysRemainingFor(row?.min_ts ?? null, now) };
}

const PROBE_BY_KIND: Record<InsightKind, (db: Db, now: Date) => KindProbe> = {
  calendar_load: probeCalendarLoad,
  response_time: probeResponseTime,
  recurring_themes: probeRecurringThemes,
  approval_edits: probeApprovalEdits,
};

export interface CheckInsightGateOptions {
  /** Override "now" — used by tests. Defaults to new Date(). */
  now?: Date;
  /** When set, only this kind is probed; other kinds report unlocked. */
  kind?: InsightKind;
}

export function checkInsightGate(
  db: Db,
  opts: CheckInsightGateOptions = {},
): InsightGateResult {
  const now = opts.now ?? new Date();
  const kindsToProbe: InsightKind[] = opts.kind ? [opts.kind] : [...INSIGHT_KINDS];

  const blockedKinds: InsightKind[] = [];
  let worstDaysRemaining = 0;

  for (const kind of kindsToProbe) {
    const probe = PROBE_BY_KIND[kind](db, now);
    const blocked = probe.daysRemaining > 0 || !!probe.hardBlocked;
    if (blocked) {
      blockedKinds.push(kind);
      worstDaysRemaining = Math.max(worstDaysRemaining, probe.daysRemaining);
    }
  }

  return {
    unlocked: blockedKinds.length === 0,
    blockedKinds,
    daysRemaining: worstDaysRemaining,
  };
}
