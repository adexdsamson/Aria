/**
 * Plan 04-01 — calendar_action_log append-only writer.
 *
 * Single chokepoint for inserting rows into the migration-010 audit table.
 * Used by write-event.ts (the APPR-02 chokepoint) on pre_write, post_write,
 * failed, and override paths so we always have a forensic trail covering
 * both success and failure (T-04-01-03 mitigation).
 */
import type Database from 'better-sqlite3-multiple-ciphers';

type Db = Database.Database;

export type CalendarActionPhase =
  | 'proposed'
  | 'pre_write'
  | 'post_write'
  | 'failed'
  | 'override';

export interface LogCalendarActionRow {
  approval_id: string;
  phase: CalendarActionPhase;
  event_id?: string | null;
  recurring_scope?: string | null;
  before_json?: string | null;
  after_json?: string | null;
  rule_overrides_json?: string | null;
  google_etag?: string | null;
  google_error?: string | null;
}

const INSERT_SQL = `INSERT INTO calendar_action_log (
  approval_id, phase, event_id, recurring_scope,
  before_json, after_json, rule_overrides_json,
  google_etag, google_error, created_at
) VALUES (
  @approval_id, @phase, @event_id, @recurring_scope,
  @before_json, @after_json, @rule_overrides_json,
  @google_etag, @google_error, @created_at
)`;

export function logCalendarAction(db: Db, row: LogCalendarActionRow): number {
  const stmt = db.prepare(INSERT_SQL);
  const res = stmt.run({
    approval_id: row.approval_id,
    phase: row.phase,
    event_id: row.event_id ?? null,
    recurring_scope: row.recurring_scope ?? null,
    before_json: row.before_json ?? null,
    after_json: row.after_json ?? null,
    rule_overrides_json: row.rule_overrides_json ?? null,
    google_etag: row.google_etag ?? null,
    google_error: row.google_error ?? null,
    created_at: new Date().toISOString(),
  });
  return Number(res.lastInsertRowid);
}
