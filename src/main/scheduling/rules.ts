/**
 * Plan 04-02 Task 1 — scheduling rules CRUD against the migration-010
 * `scheduling_rules` singleton (id=1).
 *
 * - `getRules(db)` parses `rules_json`, overlays the canonical `time_zone`
 *   column onto `.timeZone`, and returns DEFAULT_RULES (with timeZone
 *   overridden from the row) when the row is the default `'[]'` seed.
 * - `setRules(db, rules)` validates via RulesSchema, persists rules_json +
 *   time_zone in a single UPDATE, and bumps updated_at.
 * - `loadActiveRules(db)` is an alias for `getRules` so the conflict
 *   detector reads via a stable name.
 *
 * Boundary: validation happens HERE (authoritative). IPC re-runs safeParse
 * for issue surfacing but `setRules` re-validates regardless.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import {
  RulesSchema,
  DEFAULT_RULES,
  type Rules,
} from '../../shared/scheduling-rules';

type Db = Database.Database;

interface SchedulingRulesRow {
  rules_json: string;
  time_zone: string;
  updated_at: string;
}

export function getRules(db: Db): Rules {
  const row = db
    .prepare<[], SchedulingRulesRow>(
      `SELECT rules_json, time_zone, updated_at FROM scheduling_rules WHERE id = 1`,
    )
    .get();
  if (!row) {
    // Singleton seed missing (shouldn't happen post-migration-010). Fall
    // back to defaults rather than throwing — caller can't recover anyway.
    return { ...DEFAULT_RULES };
  }
  // Migration 010 seeds rules_json='[]' as a sentinel; treat any
  // non-object payload as "no user rules yet" and return defaults overlaid
  // with the canonical time_zone column value.
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.rules_json);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...DEFAULT_RULES, timeZone: row.time_zone || DEFAULT_RULES.timeZone };
  }
  // Some persisted payloads may predate the timeZone field; overlay the
  // row's time_zone column as authoritative.
  const merged = { ...(parsed as Record<string, unknown>), timeZone: row.time_zone };
  const result = RulesSchema.safeParse(merged);
  if (!result.success) {
    // Corrupt persisted JSON. Surface as defaults rather than crashing the
    // renderer; setRules is the only place that should ever write malformed
    // data and it re-validates.
    return { ...DEFAULT_RULES, timeZone: row.time_zone || DEFAULT_RULES.timeZone };
  }
  return result.data;
}

export function setRules(db: Db, rules: Rules): void {
  const validated = RulesSchema.parse(rules); // throws ZodError on bad input
  const json = JSON.stringify(validated);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE scheduling_rules
        SET rules_json = ?, time_zone = ?, updated_at = ?
      WHERE id = 1`,
  ).run(json, validated.timeZone, now);
}

export function loadActiveRules(db: Db): Rules {
  return getRules(db);
}

export function getUpdatedAt(db: Db): string | null {
  const row = db
    .prepare<[], { updated_at: string }>(
      `SELECT updated_at FROM scheduling_rules WHERE id = 1`,
    )
    .get();
  return row?.updated_at ?? null;
}
