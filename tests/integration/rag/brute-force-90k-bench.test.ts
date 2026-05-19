/**
 * Plan 07-02 Task 1.5 — Brute-force 90k-chunk perf gate (REVIEWS C2).
 *
 * Gated behind RAG_BENCH=1 so normal CI does not pay the seed cost.
 * Records p50/p95/p99 + memory delta to
 * tests/fixtures/rag/brute-force-bench-evidence.json for the SUMMARY.
 */
import { describe, it, expect } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { openDb } from '../../../src/main/db/connect';
import { runMigrations } from '../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../setup';
import { BruteForceStore } from '../../../src/main/rag/vector-store';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../src/main/db/migrations');
const N_CHUNKS = 90_000;
const DIM = 768;
const N_QUERIES = 20;
const P95_BUDGET_MS = 300;

const ENABLED = process.env['RAG_BENCH'] === '1';

function rand(dim: number): Float32Array {
  const v = new Float32Array(dim);
  let s = 0;
  for (let i = 0; i < dim; i++) {
    v[i] = Math.random() - 0.5;
    s += v[i]! * v[i]!;
  }
  const n = Math.sqrt(s);
  for (let i = 0; i < dim; i++) v[i] = v[i]! / n;
  return v;
}

function l2(v: Float32Array): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
  return Math.sqrt(s);
}

function quantile(sorted: number[], q: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx]!;
}

(ENABLED ? describe : describe.skip)(
  'BruteForceStore 90k benchmark — REVIEWS C2',
  () => {
    it('p95 latency ≤ 300ms over 90k chunks', () => {
      const dataDir = createTempUserDataDir('aria-bench');
      const dbKey = crypto.randomBytes(32);
      const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
      runMigrations(db, { dir: MIGRATIONS_DIR });

      const now = new Date().toISOString();
      const insertChunk = db.prepare(
        `INSERT INTO rag_chunk (id, source_kind, source_id, text, char_start, char_end, token_count, created_at, updated_at)
         VALUES (?, 'email', ?, 'x', 0, 1, 1, ?, ?)`,
      );
      const insertEmb = db.prepare(
        `INSERT INTO rag_embedding (chunk_id, model_id, dim, vector, embedding_norm, embedded_at)
         VALUES (?, 'nomic-embed-text:v1.5', ?, ?, ?, ?)`,
      );
      const memBefore = process.memoryUsage().heapUsed;
      const seedTxn = db.transaction(() => {
        for (let i = 0; i < N_CHUNKS; i++) {
          const id = `c${i}`;
          insertChunk.run(id, id, now, now);
          const v = rand(DIM);
          const buf = Buffer.from(v.buffer, v.byteOffset, v.byteLength);
          insertEmb.run(id, DIM, buf, l2(v), now);
        }
      });
      seedTxn();

      const store = new BruteForceStore(db);
      const latencies: number[] = [];
      for (let i = 0; i < N_QUERIES; i++) {
        const q = rand(DIM);
        const t0 = performance.now();
        const hits = store.query(q, 50);
        const dt = performance.now() - t0;
        expect(hits.length).toBe(50);
        latencies.push(dt);
      }
      latencies.sort((a, b) => a - b);
      const p50 = quantile(latencies, 0.5);
      const p95 = quantile(latencies, 0.95);
      const p99 = quantile(latencies, 0.99);
      const memAfter = process.memoryUsage().heapUsed;

      const evidenceDir = path.resolve(__dirname, '../../fixtures/rag');
      fs.mkdirSync(evidenceDir, { recursive: true });
      const evidencePath = path.join(evidenceDir, 'brute-force-bench-evidence.json');
      fs.writeFileSync(
        evidencePath,
        JSON.stringify(
          {
            timestamp: new Date().toISOString(),
            n_chunks: N_CHUNKS,
            n_queries: N_QUERIES,
            dim: DIM,
            p50_ms: p50,
            p95_ms: p95,
            p99_ms: p99,
            mem_delta_mb: (memAfter - memBefore) / (1024 * 1024),
          },
          null,
          2,
        ),
      );

      if (p95 > P95_BUDGET_MS) {
        throw new Error(
          `p95 ${p95.toFixed(1)}ms > ${P95_BUDGET_MS}ms — consider enabling sqlite-vec, or escalate to Option C (WASM sqlite-vec) per plan 07-02 Task 1 file header. p50=${p50.toFixed(1)} p99=${p99.toFixed(1)}`,
        );
      }
      expect(p95).toBeLessThanOrEqual(P95_BUDGET_MS);
    }, 600_000);
  },
);

if (!ENABLED) {
  describe('BruteForceStore 90k benchmark — gate', () => {
    it('skipped: set RAG_BENCH=1 to run the 90k perf gate', () => {
      expect(true).toBe(true);
    });
  });
}
