/**
 * Plan 07-02 Task 1 — VectorStore dual-impl.
 *
 * Two single-store implementations behind one interface (REVIEWS C11 — no
 * dual-write):
 *   - `SqliteVecStore`: writes vectors ONLY to the `vec0` virtual table.
 *                       `rag_embedding` rows are metadata-only (vector BLOB
 *                       persisted as a zero-length BLOB so the FK + uniqueness
 *                       semantics still hold for cascade deletes).
 *   - `BruteForceStore`: writes vectors ONLY to `rag_embedding.vector` BLOB +
 *                        caches the L2 norm in `embedding_norm` (C7 column).
 *                        Query uses a single pre-allocated scratch buffer to
 *                        avoid per-call allocations (90k-chunk fallback budget
 *                        ≤300ms p95; see brute-force-90k-bench).
 *
 * Backend selection is sticky in `rag_index_state.vector_backend`. The runtime
 * load probe (`tryLoadSqliteVec`) decides the value at first boot; an
 * admin-initiated swap reuses the model-swap rebuild path (Task 5).
 *
 * Pitfall 4 (RESEARCH): `query()` MUST filter by `rag_index_state.active_model_id`
 * — no caller may pass a modelId in for "convenience".
 *
 * C2 fallback strategy — Option D (tiered):
 *   - Default: pure-JS brute force + norm cache (covers ≤90k chunks at ≤300ms p95).
 *   - Hard cap at 250k chunks: refuse new embeddings + surface a capacity banner.
 *     Trade-offs vs A (SQLite UDF), B (refuse outright), C (WASM sqlite-vec)
 *     documented in plan 07-02 Task 1.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import { tryLoadSqliteVec } from './sqlite-vec-loader';

type Db = Database.Database;

export interface Hit {
  chunkId: string;
  score: number;
}

export interface VectorStore {
  upsert(chunkId: string, vector: Float32Array, modelId: string): void;
  query(queryVector: Float32Array, k: number): Hit[];
  deleteByChunkId(chunkId: string): void;
  deleteByModelId(modelId: string): void;
  backendName(): 'sqlite-vec' | 'fallback';
}

export const BRUTE_FORCE_HARD_CAP = 250_000;
export const BRUTE_FORCE_WARN_CAP = 200_000;

interface ActiveModel {
  id: string;
  dim: number;
}

function readActiveModel(db: Db): ActiveModel {
  const row = db
    .prepare('SELECT active_model_id, active_model_dim FROM rag_index_state WHERE id = 1')
    .get() as { active_model_id?: string; active_model_dim?: number } | undefined;
  if (!row || !row.active_model_id || !row.active_model_dim) {
    throw new Error('rag_index_state row 1 not seeded — apply migration 126');
  }
  return { id: row.active_model_id, dim: row.active_model_dim };
}

function nowIso(): string {
  return new Date().toISOString();
}

function float32ToBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

function blobToFloat32(buf: Buffer): Float32Array {
  // Buffers from better-sqlite3 may be backed by a larger ArrayBuffer; copy
  // exactly the floats we need to avoid alignment hazards.
  const out = new Float32Array(buf.byteLength / 4);
  for (let i = 0; i < out.length; i++) {
    out[i] = buf.readFloatLE(i * 4);
  }
  return out;
}

function l2Norm(v: Float32Array): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
  return Math.sqrt(s);
}

function setBackend(db: Db, backend: 'sqlite-vec' | 'fallback'): void {
  db.prepare(
    `UPDATE rag_index_state SET vector_backend = ?, updated_at = ? WHERE id = 1`,
  ).run(backend, nowIso());
}

// ---------------------------------------------------------------------------
// SqliteVecStore
// ---------------------------------------------------------------------------

class SqliteVecStore implements VectorStore {
  private readonly db: Db;
  private readonly dim: number;
  private vecTableReady = false;

  constructor(db: Db) {
    this.db = db;
    this.dim = readActiveModel(db).dim;
    this.ensureVecTable();
  }

  private ensureVecTable(): void {
    if (this.vecTableReady) return;
    // vec0 virtual table — single store of vectors keyed by chunk_id + model_id.
    // The dimension is fixed at creation; model swaps that change dim trigger
    // table recreation under the swap path (Task 5).
    this.db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS rag_vec USING vec0(
         chunk_id TEXT PRIMARY KEY,
         model_id TEXT,
         emb float[${this.dim}]
       )`,
    );
    this.vecTableReady = true;
  }

  upsert(chunkId: string, vector: Float32Array, modelId: string): void {
    if (vector.length !== this.dim) {
      throw new Error(
        `SqliteVecStore.upsert: dim mismatch — got ${vector.length}, active dim ${this.dim}`,
      );
    }
    const norm = l2Norm(vector);
    const txn = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM rag_vec WHERE chunk_id = ?`).run(chunkId);
      this.db
        .prepare(
          `INSERT INTO rag_vec(chunk_id, model_id, emb) VALUES (?, ?, ?)`,
        )
        .run(chunkId, modelId, float32ToBlob(vector));
      // Metadata-only row in rag_embedding (NULL-vector convention: empty blob).
      this.db
        .prepare(
          `INSERT INTO rag_embedding (chunk_id, model_id, dim, vector, embedding_norm, embedded_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(chunk_id, model_id) DO UPDATE SET
             dim = excluded.dim,
             vector = excluded.vector,
             embedding_norm = excluded.embedding_norm,
             embedded_at = excluded.embedded_at`,
        )
        .run(chunkId, modelId, this.dim, Buffer.alloc(0), norm, nowIso());
    });
    txn();
  }

  query(queryVector: Float32Array, k: number): Hit[] {
    const active = readActiveModel(this.db);
    if (queryVector.length !== active.dim) {
      throw new Error(
        `SqliteVecStore.query: dim mismatch — got ${queryVector.length}, active dim ${active.dim}`,
      );
    }
    const rows = this.db
      .prepare(
        `SELECT chunk_id, distance
           FROM rag_vec
          WHERE model_id = ? AND emb MATCH ?
          ORDER BY distance
          LIMIT ?`,
      )
      .all(active.id, float32ToBlob(queryVector), k) as Array<{
      chunk_id: string;
      distance: number;
    }>;
    // Convert cosine distance into a similarity score (1 - d / 2 for unit-normed).
    return rows.map((r) => ({ chunkId: r.chunk_id, score: 1 - r.distance / 2 }));
  }

  deleteByChunkId(chunkId: string): void {
    this.db.prepare(`DELETE FROM rag_vec WHERE chunk_id = ?`).run(chunkId);
    this.db.prepare(`DELETE FROM rag_embedding WHERE chunk_id = ?`).run(chunkId);
  }

  deleteByModelId(modelId: string): void {
    this.db.prepare(`DELETE FROM rag_vec WHERE model_id = ?`).run(modelId);
    this.db.prepare(`DELETE FROM rag_embedding WHERE model_id = ?`).run(modelId);
  }

  backendName(): 'sqlite-vec' | 'fallback' {
    return 'sqlite-vec';
  }
}

// ---------------------------------------------------------------------------
// BruteForceStore
// ---------------------------------------------------------------------------

export class CapacityExceededError extends Error {
  override readonly name = 'CapacityExceededError';
  readonly count: number;
  readonly cap: number;
  constructor(count: number, cap: number) {
    super(
      `BruteForceStore at capacity (${count}/${cap}). Reinstall Aria from a build that ships sqlite-vec native binaries, or shrink the index.`,
    );
    this.count = count;
    this.cap = cap;
  }
}

class BruteForceStore implements VectorStore {
  private readonly db: Db;
  private scratch: Float32Array | null = null;

  constructor(db: Db) {
    this.db = db;
  }

  private aliveChunkCount(): number {
    const row = this.db
      .prepare(`SELECT count(*) AS n FROM rag_chunk WHERE deleted_at IS NULL`)
      .get() as { n: number };
    return row.n;
  }

  upsert(chunkId: string, vector: Float32Array, modelId: string): void {
    const active = readActiveModel(this.db);
    if (vector.length !== active.dim) {
      throw new Error(
        `BruteForceStore.upsert: dim mismatch — got ${vector.length}, active dim ${active.dim}`,
      );
    }
    if (this.aliveChunkCount() > BRUTE_FORCE_HARD_CAP) {
      throw new CapacityExceededError(this.aliveChunkCount(), BRUTE_FORCE_HARD_CAP);
    }
    const norm = l2Norm(vector);
    this.db
      .prepare(
        `INSERT INTO rag_embedding (chunk_id, model_id, dim, vector, embedding_norm, embedded_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(chunk_id, model_id) DO UPDATE SET
           dim = excluded.dim,
           vector = excluded.vector,
           embedding_norm = excluded.embedding_norm,
           embedded_at = excluded.embedded_at`,
      )
      .run(chunkId, modelId, vector.length, float32ToBlob(vector), norm, nowIso());
  }

  query(queryVector: Float32Array, k: number): Hit[] {
    const active = readActiveModel(this.db);
    if (queryVector.length !== active.dim) {
      throw new Error(
        `BruteForceStore.query: dim mismatch — got ${queryVector.length}, active dim ${active.dim}`,
      );
    }
    const qNorm = l2Norm(queryVector);
    if (qNorm === 0) return [];

    if (!this.scratch || this.scratch.length !== active.dim) {
      this.scratch = new Float32Array(active.dim);
    }
    const scratch = this.scratch;

    // Filter by active model — Pitfall 4.
    const rows = this.db
      .prepare(
        `SELECT chunk_id, vector, embedding_norm FROM rag_embedding WHERE model_id = ?`,
      )
      .all(active.id) as Array<{
      chunk_id: string;
      vector: Buffer;
      embedding_norm: number | null;
    }>;

    // Top-k via a small bounded heap (insertion into sorted array).
    const heap: Hit[] = [];
    for (const r of rows) {
      if (r.vector.byteLength !== active.dim * 4) continue;
      // Read floats into scratch without allocating.
      for (let i = 0; i < active.dim; i++) scratch[i] = r.vector.readFloatLE(i * 4);
      let dot = 0;
      for (let i = 0; i < active.dim; i++) dot += scratch[i]! * queryVector[i]!;
      const n = r.embedding_norm ?? 1;
      const score = dot / (n * qNorm);
      if (heap.length < k) {
        heap.push({ chunkId: r.chunk_id, score });
        if (heap.length === k) heap.sort((a, b) => b.score - a.score);
      } else if (score > heap[k - 1]!.score) {
        // Insert + drop worst.
        heap[k - 1] = { chunkId: r.chunk_id, score };
        // Re-sort small array; cheap for k=10..50.
        heap.sort((a, b) => b.score - a.score);
      }
    }
    if (heap.length < k) heap.sort((a, b) => b.score - a.score);
    return heap;
  }

  deleteByChunkId(chunkId: string): void {
    this.db.prepare(`DELETE FROM rag_embedding WHERE chunk_id = ?`).run(chunkId);
  }

  deleteByModelId(modelId: string): void {
    this.db.prepare(`DELETE FROM rag_embedding WHERE model_id = ?`).run(modelId);
  }

  backendName(): 'sqlite-vec' | 'fallback' {
    return 'fallback';
  }
}

// ---------------------------------------------------------------------------
// Factory + selection
// ---------------------------------------------------------------------------

export interface GetVectorStoreOpts {
  /** Force a specific backend (tests / admin swap). */
  force?: 'sqlite-vec' | 'fallback';
}

export function getVectorStore(db: Db, opts: GetVectorStoreOpts = {}): VectorStore {
  if (opts.force === 'sqlite-vec') {
    const probe = tryLoadSqliteVec(db);
    if (!probe.ok) {
      throw new Error(`force=sqlite-vec requested but probe failed: ${probe.reason}`);
    }
    setBackend(db, 'sqlite-vec');
    return new SqliteVecStore(db);
  }
  if (opts.force === 'fallback') {
    setBackend(db, 'fallback');
    return new BruteForceStore(db);
  }
  // Auto-probe.
  const probe = tryLoadSqliteVec(db);
  if (probe.ok) {
    setBackend(db, 'sqlite-vec');
    return new SqliteVecStore(db);
  }
  setBackend(db, 'fallback');
  return new BruteForceStore(db);
}

export { SqliteVecStore, BruteForceStore };
