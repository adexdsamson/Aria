/**
 * Plan 07-02 Task 1 — live sqlite-vec load probe integration test.
 *
 * Opens an encrypted DB and tries `tryLoadSqliteVec`. On success creates a
 * vec0 probe table, inserts 3 known vectors, and asserts KNN ordering.
 * On failure records the captured reason as a test annotation and updates
 * `rag_index_state.vector_backend` to 'fallback' — Wave-2 implementations
 * branch on this value.
 */
import { describe, it, expect } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb } from '../../../src/main/db/connect';
import { runMigrations } from '../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../setup';
import { tryLoadSqliteVec } from '../../../src/main/rag/sqlite-vec-loader';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../src/main/db/migrations');

function nowIso(): string {
  return new Date().toISOString();
}

describe('sqlite-vec load probe — Plan 07-02 Task 1', () => {
  it('decides backend deterministically and records reason on fallback', () => {
    const dataDir = createTempUserDataDir('aria-vec-probe');
    const dbKey = crypto.randomBytes(32);
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });

    const probe = tryLoadSqliteVec(db);

    if (probe.ok) {
      // Live path — exercise vec0 KNN.
      db.exec(`CREATE VIRTUAL TABLE vec_probe USING vec0(emb float[4])`);
      const v1 = Buffer.from(new Float32Array([1, 0, 0, 0]).buffer);
      const v2 = Buffer.from(new Float32Array([0.9, 0.1, 0, 0]).buffer);
      const v3 = Buffer.from(new Float32Array([0, 1, 0, 0]).buffer);
      db.prepare(`INSERT INTO vec_probe(rowid, emb) VALUES (1, ?)`).run(v1);
      db.prepare(`INSERT INTO vec_probe(rowid, emb) VALUES (2, ?)`).run(v2);
      db.prepare(`INSERT INTO vec_probe(rowid, emb) VALUES (3, ?)`).run(v3);
      const q = Buffer.from(new Float32Array([1, 0, 0, 0]).buffer);
      const rows = db
        .prepare(
          `SELECT rowid, distance FROM vec_probe WHERE emb MATCH ? ORDER BY distance LIMIT 2`,
        )
        .all(q) as Array<{ rowid: number; distance: number }>;
      expect(rows.length).toBe(2);
      expect(rows[0]!.rowid).toBe(1); // exact match
      expect(rows[1]!.rowid).toBe(2); // closer than v3
      db.prepare(
        `UPDATE rag_index_state SET vector_backend = 'sqlite-vec', updated_at = ? WHERE id = 1`,
      ).run(nowIso());
    } else {
      // Fallback path — record the reason and persist 'fallback' so plan code
      // can branch deterministically.
      // eslint-disable-next-line no-console
      console.warn(`[sqlite-vec-probe] FALLBACK selected — reason: ${probe.reason}`);
      db.prepare(
        `UPDATE rag_index_state SET vector_backend = 'fallback', updated_at = ? WHERE id = 1`,
      ).run(nowIso());
      const row = db
        .prepare(`SELECT vector_backend FROM rag_index_state WHERE id = 1`)
        .get() as { vector_backend: string };
      expect(row.vector_backend).toBe('fallback');
    }
  });
});
