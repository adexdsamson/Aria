/**
 * Plan 07-03 Task 1 — Hybrid retrieval (BM25 + vector + RRF fusion).
 *
 * Per RESEARCH §6:
 *   - BM25 top-K (default 50) from FTS5
 *   - Vector top-K (default 50) from VectorStore (sqlite-vec OR brute-force)
 *   - Fuse via Reciprocal Rank Fusion: score(c) = Σ_i 1/(k_rrf + rank_i + 1)
 *   - Hydrate top-N (default 10) with chunk metadata for the answer router
 *
 * REVIEWS C5 echo: the hydrated row carries `sensitivity` (cached at index
 * time by plan 07-02). Answer router reads it directly — no per-query
 * classifier calls.
 *
 * REVIEWS C8/C12 echo: `title` is denormalized into `rag_chunk.title` at
 * index time, so hydration is a single-row SELECT (no cross-table JOINs at
 * query time).
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import { bm25Search, type BM25Hit } from './bm25-search';
import type { VectorStore, Hit as VectorHit } from './vector-store';

type Db = Database.Database;

export interface EmbedClient {
  embed(texts: string[]): Promise<Float32Array[]>;
}

export interface RetrievedChunk {
  id: string;
  text: string;
  sourceKind: 'email' | 'event' | 'note' | 'action';
  sourceId: string;
  parentRef: string | null;
  charStart: number;
  charEnd: number;
  providerKey: string | null;
  accountId: string | null;
  title: string;
  occurredAt: string | null;
  sensitivity: string | null;
  rrfScore: number;
}

export interface HybridRetrievalOpts {
  topK?: number;
  bm25K?: number;
  vectorK?: number;
  accountFilter?: Array<{ providerKey: string; accountId: string }>;
  rrfK?: number;
}

/**
 * Reciprocal Rank Fusion. `rankedLists` is an array of ordered chunkId lists
 * where index 0 is the top-ranked element. Returns a Map of chunkId → fused
 * score, where higher = better.
 *
 * Standard formula: score(c) = Σ_i 1/(k_rrf + rank_i + 1)
 * `+1` so rank 0 contributes 1/(k+1), not 1/k (matches RESEARCH §6 wording).
 */
export function rrfFuse(
  rankedLists: string[][],
  opts: { k?: number } = {},
): Map<string, number> {
  const k = opts.k ?? 60;
  const scores = new Map<string, number>();
  for (const list of rankedLists) {
    list.forEach((chunkId, rank) => {
      const inc = 1 / (k + rank + 1);
      scores.set(chunkId, (scores.get(chunkId) ?? 0) + inc);
    });
  }
  return scores;
}

function readRrfKFromMeta(db: Db, fallback: number): number {
  try {
    const row = db
      .prepare(`SELECT v FROM app_meta WHERE k = 'rag_rrf_k'`)
      .get() as { v: string } | undefined;
    if (!row) return fallback;
    const n = parseInt(row.v, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  } catch {
    return fallback;
  }
}

export async function vectorSearch(
  embedClient: EmbedClient,
  vectorStore: VectorStore,
  queryText: string,
  k = 50,
): Promise<VectorHit[]> {
  const vecs = await embedClient.embed([queryText]);
  if (vecs.length === 0 || !vecs[0]) return [];
  return vectorStore.query(vecs[0], k);
}

export interface HybridRetrievalDeps {
  db: Db;
  embedClient: EmbedClient;
  vectorStore: VectorStore;
}

export async function hybridRetrieve(
  deps: HybridRetrievalDeps,
  question: string,
  opts: HybridRetrievalOpts = {},
): Promise<RetrievedChunk[]> {
  const { db, embedClient, vectorStore } = deps;
  const topK = opts.topK ?? 10;
  const bm25K = opts.bm25K ?? 50;
  const vectorK = opts.vectorK ?? 50;
  const rrfK = opts.rrfK ?? readRrfKFromMeta(db, 60);

  const bmHits: BM25Hit[] = bm25Search(db, question, {
    k: bm25K,
    accountFilter: opts.accountFilter,
  });

  let vectorHits: VectorHit[] = [];
  try {
    vectorHits = await vectorSearch(embedClient, vectorStore, question, vectorK);
  } catch {
    // Embedding/vector failure → degrade to BM25-only.
    vectorHits = [];
  }

  // Apply account/soft-delete filtering to vector hits via metadata join.
  if (vectorHits.length > 0) {
    const ids = vectorHits.map((h) => h.chunkId);
    const placeholders = ids.map(() => '?').join(',');
    const accountFilter = opts.accountFilter ?? [];
    const accountClause =
      accountFilter.length > 0
        ? ` AND (${accountFilter
            .map(() => '(provider_key = ? AND account_id = ?)')
            .join(' OR ')})`
        : '';
    const params: Array<string | number> = [...ids];
    for (const f of accountFilter) params.push(f.providerKey, f.accountId);
    const allowed = new Set(
      (db
        .prepare(
          `SELECT id FROM rag_chunk WHERE id IN (${placeholders}) AND deleted_at IS NULL ${accountClause}`,
        )
        .all(...params) as Array<{ id: string }>).map((r) => r.id),
    );
    vectorHits = vectorHits.filter((h) => allowed.has(h.chunkId));
  }

  const bmRanked = bmHits.map((h) => h.chunkId);
  const vecRanked = vectorHits.map((h) => h.chunkId);
  const fused = rrfFuse([bmRanked, vecRanked], { k: rrfK });

  // Pick top-K chunkIds by fused score.
  const ordered = Array.from(fused.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK);

  if (ordered.length === 0) return [];

  // Hydrate metadata in a single query.
  const ids = ordered.map(([id]) => id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT id, text, source_kind, source_id, parent_ref, char_start, char_end,
              provider_key, account_id, title, source_updated_at, sensitivity
         FROM rag_chunk
        WHERE id IN (${placeholders})
          AND deleted_at IS NULL`,
    )
    .all(...ids) as Array<{
    id: string;
    text: string;
    source_kind: 'email' | 'event' | 'note' | 'action';
    source_id: string;
    parent_ref: string | null;
    char_start: number;
    char_end: number;
    provider_key: string | null;
    account_id: string | null;
    title: string;
    source_updated_at: string | null;
    sensitivity: string | null;
  }>;
  const byId = new Map(rows.map((r) => [r.id, r]));

  const out: RetrievedChunk[] = [];
  for (const [id, score] of ordered) {
    const r = byId.get(id);
    if (!r) continue;
    out.push({
      id: r.id,
      text: r.text,
      sourceKind: r.source_kind,
      sourceId: r.source_id,
      parentRef: r.parent_ref,
      charStart: r.char_start,
      charEnd: r.char_end,
      providerKey: r.provider_key,
      accountId: r.account_id,
      title: r.title,
      occurredAt: r.source_updated_at,
      sensitivity: r.sensitivity,
      rrfScore: score,
    });
  }
  return out;
}
