PRAGMA foreign_keys=OFF;
BEGIN;

CREATE TABLE meeting_summary (
  note_id TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  route TEXT NOT NULL CHECK (route IN ('LOCAL','FRONTIER')),
  model TEXT NOT NULL,
  notes TEXT,
  FOREIGN KEY (note_id) REFERENCES meeting_note(id) ON DELETE CASCADE
);

CREATE TABLE meeting_summary_item (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('topic','decision','follow_up','open_question')),
  text TEXT NOT NULL,
  citation_start INTEGER NOT NULL,
  citation_end INTEGER NOT NULL,
  ordinal INTEGER NOT NULL,
  FOREIGN KEY (note_id) REFERENCES meeting_note(id) ON DELETE CASCADE,
  CHECK (citation_start >= 0),
  CHECK (citation_end > citation_start)
);

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
  approval_path TEXT NOT NULL DEFAULT 'explicit' CHECK (approval_path IN ('explicit','silent')),
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
  provider_key, account_id, idempotency_key, last_error_message, NULL
FROM approval_old;

DROP TABLE approval_old;

CREATE INDEX IF NOT EXISTS idx_approval_state ON approval(state);
CREATE INDEX IF NOT EXISTS idx_approval_kind_state ON approval(kind, state);
CREATE INDEX IF NOT EXISTS idx_approval_updated_at ON approval(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_provider_account ON approval(provider_key, account_id);
CREATE INDEX IF NOT EXISTS idx_approval_meeting_note ON approval(meeting_note_id);
CREATE INDEX IF NOT EXISTS idx_meeting_summary_item_note ON meeting_summary_item(note_id, kind, ordinal);
CREATE INDEX IF NOT EXISTS idx_meeting_action_note ON meeting_action(note_id, status);
CREATE INDEX IF NOT EXISTS idx_meeting_action_approval ON meeting_action(approval_id);
CREATE INDEX IF NOT EXISTS idx_meeting_action_due ON meeting_action(due_iso);
CREATE INDEX IF NOT EXISTS idx_meeting_action_push ON meeting_action(pushable, status);

COMMIT;
PRAGMA foreign_keys=ON;
