/**
 * Plan 08-03 Task 2 — append-only learning signal writer + 90d retention.
 *
 * This is the SOLE chokepoint for writing to the learning_signals table. All
 * four signal sources (approval, briefing, recap, qa) call writeSignal().
 *
 * Privacy invariants (LEARN-02):
 *  - redactAllPii is applied to every string in payload at write time (research
 *    Anti-Patterns: defense-in-depth — sources MAY pre-redact but writer MUST
 *    always re-redact).
 *  - This module imports NO network/HTTP modules. Enforced at lint time by
 *    `scripts/grep-no-network-from-signals.mjs`.
 *  - Sentry: this module never imports @sentry/*; the Sentry beforeSend hook
 *    in `src/main/sentry/beforeSend.ts` filters any event whose tags include
 *    `scope:'learning'` or whose message references `learning_signals`.
 *
 * Retention (Pitfall 8): purgeOldSignals(db, { keepDays }) deletes rows whose
 * occurred_at is older than the cutoff. Default in callers is 90 days. The
 * nightly cron in schedule.ts gates the invocation on the persisted
 * `learning_signals_keep_forever` setting (Phase 1 `settings` table).
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import { redactAllPii } from '../briefing/redact';

type Db = Database.Database;

export type SignalSource = 'approval' | 'briefing' | 'recap' | 'qa';

export interface LearningSignal {
  id: number;
  source: SignalSource;
  kind: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface WriteSignalArgs {
  source: SignalSource;
  kind: string;
  payload?: Record<string, unknown>;
  /** Override timestamp (tests). */
  now?: Date;
}

/**
 * Recursively walk `payload` and redact every string with `redactAllPii`. Keys
 * are NOT redacted (they are schema, not user content). Numbers, booleans,
 * nulls, and arrays pass through unchanged (arrays recurse into elements).
 */
function redactPayload(p: unknown): unknown {
  if (typeof p === 'string') return redactAllPii(p);
  if (Array.isArray(p)) return p.map(redactPayload);
  if (p && typeof p === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      out[k] = redactPayload(v);
    }
    return out;
  }
  return p;
}

/**
 * Append a single signal row. Redacts payload string fields with redactAllPii
 * BEFORE INSERT (defense-in-depth — sources MAY pre-redact, but the chokepoint
 * is the final authority).
 */
export function writeSignal(db: Db, args: WriteSignalArgs): number {
  const occurredAt = (args.now ?? new Date()).toISOString();
  const safe = redactPayload(args.payload ?? {});
  const res = db
    .prepare(
      `INSERT INTO learning_signals (source, kind, payload_json, occurred_at) VALUES (?,?,?,?)`,
    )
    .run(args.source, args.kind, JSON.stringify(safe), occurredAt);
  return Number(res.lastInsertRowid);
}

export interface ListSignalsArgs {
  limit?: number;
  offset?: number;
  source?: SignalSource;
  fromIso?: string;
  toIso?: string;
}

export function listSignals(db: Db, args: ListSignalsArgs = {}): LearningSignal[] {
  const limit = Math.max(1, Math.min(args.limit ?? 50, 500));
  const offset = Math.max(0, args.offset ?? 0);
  const params: Array<string | number> = [];
  const where: string[] = [];
  if (args.source) {
    where.push('source = ?');
    params.push(args.source);
  }
  if (args.fromIso) {
    where.push('occurred_at >= ?');
    params.push(args.fromIso);
  }
  if (args.toIso) {
    where.push('occurred_at <= ?');
    params.push(args.toIso);
  }
  const sql = `SELECT id, source, kind, payload_json, occurred_at FROM learning_signals
               ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY occurred_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  const rows = db.prepare(sql).all(...params) as Array<{
    id: number;
    source: SignalSource;
    kind: string;
    payload_json: string;
    occurred_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    kind: r.kind,
    payload: safeParse(r.payload_json),
    occurredAt: r.occurred_at,
  }));
}

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export interface PurgeArgs {
  keepDays: number;
  now?: Date;
}

/**
 * Delete signals whose occurred_at is older than (now - keepDays). Returns the
 * number of rows removed. The cron callback in `schedule.ts` is responsible
 * for gating this on the user's `learning_signals_keep_forever` preference —
 * this function unconditionally purges when called.
 */
export function purgeOldSignals(db: Db, args: PurgeArgs): number {
  const now = args.now ?? new Date();
  const cutoff = new Date(now.getTime() - args.keepDays * 86_400_000).toISOString();
  const res = db
    .prepare(`DELETE FROM learning_signals WHERE occurred_at < ?`)
    .run(cutoff);
  return Number(res.changes);
}
