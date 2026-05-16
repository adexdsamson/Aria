-- Plan 02-01 — Gmail ingest schema.
--
-- Tables:
--   gmail_account  — singleton (id=1) holding the connected account's email,
--                    the current history_id cursor, last_synced_at, last_error,
--                    and connected_at. NO refresh token here — those live in
--                    safeStorage.googleTokens (T-02-01-01).
--   gmail_message  — metadata-only mirror of recent (≤7d backfill + incremental)
--                    Gmail messages. No bodies — Phase 2 uses format='metadata'.
--
-- Indices:
--   idx_gmail_message_recv      — for the briefing engine's "last 24h" scan
--   idx_gmail_message_priority  — for the unread+important priority lookup

CREATE TABLE gmail_account (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email TEXT NOT NULL,
  history_id TEXT,
  last_synced_at TEXT,
  last_error TEXT,
  connected_at TEXT NOT NULL
);
CREATE TABLE gmail_message (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  from_addr TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL,
  label_ids TEXT NOT NULL,
  is_unread INTEGER NOT NULL DEFAULT 0,
  is_important INTEGER NOT NULL DEFAULT 0,
  history_id TEXT,
  fetched_at TEXT NOT NULL
);
CREATE INDEX idx_gmail_message_recv ON gmail_message(received_at DESC);
CREATE INDEX idx_gmail_message_priority ON gmail_message(is_unread, is_important, received_at DESC);
