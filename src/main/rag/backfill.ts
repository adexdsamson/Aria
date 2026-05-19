/**
 * Plan 07-02 Task 6 — Opt-in backfill (RESEARCH §3 / Pitfall 5).
 *
 * Seeds `rag_source_dirty` from canonical Phase 2/5/6 tables in throttled
 * batches. Resumable: state persisted in `app_meta(key='rag_backfill_state')` ∈
 * `pending | in_progress | done | skipped`. ETA seeded by a 50-chunk probe
 * stored in `app_meta(key='rag_backfill_eta_seconds_per_chunk')`.
 *
 * NEVER auto-saturates Ollama on first launch — only runs when the user
 * confirms via `ragBackfillStart()` IPC.
 *
 * Source-table list (mirrors the harvester reality from 07-01):
 *   - email:  gmail_message
 *   - event:  calendar_event
 *   - note:   meeting_note
 *   - action: meeting_action + todoist_task (when present)
 *
 * app_meta is a small key/value table. We CREATE IT IF MISSING here because
 * not every migration may have wired it; treat as a forward-compat shim.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type { Logger } from 'pino';
import type { SourceKind } from './chunk-types';

type Db = Database.Database;

export type BackfillState = 'pending' | 'in_progress' | 'done' | 'skipped';

export interface SeedResult {
  enqueuedBySourceKind: Record<SourceKind, number>;
}

export interface BackfillStatus {
  state: BackfillState;
  enqueuedBySourceKind: Record<SourceKind, number>;
  dirtyRemaining: number;
  etaSecondsRemaining: number;
}

const SOURCE_TABLES: Array<{ kind: SourceKind; table: string; idCol: string }> = [
  { kind: 'email', table: 'gmail_message', idCol: 'id' },
  { kind: 'event', table: 'calendar_event', idCol: 'id' },
  { kind: 'note', table: 'meeting_note', idCol: 'id' },
  { kind: 'action', table: 'meeting_action', idCol: 'id' },
];

function ensureAppMeta(db: Db): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS app_meta (
       key   TEXT PRIMARY KEY,
       value TEXT
     )`,
  );
}

export function readBackfillState(db: Db): BackfillState {
  ensureAppMeta(db);
  const row = db
    .prepare(`SELECT value FROM app_meta WHERE key = 'rag_backfill_state'`)
    .get() as { value: string } | undefined;
  return (row?.value as BackfillState) ?? 'pending';
}

function writeMeta(db: Db, key: string, value: string): void {
  ensureAppMeta(db);
  db.prepare(
    `INSERT INTO app_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export function setBackfillState(db: Db, state: BackfillState): void {
  writeMeta(db, 'rag_backfill_state', state);
}

function tableExists(db: Db, name: string): boolean {
  return (
    (db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(name) as { name: string } | undefined) != null
  );
}

export interface SeedOptions {
  batchSize?: number;
  /** Optional throttle between batches (ms). Default 0 (immediate). */
  throttleMs?: number;
}

export function seedBackfill(db: Db, opts: SeedOptions = {}): SeedResult {
  ensureAppMeta(db);
  const batchSize = Math.max(1, opts.batchSize ?? 500);
  const now = new Date().toISOString();
  setBackfillState(db, 'in_progress');

  const enqueued: Record<SourceKind, number> = {
    email: 0,
    event: 0,
    note: 0,
    action: 0,
  };

  const ins = db.prepare(
    `INSERT OR IGNORE INTO rag_source_dirty (source_kind, source_id, target_model_id, enqueued_at)
     VALUES (?, ?, NULL, ?)`,
  );

  for (const t of SOURCE_TABLES) {
    if (!tableExists(db, t.table)) continue;
    let offset = 0;
    while (true) {
      const rows = db
        .prepare(`SELECT ${t.idCol} AS id FROM ${t.table} ORDER BY ${t.idCol} ASC LIMIT ? OFFSET ?`)
        .all(batchSize, offset) as Array<{ id: string }>;
      if (rows.length === 0) break;
      const txn = db.transaction(() => {
        for (const r of rows) {
          // Skip rows already chunked (resumable on relaunch).
          const exists = db
            .prepare(`SELECT 1 FROM rag_chunk WHERE source_kind = ? AND source_id = ? LIMIT 1`)
            .get(t.kind, r.id);
          if (!exists) {
            ins.run(t.kind, r.id, now);
            enqueued[t.kind]++;
          }
        }
      });
      txn();
      offset += rows.length;
      if (rows.length < batchSize) break;
    }
  }

  // Handle optional todoist_task as a sub-source under 'action' (07-01 harvester pattern).
  if (tableExists(db, 'todoist_task')) {
    let offset = 0;
    while (true) {
      const rows = db
        .prepare(`SELECT id FROM todoist_task ORDER BY id ASC LIMIT ? OFFSET ?`)
        .all(batchSize, offset) as Array<{ id: string }>;
      if (rows.length === 0) break;
      const txn = db.transaction(() => {
        for (const r of rows) {
          const sid = `todoist:${r.id}`;
          const exists = db
            .prepare(`SELECT 1 FROM rag_chunk WHERE source_kind = 'action' AND source_id = ? LIMIT 1`)
            .get(sid);
          if (!exists) {
            ins.run('action', sid, now);
            enqueued.action++;
          }
        }
      });
      txn();
      offset += rows.length;
      if (rows.length < batchSize) break;
    }
  }

  return { enqueuedBySourceKind: enqueued };
}

export function recordEtaProbe(db: Db, secondsPerChunk: number): void {
  writeMeta(db, 'rag_backfill_eta_seconds_per_chunk', String(secondsPerChunk));
}

export function getStatus(db: Db): BackfillStatus {
  ensureAppMeta(db);
  const state = readBackfillState(db);
  const counts: Record<SourceKind, number> = { email: 0, event: 0, note: 0, action: 0 };
  const rows = db
    .prepare(
      `SELECT source_kind, count(*) AS n FROM rag_source_dirty WHERE target_model_id IS NULL GROUP BY source_kind`,
    )
    .all() as Array<{ source_kind: SourceKind; n: number }>;
  for (const r of rows) counts[r.source_kind] = r.n;

  const dirtyRemaining = (db
    .prepare(`SELECT count(*) AS n FROM rag_chunk WHERE dirty = 1`)
    .get() as { n: number }).n;

  const etaRow = db
    .prepare(`SELECT value FROM app_meta WHERE key = 'rag_backfill_eta_seconds_per_chunk'`)
    .get() as { value: string } | undefined;
  const etaPer = etaRow ? Number(etaRow.value) || 0 : 0;
  const queuedRemaining = (db
    .prepare(`SELECT count(*) AS n FROM rag_source_dirty WHERE target_model_id IS NULL`)
    .get() as { n: number }).n;

  return {
    state,
    enqueuedBySourceKind: counts,
    dirtyRemaining,
    etaSecondsRemaining: Math.round(etaPer * (queuedRemaining + dirtyRemaining)),
  };
}

export interface BackfillIpcDeps {
  db: Db;
  logger: Logger;
}

export function skipBackfill(db: Db): void {
  setBackfillState(db, 'skipped');
}
