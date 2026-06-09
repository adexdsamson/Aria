-- Migration 138: WhatsApp foundation — 4 new tables + provider_account CHECK rebuild.
--
-- Adds 'whatsapp' to provider_account.provider_key CHECK, extends
-- provider_sync_state.resource CHECK to include 'session' (used by
-- WhatsApp's auth/session cursor), and creates the four WhatsApp tables:
--   whatsapp_auth_state  — Signal protocol creds + keys (SQLCipher-encrypted)
--   whatsapp_group       — Tracked group metadata
--   whatsapp_message     — Privacy-filtered incoming group messages (30-day rolling)
--   whatsapp_group_digest — Daily digest stubs (Phase 21)
--
-- CRITICAL: PRAGMA legacy_alter_table=ON wraps the provider_account RENAME
-- so SQLite >= 3.25 does NOT silently repoint provider_sync_state's
-- FOREIGN KEY (provider_key, account_id) REFERENCES provider_account(...)
-- at provider_account_old — the migration-124→135 failure mode (SQLite FK
-- rewrite on RENAME, then DROP leaves dangling references).
--
-- provider_account schema source: migration 125 (12-col post-Phase-6 shape,
-- NOT migration 011 which is the stale 2-col shape). Column list is explicit
-- (not INSERT … SELECT * — fragile against column-order drift).

PRAGMA foreign_keys=OFF;
PRAGMA legacy_alter_table=ON;
BEGIN;

-- ── provider_account: add 'whatsapp' to provider_key CHECK ───────────────────

ALTER TABLE provider_account RENAME TO provider_account_old;

CREATE TABLE provider_account (
  account_id          TEXT NOT NULL,
  provider_key        TEXT NOT NULL CHECK (provider_key IN ('google','microsoft','todoist','whatsapp')),
  display_email       TEXT NOT NULL,
  display_label       TEXT,
  display_color       TEXT,
  status              TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','degraded','needs-auth','disconnected')),
  identity_set_json   TEXT,
  last_synced_at      TEXT,
  last_error          TEXT,
  last_error_at       TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  capabilities_json   TEXT NOT NULL,
  PRIMARY KEY (provider_key, account_id)
);

INSERT INTO provider_account (
  account_id, provider_key, display_email, display_label, display_color,
  status, identity_set_json, last_synced_at, last_error, last_error_at,
  created_at, capabilities_json
)
SELECT
  account_id, provider_key, display_email, display_label, display_color,
  status, identity_set_json, last_synced_at, last_error, last_error_at,
  created_at, capabilities_json
FROM provider_account_old;

DROP TABLE provider_account_old;

CREATE INDEX IF NOT EXISTS idx_provider_account_status ON provider_account(status);

-- ── provider_sync_state: add 'session' resource for WhatsApp ─────────────────
-- The FK (provider_key, account_id) → provider_account is preserved;
-- the 'session' resource lets WhatsApp store its cursor without a separate table.

ALTER TABLE provider_sync_state RENAME TO provider_sync_state_old;

CREATE TABLE provider_sync_state (
  provider_key   TEXT NOT NULL,
  account_id     TEXT NOT NULL,
  resource       TEXT NOT NULL CHECK (resource IN ('mail','calendar','tasks','session')),
  cursor         TEXT,
  last_sync_at   TEXT,
  last_error     TEXT,
  PRIMARY KEY (provider_key, account_id, resource),
  FOREIGN KEY (provider_key, account_id) REFERENCES provider_account(provider_key, account_id) ON DELETE CASCADE
);

INSERT INTO provider_sync_state (
  provider_key, account_id, resource, cursor, last_sync_at, last_error
)
SELECT
  provider_key, account_id, resource, cursor, last_sync_at, last_error
FROM provider_sync_state_old;

DROP TABLE provider_sync_state_old;

-- ── Recreate views dropped by the provider_account rename ────────────────────

DROP VIEW IF EXISTS gmail_account_view;
DROP VIEW IF EXISTS calendar_account_view;

CREATE VIEW gmail_account_view AS
  SELECT account_id AS email,
         display_email,
         status,
         last_synced_at,
         last_error,
         created_at AS connected_at,
         identity_set_json
    FROM provider_account
   WHERE provider_key = 'google'
     AND json_extract(capabilities_json, '$.mail') = 1;

CREATE VIEW calendar_account_view AS
  SELECT account_id AS email,
         display_email,
         status,
         last_synced_at,
         last_error,
         created_at AS connected_at,
         identity_set_json
    FROM provider_account
   WHERE provider_key = 'google'
     AND json_extract(capabilities_json, '$.calendar') = 1;

-- ── whatsapp_auth_state ───────────────────────────────────────────────────────
-- Stores Baileys Signal protocol credentials and key material.
-- All values serialized with BufferJSON.replacer (Baileys exported helper).
-- Assumption A2 LOCKED: 4-col composite PK (key_type, key_id).
-- Every keys.set() batch MUST use a single db.transaction() (gate 4).

-- Column is named 'type' (not 'key_type') to match auth-state.spec.ts raw SQL
-- queries and auth-state.ts prepared statement bindings.
CREATE TABLE IF NOT EXISTS whatsapp_auth_state (
  type        TEXT NOT NULL,
  key_id      TEXT NOT NULL,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (type, key_id)
);

-- ── whatsapp_group ────────────────────────────────────────────────────────────
-- Metadata for WhatsApp groups known to this account.
-- tracked=0 by default (D-03: privacy boundary; must be explicitly enabled).

CREATE TABLE IF NOT EXISTS whatsapp_group (
  jid           TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL DEFAULT '',
  description   TEXT,
  tracked       INTEGER NOT NULL DEFAULT 0 CHECK (tracked IN (0, 1)),
  member_count  INTEGER,
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_group_tracked ON whatsapp_group(tracked);

-- ── whatsapp_message ──────────────────────────────────────────────────────────
-- Privacy-filtered incoming messages from tracked groups only.
-- 30-day rolling retention enforced by retention cron (D-14).
-- UNIQUE(jid, wa_id) prevents duplicate ingestion on reconnect.
-- ON DELETE CASCADE: removing a whatsapp_group row cascades to its messages.

CREATE TABLE IF NOT EXISTS whatsapp_message (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  jid         TEXT NOT NULL,
  sender_jid  TEXT NOT NULL,
  wa_id       TEXT NOT NULL,
  sent_at     INTEGER NOT NULL,
  body_text   TEXT NOT NULL,
  ingested_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (jid, wa_id),
  FOREIGN KEY (jid) REFERENCES whatsapp_group(jid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_message_jid_sent ON whatsapp_message(jid, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_message_sent ON whatsapp_message(sent_at DESC);

-- ── whatsapp_group_digest ─────────────────────────────────────────────────────
-- Daily AI-generated digest stubs (Phase 21 populates these).
-- Lands now so Phase 21 needs no schema migration.
-- ON DELETE CASCADE: removing a whatsapp_group row cascades to its digests.

CREATE TABLE IF NOT EXISTS whatsapp_group_digest (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  jid          TEXT NOT NULL,
  date         TEXT NOT NULL,
  summary_text TEXT,
  generated_at INTEGER,
  model_id     TEXT,
  UNIQUE (jid, date),
  FOREIGN KEY (jid) REFERENCES whatsapp_group(jid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_group_digest_date ON whatsapp_group_digest(date DESC);

COMMIT;
PRAGMA legacy_alter_table=OFF;
-- NOTE: foreign_keys intentionally left OFF after this migration.
-- The migration runner leaves PRAGMA state as-is; callers that need FK enforcement
-- (openDb in connect.ts) re-enable it after runMigrations() completes.
-- This allows the migration-138 integration test to verify the FK target
-- is provider_account (not provider_account_old) without requiring a parent row.
PRAGMA user_version = 138;
