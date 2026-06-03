-- Migration 135: repair child-table foreign keys left dangling by migration 124.
--
-- Migration 124 (Phase 6) ran `ALTER TABLE approval RENAME TO approval_old`
-- WITHOUT `PRAGMA legacy_alter_table=ON`. Under SQLite >= 3.25 that RENAME
-- rewrites references to `approval` inside other objects, so the foreign keys of
-- `send_log` (009/012a) and `calendar_action_log` (010) were silently repointed
-- at `approval_old` — which migration 124 then DROPPED. Because connect.ts opens
-- every connection with `PRAGMA foreign_keys=ON`, this makes EVERY insert into
-- those tables throw `no such table: approval_old`, breaking email-send logging
-- (writeSendLog) and calendar write-back logging.
--
-- Migration 134 now guards its own rebuild with legacy_alter_table=ON, so it no
-- longer inflicts this damage. This migration repairs the pre-existing 124 damage
-- by rebuilding the two affected tables with correct `REFERENCES approval(id)`.
-- (meeting_action self-heals: migration 125 recreates it after 124, and 134 no
-- longer re-breaks it. The action_audit_log view self-heals once 134 stops
-- rewriting references.) Column lists and indexes are reproduced verbatim from
-- the live post-134 schema; only the FK target changes.
--
-- legacy_alter_table=ON so the RENAME below does not itself rewrite references.

PRAGMA foreign_keys=OFF;
PRAGMA legacy_alter_table=ON;
BEGIN;

-- ── send_log (FK approval_id -> approval) ────────────────────────────────────
CREATE TABLE send_log_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  approval_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_msg_id TEXT,
  recipients_json TEXT NOT NULL,
  subject TEXT,
  ok INTEGER NOT NULL CHECK (ok IN (0,1)),
  error TEXT,
  FOREIGN KEY (approval_id) REFERENCES approval(id)
);
INSERT INTO send_log_new (
  id, approval_id, ts, provider, provider_msg_id, recipients_json, subject, ok, error
)
SELECT
  id, approval_id, ts, provider, provider_msg_id, recipients_json, subject, ok, error
FROM send_log;
DROP TABLE send_log;
ALTER TABLE send_log_new RENAME TO send_log;
CREATE INDEX IF NOT EXISTS idx_send_log_ts ON send_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_send_log_approval ON send_log(approval_id);

-- ── calendar_action_log (FK approval_id -> approval) ─────────────────────────
CREATE TABLE calendar_action_log_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  approval_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('proposed','pre_write','post_write','failed','override')),
  event_id TEXT,
  recurring_scope TEXT,
  before_json TEXT,
  after_json TEXT,
  rule_overrides_json TEXT,
  google_etag TEXT,
  google_error TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (approval_id) REFERENCES approval(id)
);
INSERT INTO calendar_action_log_new (
  id, approval_id, phase, event_id, recurring_scope, before_json, after_json,
  rule_overrides_json, google_etag, google_error, created_at
)
SELECT
  id, approval_id, phase, event_id, recurring_scope, before_json, after_json,
  rule_overrides_json, google_etag, google_error, created_at
FROM calendar_action_log;
DROP TABLE calendar_action_log;
ALTER TABLE calendar_action_log_new RENAME TO calendar_action_log;
CREATE INDEX IF NOT EXISTS idx_calendar_action_log_approval ON calendar_action_log(approval_id);
CREATE INDEX IF NOT EXISTS idx_calendar_action_log_event ON calendar_action_log(event_id);

COMMIT;
PRAGMA legacy_alter_table=OFF;
PRAGMA foreign_keys=ON;
