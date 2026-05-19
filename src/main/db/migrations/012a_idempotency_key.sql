PRAGMA foreign_keys=OFF;
BEGIN;

ALTER TABLE approval ADD COLUMN idempotency_key TEXT;
ALTER TABLE approval ADD COLUMN last_error_message TEXT;

UPDATE approval
   SET idempotency_key = lower(hex(randomblob(16)))
 WHERE idempotency_key IS NULL;

CREATE TABLE approval_new (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('email_send','calendar_change')),
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
  last_error_message TEXT
);

INSERT INTO approval_new (
  id, kind, state, created_at, updated_at, approval_path,
  source_message_id, recipients_json, subject, body_original, body_edited,
  classifier_version, categories_json, severity, confidence,
  classifier_rationale, routed, triage_signals_json, triage_summary,
  rejection_reason, snooze_until, sent_at, send_log_id, beta_voice,
  calendar_event_id, calendar_action, recurring_scope,
  before_json, after_json, conflicts_json, alternatives_json, rule_overrides_json,
  provider_key, account_id, idempotency_key, last_error_message
)
SELECT
  id, kind, state, created_at, updated_at, approval_path,
  source_message_id, recipients_json, subject, body_original, body_edited,
  classifier_version, categories_json, severity, confidence,
  classifier_rationale, routed, triage_signals_json, triage_summary,
  rejection_reason, snooze_until, sent_at, send_log_id, beta_voice,
  calendar_event_id, calendar_action, recurring_scope,
  before_json, after_json, conflicts_json, alternatives_json, rule_overrides_json,
  provider_key, account_id, idempotency_key, NULL
FROM approval;

DROP TABLE approval;
ALTER TABLE approval_new RENAME TO approval;

CREATE INDEX IF NOT EXISTS idx_approval_state ON approval(state);
CREATE INDEX IF NOT EXISTS idx_approval_kind_state ON approval(kind, state);
CREATE INDEX IF NOT EXISTS idx_approval_updated_at ON approval(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_provider_account ON approval(provider_key, account_id);

ALTER TABLE send_log RENAME TO send_log_old;

CREATE TABLE send_log (
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
INSERT INTO send_log (
  id, approval_id, ts, provider, provider_msg_id, recipients_json, subject, ok, error
)
SELECT
  id, approval_id, ts, provider, provider_msg_id, recipients_json, subject, ok, error
FROM send_log_old;
DROP TABLE send_log_old;
CREATE INDEX IF NOT EXISTS idx_send_log_ts ON send_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_send_log_approval ON send_log(approval_id);

PRAGMA user_version = 121;
COMMIT;
PRAGMA foreign_keys=ON;
