/**
 * Plan 08-03 Task 3 — briefing signal source (SAME-TRANSACTION).
 *
 * BRIEFING_FEEDBACK and BRIEFING_INSIGHT_DISMISS IPC handlers each open a
 * single db.transaction() that:
 *   - writes the source row (briefing_feedback), and
 *   - writes a learning_signals row,
 * in one shot. There is no external API in scope; the click IS the commit
 * boundary, so wrapping both in one txn closes the atomicity gap cleanly.
 *
 * W-4 backfill: on first boot of Wave 3, drainAppMetaDismissBacklog reads any
 * `app_meta` rows where `k LIKE 'briefing_dismiss_log:%'` (written by 08-01's
 * sessionStorage-then-app_meta bridge), replays each into briefing_feedback
 * AND a learning_signal, then DELETEs the app_meta rows. Idempotent — once
 * the rows are drained, subsequent boots are no-ops.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import { writeSignal } from '../signal-log';

type Db = Database.Database;

export type Thumb = -1 | 0 | 1;

export interface BriefingFeedbackArgs {
  briefingDate: string;
  sectionKey: string;
  thumb: Thumb;
  now?: Date;
}

export interface BriefingDismissArgs {
  briefingDate: string;
  /** Insight kind (e.g. 'calendar_load') or section key. */
  kind: string;
  now?: Date;
}

/**
 * Record per-section thumbs-up/down — same-txn with the briefing_feedback row.
 * Returns the briefing_feedback row id.
 */
export function recordBriefingFeedback(db: Db, args: BriefingFeedbackArgs): number {
  const createdAt = (args.now ?? new Date()).toISOString();
  let insertedId = 0;
  const txn = db.transaction(() => {
    const res = db
      .prepare(
        `INSERT INTO briefing_feedback (briefing_id, section_key, thumb, created_at) VALUES (?,?,?,?)`,
      )
      .run(args.briefingDate, args.sectionKey, args.thumb, createdAt);
    insertedId = Number(res.lastInsertRowid);
    writeSignal(db, {
      source: 'briefing',
      kind: 'briefing.feedback',
      payload: {
        briefingDate: args.briefingDate,
        sectionKey: args.sectionKey,
        thumb: args.thumb,
      },
      now: args.now,
    });
  });
  txn();
  return insertedId;
}

/**
 * Record an insight dismissal. The dismiss action does not have a dedicated
 * source row beyond the learning_signal itself in v1 (briefing_feedback
 * stores thumb-only state); we still wrap in a txn for symmetry and to
 * preserve forward compatibility if a `briefing_dismiss` table is added.
 */
export function recordBriefingDismiss(db: Db, args: BriefingDismissArgs): void {
  const txn = db.transaction(() => {
    writeSignal(db, {
      source: 'briefing',
      kind: 'briefing.dismiss',
      payload: {
        briefingDate: args.briefingDate,
        kind: args.kind,
      },
      now: args.now,
    });
  });
  txn();
}

/**
 * W-4 backfill — one-time drain of the 08-01 app_meta dismiss-log bridge.
 *
 * Reads every row where k LIKE 'briefing_dismiss_log:%', replays each into
 * briefing_feedback (with thumb=-1 to model a dismiss as a negative thumb)
 * AND a learning_signal, then DELETEs the source app_meta rows.
 *
 * The app_meta key shape (per 08-01 Task 8 M-1 fix) is
 *   `briefing_dismiss_log:<briefingDate>:<kind>:<rand-hex16>`
 * and the value is an ISO timestamp.
 *
 * Returns the number of rows drained. Idempotent — on subsequent boots
 * returns 0 because the source rows have been deleted.
 */
export function drainAppMetaDismissBacklog(db: Db): number {
  // Defensive: app_meta exists since migration 001, so this should always work,
  // but guard against test DBs that may have stripped it.
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='app_meta'`)
    .all();
  if (tables.length === 0) return 0;

  const rows = db
    .prepare(`SELECT k, v FROM app_meta WHERE k LIKE 'briefing_dismiss_log:%'`)
    .all() as Array<{ k: string; v: string }>;

  if (rows.length === 0) return 0;

  let drained = 0;
  const txn = db.transaction(() => {
    for (const row of rows) {
      // Parse 'briefing_dismiss_log:<date>:<kind>:<rand>' — split on ':' but
      // tolerate kinds that themselves contain hyphens.
      const parts = row.k.split(':');
      if (parts.length < 4) continue;
      const briefingDate = parts[1]!;
      // kind is parts[2..n-1] joined ':' in case future kinds embed colons;
      // for the 08-01 spec the kind segment is a single word.
      const kind = parts[2]!;
      const occurredAt = row.v && /^\d{4}-\d{2}-\d{2}T/.test(row.v) ? row.v : new Date().toISOString();
      db.prepare(
        `INSERT INTO briefing_feedback (briefing_id, section_key, thumb, created_at) VALUES (?,?,?,?)`,
      ).run(briefingDate, kind, -1, occurredAt);
      writeSignal(db, {
        source: 'briefing',
        kind: 'briefing.dismiss',
        payload: { briefingDate, kind, backfilled: true },
        now: new Date(occurredAt),
      });
      drained++;
    }
    db.prepare(`DELETE FROM app_meta WHERE k LIKE 'briefing_dismiss_log:%'`).run();
  });
  txn();
  return drained;
}
