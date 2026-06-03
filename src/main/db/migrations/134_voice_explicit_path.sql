PRAGMA foreign_keys=OFF;
-- legacy_alter_table=ON makes RENAME behave as in SQLite < 3.25: it does NOT
-- rewrite references to `approval` inside OTHER objects (child-table foreign
-- keys, views, triggers). Without this, RENAME approval -> approval_old silently
-- repoints send_log / calendar_action_log / meeting_action FKs and the
-- action_audit_log view at approval_old, which we then DROP — leaving dangling
-- references that fail every child insert once foreign_keys=ON. (migration 135
-- repairs the equivalent damage migration 124 inflicted before this guard existed.)
PRAGMA legacy_alter_table=ON;
BEGIN;

ALTER TABLE approval RENAME TO approval_old;

CREATE TABLE approval (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('email_send','calendar_change','task_batch')),
  state TEXT NOT NULL CHECK (state IN (
    'pending','generating','ready','approved','rejected','snoozed','interrupted','sent',
    'sending','failed','needs-operator-decision'
  )),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approval_path TEXT NOT NULL DEFAULT 'explicit' CHECK (approval_path IN ('explicit','silent','voice-explicit')),
  source_message_id TEXT,
  recipients_json TEXT,
  subject TEXT,
  body_original TEXT,
  body_edited TEXT,
  classifier_version TEXT,
  categories_json TEXT,
  severity TEXT,
  confidence REAL,
  classifier_rationale TEXT,
  routed TEXT,
  triage_signals_json TEXT,
  triage_summary TEXT,
  rejection_reason TEXT,
  snooze_until TEXT,
  sent_at TEXT,
  send_log_id INTEGER,
  beta_voice INTEGER NOT NULL DEFAULT 0,
  calendar_event_id TEXT,
  calendar_action TEXT CHECK (calendar_action IS NULL OR calendar_action IN ('move','create','find-time')),
  recurring_scope TEXT CHECK (recurring_scope IS NULL OR recurring_scope IN ('this','future','all')),
  before_json TEXT,
  after_json TEXT,
  conflicts_json TEXT,
  alternatives_json TEXT,
  rule_overrides_json TEXT,
  provider_key TEXT,
  account_id TEXT,
  idempotency_key TEXT NOT NULL,
  last_error_message TEXT,
  meeting_note_id TEXT
);

INSERT INTO approval (
  id, kind, state, created_at, updated_at, approval_path,
  source_message_id, recipients_json, subject, body_original, body_edited,
  classifier_version, categories_json, severity, confidence,
  classifier_rationale, routed, triage_signals_json, triage_summary,
  rejection_reason, snooze_until, sent_at, send_log_id, beta_voice,
  calendar_event_id, calendar_action, recurring_scope,
  before_json, after_json, conflicts_json, alternatives_json, rule_overrides_json,
  provider_key, account_id, idempotency_key, last_error_message, meeting_note_id
)
SELECT
  id, kind, state, created_at, updated_at, approval_path,
  source_message_id, recipients_json, subject, body_original, body_edited,
  classifier_version, categories_json, severity, confidence,
  classifier_rationale, routed, triage_signals_json, triage_summary,
  rejection_reason, snooze_until, sent_at, send_log_id, beta_voice,
  calendar_event_id, calendar_action, recurring_scope,
  before_json, after_json, conflicts_json, alternatives_json, rule_overrides_json,
  provider_key, account_id, idempotency_key, last_error_message, meeting_note_id
FROM approval_old;

DROP TABLE approval_old;

CREATE INDEX IF NOT EXISTS idx_approval_state ON approval(state);
CREATE INDEX IF NOT EXISTS idx_approval_kind_state ON approval(kind, state);
CREATE INDEX IF NOT EXISTS idx_approval_updated_at ON approval(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_provider_account ON approval(provider_key, account_id);
CREATE INDEX IF NOT EXISTS idx_approval_meeting_note ON approval(meeting_note_id);

COMMIT;
PRAGMA legacy_alter_table=OFF;
PRAGMA foreign_keys=ON;
