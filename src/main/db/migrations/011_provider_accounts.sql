CREATE TABLE IF NOT EXISTS provider_account (
  account_id          TEXT NOT NULL,
  provider_key        TEXT NOT NULL CHECK (provider_key IN ('google','microsoft')),
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

CREATE TABLE IF NOT EXISTS provider_sync_state (
  provider_key   TEXT NOT NULL,
  account_id     TEXT NOT NULL,
  resource       TEXT NOT NULL CHECK (resource IN ('mail','calendar')),
  cursor         TEXT,
  last_sync_at   TEXT,
  last_error     TEXT,
  PRIMARY KEY (provider_key, account_id, resource),
  FOREIGN KEY (provider_key, account_id) REFERENCES provider_account(provider_key, account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_provider_account_status ON provider_account(status);

ALTER TABLE calendar_event ADD COLUMN recurrence_unsupported INTEGER NOT NULL DEFAULT 0;

PRAGMA user_version = 11;
