-- Plan 04-01: Calendar write-back schema.
--
-- (a) Widen approval.kind CHECK to accept 'calendar_change' AND add 8 nullable
--     calendar_* columns. SQLite doesn't allow altering CHECK in place, so we
--     RENAME / CREATE / INSERT-SELECT / DROP (same idiom as migration 006).
-- (b) Additive ALTER on calendar_event for write-back metadata: etag,
--     i_cal_uid, sequence, organizer_email, organizer_self, recurrence_json.
-- (c) scheduling_rules singleton with id=1 and default empty rules.
-- (d) calendar_action_log append-only audit table (Plan 04-01 chokepoint).

-- ---------------------------------------------------------------------------
-- (a) Widen approval.kind CHECK + add 8 calendar_* nullable columns
-- ---------------------------------------------------------------------------

ALTER TABLE approval RENAME TO approval_old;

CREATE TABLE approval (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('email_send','calendar_change')),
  state TEXT NOT NULL CHECK (state IN ('pending','generating','ready','approved','rejected','snoozed','interrupted','sent')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approval_path TEXT NOT NULL DEFAULT 'explicit' CHECK (approval_path IN ('explicit','silent')),

  -- email_send payload (NULL when kind != 'email_send')
  source_message_id TEXT,
  recipients_json TEXT,
  subject TEXT,
  body_original TEXT,
  body_edited TEXT,

  -- classifier output
  classifier_version TEXT,
  categories_json TEXT,
  severity TEXT,
  confidence REAL,
  classifier_rationale TEXT,
  routed TEXT,

  -- triage rationale
  triage_signals_json TEXT,
  triage_summary TEXT,

  -- terminal states
  rejection_reason TEXT,
  snooze_until TEXT,
  sent_at TEXT,
  send_log_id INTEGER,

  -- Plan 03-04 column
  beta_voice INTEGER NOT NULL DEFAULT 0,

  -- Plan 04-01: calendar_change payload (NULL when kind != 'calendar_change')
  calendar_event_id TEXT,
  calendar_action TEXT CHECK (calendar_action IS NULL OR calendar_action IN ('move','create','find-time')),
  recurring_scope TEXT CHECK (recurring_scope IS NULL OR recurring_scope IN ('this','future','all')),
  before_json TEXT,
  after_json TEXT,
  conflicts_json TEXT,
  alternatives_json TEXT,
  rule_overrides_json TEXT
);

INSERT INTO approval (
  id, kind, state, created_at, updated_at, approval_path,
  source_message_id, recipients_json, subject, body_original, body_edited,
  classifier_version, categories_json, severity, confidence,
  classifier_rationale, routed, triage_signals_json, triage_summary,
  rejection_reason, snooze_until, sent_at, send_log_id, beta_voice,
  calendar_event_id, calendar_action, recurring_scope,
  before_json, after_json, conflicts_json, alternatives_json, rule_overrides_json
)
SELECT
  id, kind, state, created_at, updated_at, approval_path,
  source_message_id, recipients_json, subject, body_original, body_edited,
  classifier_version, categories_json, severity, confidence,
  classifier_rationale, routed, triage_signals_json, triage_summary,
  rejection_reason, snooze_until, sent_at, send_log_id, beta_voice,
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
FROM approval_old;

DROP TABLE approval_old;

CREATE INDEX IF NOT EXISTS idx_approval_state ON approval(state);
CREATE INDEX IF NOT EXISTS idx_approval_kind_state ON approval(kind, state);
CREATE INDEX IF NOT EXISTS idx_approval_updated_at ON approval(updated_at DESC);

-- ---------------------------------------------------------------------------
-- (b) calendar_event additive columns (Phase 2 etag debt + write-back fields)
-- ---------------------------------------------------------------------------

ALTER TABLE calendar_event ADD COLUMN etag TEXT;
ALTER TABLE calendar_event ADD COLUMN i_cal_uid TEXT;
ALTER TABLE calendar_event ADD COLUMN sequence INTEGER;
ALTER TABLE calendar_event ADD COLUMN organizer_email TEXT;
ALTER TABLE calendar_event ADD COLUMN organizer_self INTEGER;
ALTER TABLE calendar_event ADD COLUMN recurrence_json TEXT;

-- ---------------------------------------------------------------------------
-- (c) scheduling_rules singleton
-- ---------------------------------------------------------------------------

CREATE TABLE scheduling_rules (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  rules_json TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO scheduling_rules (id, rules_json, time_zone, updated_at)
VALUES (1, '[]', 'UTC', '1970-01-01T00:00:00.000Z');

-- ---------------------------------------------------------------------------
-- (d) calendar_action_log append-only audit table
-- ---------------------------------------------------------------------------

CREATE TABLE calendar_action_log (
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
CREATE INDEX idx_calendar_action_log_approval ON calendar_action_log(approval_id);
CREATE INDEX idx_calendar_action_log_event ON calendar_action_log(event_id);
