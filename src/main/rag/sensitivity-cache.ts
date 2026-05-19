/**
 * Plan 07-02 Task 3.5 — Chunk sensitivity cache (REVIEWS C5).
 *
 * Eliminates the N=10 query-time fan-out by classifying chunks AT INDEX TIME
 * and caching the result on `rag_chunk.sensitivity` + `sensitivity_model` +
 * `sensitivity_at`. The answer-router (plan 07-03) reads the cache directly
 * and only re-classifies when the cache is empty OR the classifier modelId
 * has changed.
 *
 * Classifier reuse: this module imports `classifySensitivityLLM` from the
 * Phase 3 router (src/main/llm/sensitivityClassifier.ts) — we do NOT
 * re-implement the classifier. Cache invalidation is automatic when Phase 3
 * bumps its CLASSIFIER_VERSION (caller passes that as `classifierModelId`).
 *
 * Failure mode: if the classifier throws, leave `sensitivity=NULL`. The
 * answer router treats NULL as unknown → forced LOCAL route (fail-closed).
 */
import type Database from 'better-sqlite3-multiple-ciphers';

type Db = Database.Database;

export type SensitivityClass =
  | 'none'
  | 'pii:low' | 'pii:med' | 'pii:high'
  | 'hr:low' | 'hr:med' | 'hr:high'
  | 'legal:low' | 'legal:med' | 'legal:high'
  | 'financial:low' | 'financial:med' | 'financial:high';

export interface SensitivityClassifierFn {
  (text: string): Promise<SensitivityClass>;
}

interface CachedRow {
  sensitivity: string | null;
  sensitivity_model: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Single-chunk classify with cache. Returns the cached value when the model
 * matches; otherwise calls the classifier and persists the result.
 *
 * Caller injects `classify` so this module stays test-friendly. The IndexWriter
 * (Task 3) wires it to the Phase 3 router.
 */
export async function classifyChunkSensitivity(
  db: Db,
  chunk: { id: string; text: string },
  classifierModelId: string,
  classify: SensitivityClassifierFn,
): Promise<SensitivityClass | null> {
  const row = db
    .prepare(`SELECT sensitivity, sensitivity_model FROM rag_chunk WHERE id = ?`)
    .get(chunk.id) as CachedRow | undefined;
  if (row && row.sensitivity && row.sensitivity_model === classifierModelId) {
    return row.sensitivity as SensitivityClass;
  }
  try {
    const result = await classify(chunk.text);
    db.prepare(
      `UPDATE rag_chunk SET sensitivity = ?, sensitivity_model = ?, sensitivity_at = ? WHERE id = ?`,
    ).run(result, classifierModelId, nowIso(), chunk.id);
    return result;
  } catch {
    // Fail-closed: leave sensitivity NULL so the answer router forces LOCAL.
    return null;
  }
}

/**
 * Bulk classify. Sequential classifier calls (concurrency=1) to avoid Ollama
 * saturation per the Phase 4 OOM lesson. Returns a Map keyed by chunk.id.
 *
 * Updates inside a single transaction at the end for atomicity with the
 * IndexWriter's caller-managed transaction (Task 3 calls this from inside its
 * own db.transaction, so we just emit per-row UPDATE without nesting).
 */
export async function classifyChunksBulk(
  db: Db,
  chunks: Array<{ id: string; text: string }>,
  classifierModelId: string,
  classify: SensitivityClassifierFn,
): Promise<Map<string, SensitivityClass | null>> {
  const out = new Map<string, SensitivityClass | null>();
  if (chunks.length === 0) return out;

  // Hydrate cached state in one query so we know which chunks need classification.
  const placeholders = chunks.map(() => '?').join(',');
  const cached = db
    .prepare(
      `SELECT id, sensitivity, sensitivity_model FROM rag_chunk WHERE id IN (${placeholders})`,
    )
    .all(...chunks.map((c) => c.id)) as Array<{
    id: string;
    sensitivity: string | null;
    sensitivity_model: string | null;
  }>;
  const cacheMap = new Map(cached.map((r) => [r.id, r]));

  const updateStmt = db.prepare(
    `UPDATE rag_chunk SET sensitivity = ?, sensitivity_model = ?, sensitivity_at = ? WHERE id = ?`,
  );

  for (const c of chunks) {
    const cur = cacheMap.get(c.id);
    if (cur && cur.sensitivity && cur.sensitivity_model === classifierModelId) {
      out.set(c.id, cur.sensitivity as SensitivityClass);
      continue;
    }
    try {
      const result = await classify(c.text);
      updateStmt.run(result, classifierModelId, nowIso(), c.id);
      out.set(c.id, result);
    } catch {
      // Fail-closed.
      out.set(c.id, null);
    }
  }
  return out;
}
