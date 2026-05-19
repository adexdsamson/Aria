/**
 * Plan 07-03 Task 1 — BM25 search via SQLite FTS5.
 *
 * Tokenizer: `porter unicode61 remove_diacritics 1` (migration 126).
 * Joins to `rag_chunk` for account filter + soft-delete respect.
 *
 * `bm25(rag_chunk_fts)` returns a NEGATIVE score where lower (more negative)
 * = better match. We negate so callers can sort DESC consistently with the
 * vector store (higher = better).
 */
import type Database from 'better-sqlite3-multiple-ciphers';

type Db = Database.Database;

export interface BM25Hit {
  chunkId: string;
  score: number;
}

export interface BM25SearchOpts {
  k?: number;
  accountFilter?: Array<{ providerKey: string; accountId: string }>;
}

/**
 * Sanitize a free-form question into an FTS5 MATCH expression. FTS5 is
 * sensitive to bareword operators like AND/OR/NOT and unbalanced quotes. We
 * tokenize on non-word chars and join with implicit AND via space.
 */
export function buildFtsMatchExpr(queryText: string): string {
  const tokens = queryText
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 1 && !/^(and|or|not|near)$/.test(t));
  if (tokens.length === 0) return '""';
  // Wrap each token in quotes to disable FTS5 operator parsing on it.
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' ');
}

export function bm25Search(
  db: Db,
  queryText: string,
  opts: BM25SearchOpts = {},
): BM25Hit[] {
  const k = opts.k ?? 50;
  const expr = buildFtsMatchExpr(queryText);
  if (expr === '""') return [];

  const accountFilter = opts.accountFilter ?? [];
  const accountClause =
    accountFilter.length > 0
      ? ` AND (${accountFilter
          .map(() => '(c.provider_key = ? AND c.account_id = ?)')
          .join(' OR ')})`
      : '';

  const sql = `
    SELECT c.id AS chunk_id, bm25(rag_chunk_fts) AS raw_score
    FROM rag_chunk_fts
    JOIN rag_chunk c ON c.rowid = rag_chunk_fts.rowid
    WHERE rag_chunk_fts MATCH ?
      AND c.deleted_at IS NULL
      ${accountClause}
    ORDER BY bm25(rag_chunk_fts)
    LIMIT ?
  `;

  const params: Array<string | number> = [expr];
  for (const f of accountFilter) {
    params.push(f.providerKey, f.accountId);
  }
  params.push(k);

  const rows = db.prepare(sql).all(...params) as Array<{
    chunk_id: string;
    raw_score: number;
  }>;
  // bm25() returns negative numbers (more negative = better). Negate so higher
  // = better, matching the vector score convention.
  return rows.map((r) => ({ chunkId: r.chunk_id, score: -r.raw_score }));
}
