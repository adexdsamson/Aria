/**
 * Plan 08-04 Task 4 — row-count comparator for the pre-migration backup
 * wrapper.
 *
 * Compares before/after counts for the CRITICAL_TABLES list. A table that
 * lost rows during the applied migrations triggers a drift entry UNLESS
 * the migration's version is whitelisted in `expectedDrops` with that
 * specific table name.
 *
 * H-3 round 2: the expectedDrops map argument is the ONLY supported
 * declaration mechanism. No SQL-comment-parsing fallback.
 */

/** Tables whose row count must never silently regress across a migration. */
export const CRITICAL_TABLES: readonly string[] = Object.freeze([
  'gmail_message',
  'calendar_event',
  'meeting_note',
  'meeting_action',
  'approval',
  'send_log',
  'calendar_action_log',
  'rag_chunk',
]);

export interface RowCountDrift {
  table: string;
  before: number;
  after: number;
}

/**
 * Returns the list of tables whose count fell without being whitelisted.
 * Empty array means clean. The caller (runMigrationsWithBackup) wraps a
 * non-empty result as a `RowCountDriftError`.
 */
export function verifyRowCounts(
  before: Record<string, number>,
  after: Record<string, number>,
  appliedVersions: number[],
  expectedDrops: Record<number, string[]>,
): RowCountDrift[] {
  // Union all expectedDrops entries that match one of the applied versions.
  const whitelist = new Set<string>();
  for (const v of appliedVersions) {
    const tables = expectedDrops[v];
    if (tables) {
      for (const t of tables) whitelist.add(t);
    }
  }

  const drift: RowCountDrift[] = [];
  for (const table of CRITICAL_TABLES) {
    const b = before[table] ?? 0;
    const a = after[table] ?? 0;
    if (a < b && !whitelist.has(table)) {
      drift.push({ table, before: b, after: a });
    }
  }
  return drift;
}
