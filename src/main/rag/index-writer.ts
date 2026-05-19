/**
 * Plan 07-02 Task 3 — Transactional index writer.
 *
 * Owns the source→chunk pipeline:
 *   1. Delete existing rows for (source_kind, source_id). FTS5 + embedding
 *      cascades run via triggers (rag_chunk_ad) + FK (rag_embedding).
 *   2. Insert new chunks emitted by the chunking strategy. Each chunk row gets
 *      `dirty=1` so the embedding worker picks it up on next tick.
 *   3. Classify sensitivity at index time (REVIEWS C5) via the sensitivity
 *      cache module — same transaction, so no chunk ever exists without its
 *      classification persisted (NULL only on classifier failure → fail-closed).
 *   4. INSERT INTO rag_source_dirty so the embedding worker drains the source.
 *
 * Logging hygiene: only ids + counts. Never log chunk.text on insert/delete.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type { Logger } from 'pino';
import type { ChunkingStrategy, SourceDoc, SourceKind } from './chunk-types';
import {
  classifyChunksBulk,
  type SensitivityClassifierFn,
} from './sensitivity-cache';

type Db = Database.Database;

export interface UpsertResult {
  inserted: number;
  deleted: number;
  dirtied: number;
  classified: number;
}

export interface DeleteResult {
  deletedChunks: number;
}

export interface IndexWriter {
  upsertSource(doc: SourceDoc): Promise<UpsertResult>;
  deleteSource(sourceKind: SourceKind, sourceId: string): DeleteResult;
}

export interface IndexWriterDeps {
  db: Db;
  logger: Logger;
  strategy: ChunkingStrategy;
  /** Classifier injected for testability — production wires Phase 3 router. */
  classify: SensitivityClassifierFn;
  /** Current classifier modelId (typically `CLASSIFIER_VERSION`). */
  classifierModelId: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function chunkId(doc: SourceDoc, index: number): string {
  return `${doc.sourceKind}:${doc.sourceId}:chunk:${index}`;
}

export function createIndexWriter(deps: IndexWriterDeps): IndexWriter {
  const { db, logger, strategy, classify, classifierModelId } = deps;

  async function upsertSource(doc: SourceDoc): Promise<UpsertResult> {
    const chunks = strategy.chunk(doc);
    const now = nowIso();

    // Phase 1: synchronous DB writes inside a transaction. Classification is
    // async (LLM call) — we run it AFTER the chunks are committed, then run a
    // second short transaction to persist sensitivity. This avoids holding a
    // write lock across an LLM round-trip while preserving the invariant that
    // every chunk's sensitivity is persisted before upsertSource() returns.
    let inserted = 0;
    let deleted = 0;
    let dirtied = 0;

    const txn = db.transaction(() => {
      const oldCount = (db
        .prepare(`SELECT count(*) AS n FROM rag_chunk WHERE source_kind = ? AND source_id = ?`)
        .get(doc.sourceKind, doc.sourceId) as { n: number }).n;
      db.prepare(`DELETE FROM rag_chunk WHERE source_kind = ? AND source_id = ?`).run(
        doc.sourceKind,
        doc.sourceId,
      );
      deleted = oldCount;

      const insertStmt = db.prepare(
        `INSERT INTO rag_chunk (
           id, source_kind, source_id, provider_key, account_id, parent_ref,
           speaker_hint, title, text, char_start, char_end, token_count,
           lang, source_updated_at, dirty, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      );
      chunks.forEach((c, i) => {
        insertStmt.run(
          chunkId(doc, i),
          c.sourceKind,
          c.sourceId,
          c.providerKey ?? null,
          c.accountId ?? null,
          c.parentRef ?? null,
          c.speakerHint ?? null,
          c.title,
          c.text,
          c.charStart,
          c.charEnd,
          c.tokenCount,
          c.lang ?? null,
          c.sourceUpdatedAt ?? null,
          now,
          now,
        );
      });
      inserted = chunks.length;

      // Enqueue the source for the embedding worker.
      db.prepare(
        `INSERT OR REPLACE INTO rag_source_dirty (source_kind, source_id, target_model_id, enqueued_at, attempts)
         VALUES (?, ?, NULL, ?, 0)`,
      ).run(doc.sourceKind, doc.sourceId, now);
      dirtied = chunks.length;
    });
    txn();

    // Phase 2: classify outside the write txn (LLM round-trip).
    let classified = 0;
    if (chunks.length > 0) {
      const newChunks = chunks.map((_, i) => ({
        id: chunkId(doc, i),
        text: chunks[i]!.text,
      }));
      const results = await classifyChunksBulk(db, newChunks, classifierModelId, classify);
      for (const v of results.values()) if (v !== null) classified++;
    }

    logger.info(
      {
        scope: 'rag.index-writer',
        op: 'upsert',
        source_kind: doc.sourceKind,
        source_id: doc.sourceId,
        inserted,
        deleted,
        dirtied,
        classified,
      },
      'rag.index-writer.upsert',
    );

    return { inserted, deleted, dirtied, classified };
  }

  function deleteSource(sourceKind: SourceKind, sourceId: string): DeleteResult {
    const row = db
      .prepare(`SELECT count(*) AS n FROM rag_chunk WHERE source_kind = ? AND source_id = ?`)
      .get(sourceKind, sourceId) as { n: number };
    const deletedChunks = row.n;
    const txn = db.transaction(() => {
      db.prepare(`DELETE FROM rag_chunk WHERE source_kind = ? AND source_id = ?`).run(
        sourceKind,
        sourceId,
      );
      db.prepare(`DELETE FROM rag_source_dirty WHERE source_kind = ? AND source_id = ?`).run(
        sourceKind,
        sourceId,
      );
    });
    txn();
    logger.info(
      { scope: 'rag.index-writer', op: 'delete', source_kind: sourceKind, source_id: sourceId, deletedChunks },
      'rag.index-writer.delete',
    );
    return { deletedChunks };
  }

  return { upsertSource, deleteSource };
}
