/**
 * routing_log persistence helpers (Plan 04 Task 1).
 *
 * Schema (Plan 02 Task 2 migration 001_init.sql):
 *   id          INTEGER PK AUTOINCREMENT
 *   ts          TEXT     ISO-8601 timestamp
 *   route       TEXT     'LOCAL' | 'FRONTIER'
 *   reason      TEXT     verbatim reason string
 *   source      TEXT     SourceTag
 *   prompt_hash TEXT     SHA-256 hex
 *   model       TEXT     model id used
 *   latency_ms  INTEGER  end-to-end LLM latency
 *   ok          INTEGER  0 | 1
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
}

export function hashPrompt(prompt: string): string {
  return crypto.createHash('sha256').update(prompt, 'utf8').digest('hex');
}

const INSERT_SQL = `INSERT INTO routing_log
  (ts, route, reason, source, prompt_hash, model, latency_ms, ok)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

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
  );
}

const SELECT_SQL = `SELECT id, ts, route, reason, source, prompt_hash, model, latency_ms, ok
  FROM routing_log
  ORDER BY id DESC
  LIMIT ?`;

export function readRecentRoutingLog(db: Db, limit = 100): RoutingLogEntry[] {
  const safeLimit = Math.max(1, Math.min(1000, Math.round(limit)));
  const rows = db.prepare(SELECT_SQL).all(safeLimit) as RoutingLogEntry[];
  return rows;
}
