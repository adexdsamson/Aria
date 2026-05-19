PRAGMA foreign_keys=OFF;
BEGIN;

DROP VIEW IF EXISTS gmail_account_view;
DROP VIEW IF EXISTS calendar_account_view;

ALTER TABLE provider_account RENAME TO provider_account_old;

CREATE TABLE provider_account (
  account_id          TEXT NOT NULL,
  provider_key        TEXT NOT NULL CHECK (provider_key IN ('google','microsoft','todoist')),
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

ALTER TABLE provider_sync_state RENAME TO provider_sync_state_old;

CREATE TABLE provider_sync_state (
  provider_key   TEXT NOT NULL,
  account_id     TEXT NOT NULL,
  resource       TEXT NOT NULL CHECK (resource IN ('mail','calendar','tasks')),
  cursor         TEXT,
  last_sync_at   TEXT,
  last_error     TEXT,
  PRIMARY KEY (provider_key, account_id, resource),
  FOREIGN KEY (provider_key, account_id) REFERENCES provider_account(provider_key, account_id) ON DELETE CASCADE
);

INSERT INTO provider_sync_state (
  provider_key, account_id, resource, cursor, last_sync_at, last_error
)
SELECT provider_key, account_id, resource, cursor, last_sync_at, last_error
FROM provider_sync_state_old;

DROP TABLE provider_sync_state_old;

CREATE INDEX IF NOT EXISTS idx_provider_account_status ON provider_account(status);

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

ALTER TABLE meeting_action RENAME TO meeting_action_old;

CREATE TABLE meeting_action (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  approval_id TEXT,
  text TEXT NOT NULL,
  owner TEXT NOT NULL CHECK (owner IN ('self','follow-up','unassigned')),
  follow_up_with TEXT,
  due_iso TEXT,
  due_raw TEXT,
  due_confidence TEXT CHECK (due_confidence IS NULL OR due_confidence IN ('high','med','low')),
  priority_hint TEXT CHECK (priority_hint IS NULL OR priority_hint IN ('p1','p2','p3','p4')),
  citation_start INTEGER NOT NULL,
  citation_end INTEGER NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected','pushed','failed')),
  pushable INTEGER NOT NULL DEFAULT 0 CHECK (pushable IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (note_id) REFERENCES meeting_note(id) ON DELETE CASCADE,
  FOREIGN KEY (approval_id) REFERENCES approval(id),
  CHECK (citation_start >= 0),
  CHECK (citation_end > citation_start)
);

INSERT INTO meeting_action (
  id, note_id, approval_id, text, owner, follow_up_with, due_iso, due_raw,
  due_confidence, priority_hint, citation_start, citation_end, confidence,
  status, pushable, created_at, updated_at
)
SELECT
  id, note_id, approval_id, text, owner, follow_up_with, due_iso, due_raw,
  due_confidence, priority_hint, citation_start, citation_end, confidence,
  status, pushable, created_at, updated_at
FROM meeting_action_old;

DROP TABLE meeting_action_old;

CREATE INDEX IF NOT EXISTS idx_meeting_action_note ON meeting_action(note_id, status);
CREATE INDEX IF NOT EXISTS idx_meeting_action_approval ON meeting_action(approval_id);
CREATE INDEX IF NOT EXISTS idx_meeting_action_due ON meeting_action(due_iso);
CREATE INDEX IF NOT EXISTS idx_meeting_action_push ON meeting_action(pushable, status);

CREATE TABLE todoist_task (
  id TEXT PRIMARY KEY,
  remote_id TEXT UNIQUE,
  content TEXT NOT NULL,
  description TEXT,
  project_id TEXT,
  project_name TEXT,
  labels_json TEXT NOT NULL DEFAULT '[]',
  due_iso TEXT,
  priority INTEGER NOT NULL DEFAULT 1 CHECK (priority BETWEEN 1 AND 4),
  is_completed INTEGER NOT NULL DEFAULT 0 CHECK (is_completed IN (0,1)),
  source TEXT NOT NULL CHECK (source IN ('todoist','aria')),
  meeting_action_id TEXT,
  note_id TEXT,
  remote_updated_at TEXT,
  local_updated_at TEXT NOT NULL,
  last_error TEXT,
  FOREIGN KEY (meeting_action_id) REFERENCES meeting_action(id) ON DELETE SET NULL,
  FOREIGN KEY (note_id) REFERENCES meeting_note(id) ON DELETE SET NULL
);

CREATE TABLE meeting_action_task_link (
  action_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (action_id) REFERENCES meeting_action(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES todoist_task(id) ON DELETE CASCADE
);

CREATE INDEX idx_todoist_task_due ON todoist_task(due_iso, is_completed);
CREATE INDEX idx_todoist_task_source ON todoist_task(source, local_updated_at DESC);
CREATE INDEX idx_todoist_task_meeting_action ON todoist_task(meeting_action_id);

COMMIT;
PRAGMA foreign_keys=ON;
PRAGMA user_version = 125;
