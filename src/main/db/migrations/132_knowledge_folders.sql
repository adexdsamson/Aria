-- 132_knowledge_folders.sql
-- Phase 10: Knowledge Folders — new tables + rag_chunk extension.
--
-- Pattern follows 127_rag_source_dirty_dedupe.sql (create-new / copy / drop /
-- rename) because SQLite cannot ALTER a CHECK constraint in place.

PRAGMA foreign_keys=OFF;

-- 1. knowledge_folders ---------------------------------------------------------

CREATE TABLE knowledge_folders (
  id            TEXT PRIMARY KEY,       -- sha256(absolute_path)
  path          TEXT NOT NULL,
  label         TEXT NOT NULL,
  sensitivity   TEXT NOT NULL CHECK (sensitivity IN ('general','sensitive')),
  status        TEXT NOT NULL CHECK (status IN ('active','paused','error')),
  last_scan_at  TEXT,
  last_error    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE(path)
);

-- 2. knowledge_files -----------------------------------------------------------

CREATE TABLE knowledge_files (
  id            TEXT PRIMARY KEY,       -- sha256(folder_id || relative_path)
  folder_id     TEXT NOT NULL REFERENCES knowledge_folders(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  absolute_path TEXT NOT NULL,
  size          INTEGER NOT NULL,
  mtime         TEXT NOT NULL,
  content_hash  TEXT,
  status        TEXT NOT NULL CHECK (status IN ('pending','indexed','error','tombstoned','skipped')),
  last_error    TEXT,
  tombstoned_at TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE(folder_id, relative_path)
);

CREATE INDEX idx_knowledge_files_folder     ON knowledge_files(folder_id);
CREATE INDEX idx_knowledge_files_tombstoned ON knowledge_files(status, tombstoned_at) WHERE status='tombstoned';

-- 3. Extend rag_chunk to accept source_kind='folder' --------------------------
-- The CHECK constraint cannot be altered in place; recreate via
-- create-new / copy / drop / rename (same pattern as migration 127).

CREATE TABLE rag_chunk_new (
  id                  TEXT PRIMARY KEY,
  source_kind         TEXT NOT NULL CHECK (source_kind IN ('email','event','note','action','folder')),
  source_id           TEXT NOT NULL,
  provider_key        TEXT,
  account_id          TEXT,
  parent_ref          TEXT,
  speaker_hint        TEXT,
  title               TEXT NOT NULL DEFAULT '',
  text                TEXT NOT NULL,
  char_start          INTEGER NOT NULL,
  char_end            INTEGER NOT NULL,
  token_count         INTEGER NOT NULL,
  lang                TEXT,
  sensitivity         TEXT,
  sensitivity_model   TEXT,
  sensitivity_at      TEXT,
  source_updated_at   TEXT,
  deleted_at          TEXT,
  dirty               INTEGER NOT NULL DEFAULT 1 CHECK (dirty IN (0,1)),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  folder_id           TEXT,
  file_id             TEXT,
  FOREIGN KEY (file_id) REFERENCES knowledge_files(id) ON DELETE CASCADE
);

INSERT INTO rag_chunk_new (
  id, source_kind, source_id, provider_key, account_id, parent_ref,
  speaker_hint, title, text, char_start, char_end, token_count,
  lang, sensitivity, sensitivity_model, sensitivity_at,
  source_updated_at, deleted_at, dirty, created_at, updated_at,
  folder_id, file_id
)
SELECT
  id, source_kind, source_id, provider_key, account_id, parent_ref,
  speaker_hint, title, text, char_start, char_end, token_count,
  lang, sensitivity, sensitivity_model, sensitivity_at,
  source_updated_at, deleted_at, dirty, created_at, updated_at,
  NULL, NULL
FROM rag_chunk;

DROP TABLE rag_chunk;

ALTER TABLE rag_chunk_new RENAME TO rag_chunk;

-- Recreate the four indexes from 126_rag_index.sql (verbatim).
CREATE INDEX idx_rag_chunk_source  ON rag_chunk(source_kind, source_id);
CREATE INDEX idx_rag_chunk_dirty   ON rag_chunk(dirty) WHERE dirty = 1;
CREATE INDEX idx_rag_chunk_account ON rag_chunk(provider_key, account_id);
CREATE INDEX idx_rag_chunk_alive   ON rag_chunk(source_kind, source_id) WHERE deleted_at IS NULL;

-- New index: file-keyed lookup for cascade verification + tombstone sweep.
CREATE INDEX idx_rag_chunk_file_id ON rag_chunk(file_id) WHERE file_id IS NOT NULL;

-- Recreate the three FTS5 triggers verbatim from 126_rag_index.sql.
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

PRAGMA user_version = 132;

PRAGMA foreign_keys=ON;
