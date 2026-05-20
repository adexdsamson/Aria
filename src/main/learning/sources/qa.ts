/**
 * Plan 08-03 Task 3 — Q&A signal source (SAME-TRANSACTION).
 *
 * Wraps `UPDATE rag_turn SET thumb=?` and a learning_signal INSERT in one
 * db.transaction(). No external API in scope; the click IS the commit
 * boundary.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import { writeSignal } from '../signal-log';

type Db = Database.Database;

export interface AppendTurnFeedbackArgs {
  turnId: string;
  thumb: -1 | 0 | 1;
  /** Routing metadata snapshot from the original turn (no PII). */
  route?: string | null;
  sensitivity?: string | null;
  now?: Date;
}

export function appendTurnFeedback(db: Db, args: AppendTurnFeedbackArgs): { ok: boolean } {
  let ok = true;
  const txn = db.transaction(() => {
    const res = db.prepare(`UPDATE rag_turn SET thumb = ? WHERE id = ?`).run(args.thumb, args.turnId);
    if (Number(res.changes) === 0) {
      ok = false;
      return;
    }
    writeSignal(db, {
      source: 'qa',
      kind: 'qa.thumb',
      payload: {
        turnId: args.turnId,
        thumb: args.thumb,
        route: args.route ?? null,
        sensitivity: args.sensitivity ?? null,
      },
      now: args.now,
    });
  });
  txn();
  return { ok };
}
