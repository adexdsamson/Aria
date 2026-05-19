-- Phase 7 UAT Gap 8 — `rag_source_dirty` dedupe fix.
--
-- The original PK in 126_rag_index.sql includes `target_model_id` which is
-- nullable. SQLite treats NULLs as distinct in PRIMARY KEY / UNIQUE
-- constraints, so `INSERT OR IGNORE` against the default-enqueue path
-- (`target_model_id IS NULL`) was inserting duplicate rows on every
-- backfill / re-enqueue. That broke seedBackfill resumability and let the
-- worker double-process the same source.
--
-- Fix: rebuild the table without the multi-column PK on the nullable column
-- and add a UNIQUE INDEX that COALESCEs target_model_id to '' for the
-- uniqueness check. NULL semantics are preserved everywhere else
-- (discriminator queries `target_model_id IS NULL` still work — we only
-- collapse NULLs for dedup).
--
-- Carry forward existing rows. Indexes get rebuilt.

CREATE TABLE rag_source_dirty_new (
  source_kind     TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  target_model_id TEXT,
  enqueued_at     TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0
);

INSERT INTO rag_source_dirty_new (source_kind, source_id, target_model_id, enqueued_at, attempts)
SELECT source_kind, source_id, target_model_id, enqueued_at, attempts
  FROM rag_source_dirty;

DROP TABLE rag_source_dirty;

ALTER TABLE rag_source_dirty_new RENAME TO rag_source_dirty;

CREATE UNIQUE INDEX uniq_rag_source_dirty_dedupe
  ON rag_source_dirty (source_kind, source_id, COALESCE(target_model_id, ''));

CREATE INDEX idx_rag_source_dirty_enq ON rag_source_dirty(enqueued_at);

PRAGMA user_version = 127;
