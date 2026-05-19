-- 126_rag_index.sql
-- Phase 7: RAG index — chunks, vectors, FTS, dirty queue, people directory, threads.

CREATE TABLE rag_chunk (
  id                  TEXT PRIMARY KEY,
  source_kind         TEXT NOT NULL CHECK (source_kind IN ('email','event','note','action')),
  source_id           TEXT NOT NULL,
  provider_key        TEXT,
  account_id          TEXT,
  parent_ref          TEXT,
  speaker_hint        TEXT,
  title               TEXT NOT NULL DEFAULT '',           -- C8/C12: denormalized at index time
  text                TEXT NOT NULL,
  char_start          INTEGER NOT NULL,
  char_end            INTEGER NOT NULL,
  token_count         INTEGER NOT NULL,
  lang                TEXT,                                -- C7: future per-language search; nullable
  sensitivity         TEXT,                                -- C5/C7: cached classifier output ('none'|'pii'|'hr'|'legal'|'financial' + ':low'|':med'|':high')
  sensitivity_model   TEXT,                                -- C5: classifier modelId at the time of caching (forces re-classify on swap)
  sensitivity_at      TEXT,                                -- C5: ISO timestamp of last classification
  source_updated_at   TEXT,                                -- C7: mirrors canonical source row updated_at; enables cheap dirty detection
  deleted_at          TEXT,                                -- C7: soft-delete tombstone for audit-trace retention
  dirty               INTEGER NOT NULL DEFAULT 1 CHECK (dirty IN (0,1)),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX idx_rag_chunk_source ON rag_chunk(source_kind, source_id);
CREATE INDEX idx_rag_chunk_dirty ON rag_chunk(dirty) WHERE dirty = 1;
CREATE INDEX idx_rag_chunk_account ON rag_chunk(provider_key, account_id);
CREATE INDEX idx_rag_chunk_alive ON rag_chunk(source_kind, source_id) WHERE deleted_at IS NULL;

CREATE TABLE rag_embedding (
  chunk_id        TEXT NOT NULL REFERENCES rag_chunk(id) ON DELETE CASCADE,
  model_id        TEXT NOT NULL,
  dim             INTEGER NOT NULL,
  vector          BLOB NOT NULL,
  embedding_norm  REAL,                                    -- C7: cached L2 norm; spares brute-force the recompute
  embedded_at     TEXT NOT NULL,
  PRIMARY KEY (chunk_id, model_id)
);

CREATE INDEX idx_rag_embedding_model ON rag_embedding(model_id);

CREATE VIRTUAL TABLE rag_chunk_fts USING fts5(
  text,
  content='rag_chunk',
  content_rowid='rowid',
  tokenize='porter unicode61 remove_diacritics 1'
);

CREATE TRIGGER rag_chunk_ai AFTER INSERT ON rag_chunk BEGIN
  INSERT INTO rag_chunk_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER rag_chunk_ad AFTER DELETE ON rag_chunk BEGIN
  INSERT INTO rag_chunk_fts(rag_chunk_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;
CREATE TRIGGER rag_chunk_au AFTER UPDATE ON rag_chunk BEGIN
  INSERT INTO rag_chunk_fts(rag_chunk_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO rag_chunk_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TABLE rag_index_state (
  id                       INTEGER PRIMARY KEY CHECK (id = 1),
  active_model_id          TEXT NOT NULL,
  active_model_dim         INTEGER NOT NULL,
  rebuild_in_progress      INTEGER NOT NULL DEFAULT 0 CHECK (rebuild_in_progress IN (0,1)),
  rebuild_target_model_id  TEXT,
  rebuild_target_dim       INTEGER,
  rebuild_started_at       TEXT,
  rebuild_progress_done    INTEGER NOT NULL DEFAULT 0,
  rebuild_progress_total   INTEGER NOT NULL DEFAULT 0,
  rebuild_completed_at     TEXT,
  vector_backend           TEXT NOT NULL DEFAULT 'sqlite-vec' CHECK (vector_backend IN ('sqlite-vec','fallback')),
  updated_at               TEXT NOT NULL
);

INSERT INTO rag_index_state(id, active_model_id, active_model_dim, updated_at)
VALUES (1, 'nomic-embed-text:v1.5', 768, strftime('%Y-%m-%dT%H:%M:%fZ','now'));

CREATE TABLE rag_source_dirty (
  source_kind     TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  target_model_id TEXT,
  enqueued_at     TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source_kind, source_id, target_model_id)
);

CREATE INDEX idx_rag_source_dirty_enq ON rag_source_dirty(enqueued_at);

CREATE TABLE rag_thread (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  archived    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1))
);
CREATE INDEX idx_rag_thread_updated ON rag_thread(updated_at DESC);

CREATE TABLE rag_turn (
  id                  TEXT PRIMARY KEY,
  thread_id           TEXT NOT NULL REFERENCES rag_thread(id) ON DELETE CASCADE,
  ord                 INTEGER NOT NULL,
  role                TEXT NOT NULL CHECK (role IN ('user','assistant')),
  text                TEXT NOT NULL,
  citations_json      TEXT,
  routing_json        TEXT,
  embedding_model_id  TEXT,                              -- C7: which embed model the retrieval used (forensic)
  retrieval_strategy  TEXT,                              -- C7: 'vector-only'|'fts-only'|'hybrid' for A/B telemetry
  total_cost_usd      REAL NOT NULL DEFAULT 0,          -- C7: frontier API spend rolled up per thread for Phase 8 insights
  created_at          TEXT NOT NULL
);
CREATE INDEX idx_rag_turn_thread_ord ON rag_turn(thread_id, ord);

CREATE TABLE person (
  id                TEXT PRIMARY KEY,
  canonical_email   TEXT UNIQUE,
  display_name      TEXT NOT NULL,
  first_seen_at     TEXT NOT NULL,
  last_seen_at      TEXT NOT NULL,
  observed_count    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE person_alias (
  person_id   TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  alias       TEXT NOT NULL,
  alias_kind  TEXT NOT NULL CHECK (alias_kind IN ('email','displayname','shortname')),
  seen_count  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (person_id, alias, alias_kind)
);
CREATE INDEX idx_person_alias_alias ON person_alias(alias COLLATE NOCASE);

PRAGMA user_version = 126;
