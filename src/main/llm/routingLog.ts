/**
 * routing_log persistence helpers (Plan 04 Task 1, extended in Plan 03-02).
 *
 * Schema:
 *   Plan 02 Task 2 — migration 001_init.sql:
 *     id          INTEGER PK AUTOINCREMENT
 *     ts          TEXT     ISO-8601 timestamp
 *     route       TEXT     'LOCAL' | 'FRONTIER'
 *     reason      TEXT     verbatim reason string
 *     source      TEXT     SourceTag
 *     prompt_hash TEXT     SHA-256 hex
 *     model       TEXT     model id used
 *     latency_ms  INTEGER  end-to-end LLM latency
 *     ok          INTEGER  0 | 1
 *
 *   Plan 03-02 — migration 007_sensitivity_router.sql:
 *     categories_json       TEXT    JSON-stringified categories array
 *     severity              TEXT    'low'|'med'|'high' | NULL
 *     classifier_rationale  TEXT    LLM-summarized reason | NULL
 *     classifier_version    TEXT    e.g. 'v1-llama3.1-8b-q4-2026-05'
 *
 * NEVER write the raw prompt. `hashPrompt` returns SHA-256 hex; that's what
 * goes into the table.
 */
import * as crypto from 'node:crypto';
import type { Db } from '../db/connect';
import type { Route, RoutingLogEntry, SourceTag } from '../../shared/ipc-contract';

export interface RoutingLogInput {
  ts: string;
  route: Route;
  reason: string;
  source: SourceTag | string;
  prompt_hash: string;
  model: string;
  latency_ms: number;
  ok: 0 | 1;
  // Plan 03-02 classifier fields. All optional — Phase 1/2 callers omit.
  categories_json?: string | null;
  severity?: 'low' | 'med' | 'high' | null;
  classifier_rationale?: string | null;
  classifier_version?: string | null;
}

export interface RoutingLogQuery {
  from?: string; // ISO timestamp, inclusive
  to?: string;
  route?: Route;
  source?: string;
  /** Match when categories_json contains this category (LIKE substring). */
  category?: string;
  limit?: number;
}

export interface RoutingLogRow extends RoutingLogEntry {
  categories_json: string | null;
  severity: 'low' | 'med' | 'high' | null;
  classifier_rationale: string | null;
  classifier_version: string | null;
}

export function hashPrompt(prompt: string): string {
  return crypto.createHash('sha256').update(prompt, 'utf8').digest('hex');
}

const INSERT_SQL = `INSERT INTO routing_log
  (ts, route, reason, source, prompt_hash, model, latency_ms, ok,
   categories_json, severity, classifier_rationale, classifier_version)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export function writeRoutingLog(db: Db, e: RoutingLogInput): void {
  db.prepare(INSERT_SQL).run(
    e.ts,
    e.route,
    e.reason,
    e.source,
    e.prompt_hash,
    e.model,
    Math.max(0, Math.round(e.latency_ms)),
    e.ok,
    e.categories_json ?? null,
    e.severity ?? null,
    e.classifier_rationale ?? null,
    e.classifier_version ?? null,
  );
}

const SELECT_RECENT_SQL = `SELECT id, ts, route, reason, source, prompt_hash, model, latency_ms, ok,
    categories_json, severity, classifier_rationale, classifier_version
  FROM routing_log
  ORDER BY id DESC
  LIMIT ?`;

export function readRecentRoutingLog(db: Db, limit = 100): RoutingLogRow[] {
  const safeLimit = Math.max(1, Math.min(1000, Math.round(limit)));
  const rows = db.prepare(SELECT_RECENT_SQL).all(safeLimit) as RoutingLogRow[];
  return rows;
}

export function queryRoutingLog(db: Db, q: RoutingLogQuery = {}): RoutingLogRow[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (q.from) {
    clauses.push('ts >= ?');
    params.push(q.from);
  }
  if (q.to) {
    clauses.push('ts <= ?');
    params.push(q.to);
  }
  if (q.route) {
    clauses.push('route = ?');
    params.push(q.route);
  }
  if (q.source) {
    clauses.push('source = ?');
    params.push(q.source);
  }
  if (q.category) {
    clauses.push('categories_json LIKE ?');
    params.push(`%"${q.category}"%`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const safeLimit = Math.max(
    1,
    Math.min(1000, Math.round(typeof q.limit === 'number' ? q.limit : 200)),
  );
  const sql = `SELECT id, ts, route, reason, source, prompt_hash, model, latency_ms, ok,
      categories_json, severity, classifier_rationale, classifier_version
    FROM routing_log ${where}
    ORDER BY id DESC
    LIMIT ?`;
  params.push(safeLimit);
  return db.prepare(sql).all(...params) as RoutingLogRow[];
}
