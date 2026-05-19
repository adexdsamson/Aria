/**
 * Plan 07-03 Task 4 — RAG threads + turn persistence (CONTEXT, RESEARCH §5).
 *
 * Schema (migration 126):
 *   rag_thread(id PK, title, created_at, updated_at, archived)
 *   rag_turn(id PK, thread_id FK, ord, role, text, citations_json,
 *            routing_json, embedding_model_id, retrieval_strategy,
 *            total_cost_usd, created_at)
 *
 * Public surface:
 *   createThread({ seedTurns? })            — REVIEWS C9 Cmd-K Expand handoff
 *   appendTurn(threadId, role, text, ...)
 *   getThread(id, { lastN })
 *   listThreads({ limit, search? })
 *   deleteThread(id)
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import * as crypto from 'node:crypto';

type Db = Database.Database;

export interface ThreadRow {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

export interface TurnRow {
  id: string;
  threadId: string;
  ord: number;
  role: 'user' | 'assistant';
  text: string;
  citationsJson: string | null;
  routingJson: string | null;
  embeddingModelId: string | null;
  retrievalStrategy: string | null;
  totalCostUsd: number;
  createdAt: string;
}

export interface SeedTurn {
  role: 'user' | 'assistant';
  text: string;
  citations?: unknown;
  routing?: unknown;
}

export interface CreateThreadArgs {
  seedTurns?: SeedTurn[];
  title?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function genId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function rowToThread(r: {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  archived: number;
}): ThreadRow {
  return {
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    archived: r.archived === 1,
  };
}

function rowToTurn(r: {
  id: string;
  thread_id: string;
  ord: number;
  role: string;
  text: string;
  citations_json: string | null;
  routing_json: string | null;
  embedding_model_id: string | null;
  retrieval_strategy: string | null;
  total_cost_usd: number;
  created_at: string;
}): TurnRow {
  return {
    id: r.id,
    threadId: r.thread_id,
    ord: r.ord,
    role: r.role as 'user' | 'assistant',
    text: r.text,
    citationsJson: r.citations_json,
    routingJson: r.routing_json,
    embeddingModelId: r.embedding_model_id,
    retrievalStrategy: r.retrieval_strategy,
    totalCostUsd: r.total_cost_usd,
    createdAt: r.created_at,
  };
}

export function createThread(db: Db, args: CreateThreadArgs = {}): ThreadRow {
  const id = genId('thr');
  const now = nowIso();
  const seed = args.seedTurns ?? [];
  // C9: if seed includes a user turn, derive title from it; else "(untitled)".
  let title = args.title ?? '(untitled)';
  if (!args.title) {
    const firstUser = seed.find((t) => t.role === 'user');
    if (firstUser) title = firstUser.text.slice(0, 60);
  }
  const txn = db.transaction(() => {
    db.prepare(
      `INSERT INTO rag_thread(id, title, created_at, updated_at, archived) VALUES (?, ?, ?, ?, 0)`,
    ).run(id, title, now, now);
    seed.forEach((t, i) => {
      db.prepare(
        `INSERT INTO rag_turn(id, thread_id, ord, role, text, citations_json, routing_json,
                              embedding_model_id, retrieval_strategy, total_cost_usd, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?)`,
      ).run(
        genId('trn'),
        id,
        i,
        t.role,
        t.text,
        t.citations !== undefined ? JSON.stringify(t.citations) : null,
        t.routing !== undefined ? JSON.stringify(t.routing) : null,
        now,
      );
    });
  });
  txn();
  return {
    id,
    title,
    createdAt: now,
    updatedAt: now,
    archived: false,
  };
}

export interface AppendTurnArgs {
  threadId: string;
  role: 'user' | 'assistant';
  text: string;
  citations?: unknown;
  routing?: unknown;
  embeddingModelId?: string | null;
  retrievalStrategy?: string | null;
  totalCostUsd?: number;
}

export function appendTurn(db: Db, args: AppendTurnArgs): TurnRow {
  const now = nowIso();
  const id = genId('trn');
  const ord = (db
    .prepare(`SELECT COALESCE(MAX(ord), -1) AS m FROM rag_turn WHERE thread_id = ?`)
    .get(args.threadId) as { m: number }).m + 1;
  const txn = db.transaction(() => {
    db.prepare(
      `INSERT INTO rag_turn(id, thread_id, ord, role, text, citations_json, routing_json,
                            embedding_model_id, retrieval_strategy, total_cost_usd, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      args.threadId,
      ord,
      args.role,
      args.text,
      args.citations !== undefined ? JSON.stringify(args.citations) : null,
      args.routing !== undefined ? JSON.stringify(args.routing) : null,
      args.embeddingModelId ?? null,
      args.retrievalStrategy ?? null,
      args.totalCostUsd ?? 0,
      now,
    );
    db.prepare(`UPDATE rag_thread SET updated_at = ? WHERE id = ?`).run(now, args.threadId);
    // Auto-rename the thread on first assistant response if title is still '(untitled)'.
    if (args.role === 'assistant') {
      const t = db
        .prepare(`SELECT title FROM rag_thread WHERE id = ?`)
        .get(args.threadId) as { title: string } | undefined;
      if (t && t.title === '(untitled)') {
        const firstUser = db
          .prepare(
            `SELECT text FROM rag_turn WHERE thread_id = ? AND role = 'user' ORDER BY ord ASC LIMIT 1`,
          )
          .get(args.threadId) as { text: string } | undefined;
        if (firstUser) {
          db.prepare(`UPDATE rag_thread SET title = ? WHERE id = ?`).run(
            firstUser.text.slice(0, 60),
            args.threadId,
          );
        }
      }
    }
  });
  txn();
  return {
    id,
    threadId: args.threadId,
    ord,
    role: args.role,
    text: args.text,
    citationsJson: args.citations !== undefined ? JSON.stringify(args.citations) : null,
    routingJson: args.routing !== undefined ? JSON.stringify(args.routing) : null,
    embeddingModelId: args.embeddingModelId ?? null,
    retrievalStrategy: args.retrievalStrategy ?? null,
    totalCostUsd: args.totalCostUsd ?? 0,
    createdAt: now,
  };
}

export interface GetThreadResult {
  thread: ThreadRow;
  turns: TurnRow[];
}

export function getThread(
  db: Db,
  threadId: string,
  opts: { lastN?: number } = {},
): GetThreadResult | null {
  const row = db
    .prepare(`SELECT id, title, created_at, updated_at, archived FROM rag_thread WHERE id = ?`)
    .get(threadId) as
    | { id: string; title: string; created_at: string; updated_at: string; archived: number }
    | undefined;
  if (!row) return null;
  const limit = opts.lastN ?? 6;
  // Read the last N turns by ord DESC, then reverse so callers see chronological order.
  const turnRows = db
    .prepare(
      `SELECT id, thread_id, ord, role, text, citations_json, routing_json,
              embedding_model_id, retrieval_strategy, total_cost_usd, created_at
         FROM rag_turn WHERE thread_id = ?
        ORDER BY ord DESC
        LIMIT ?`,
    )
    .all(threadId, limit) as Array<Parameters<typeof rowToTurn>[0]>;
  return {
    thread: rowToThread(row),
    turns: turnRows.map(rowToTurn).reverse(),
  };
}

export function listThreads(
  db: Db,
  opts: { limit?: number; search?: string } = {},
): ThreadRow[] {
  const limit = opts.limit ?? 50;
  const search = opts.search?.trim();
  const params: Array<string | number> = [];
  let where = 'WHERE archived = 0';
  if (search) {
    where += ' AND title LIKE ?';
    params.push(`%${search}%`);
  }
  params.push(limit);
  return (
    db
      .prepare(
        `SELECT id, title, created_at, updated_at, archived FROM rag_thread ${where}
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(...params) as Array<Parameters<typeof rowToThread>[0]>
  ).map(rowToThread);
}

export function deleteThread(db: Db, threadId: string): { ok: true } {
  db.prepare(`DELETE FROM rag_thread WHERE id = ?`).run(threadId);
  return { ok: true };
}
