/**
 * Embedded migration SQL. The source-of-truth lives in `*.sql` files next to
 * this module; this file mirrors their contents as string constants so the
 * runner has access to them after electron-vite bundles `src/main/` into
 * `out/main/index.js` (Vite does not copy non-imported assets).
 *
 * Keep in sync with the .sql files. The migrations test reads from the .sql
 * files directly — drift between the two will fail in CI.
 */
export interface EmbeddedMigration {
  version: number;
  file: string;
  sql: string;
}

export const EMBEDDED_MIGRATIONS: EmbeddedMigration[] = [
  {
    version: 1,
    file: '001_init.sql',
    sql: `
CREATE TABLE app_meta(
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

CREATE TABLE settings(
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

CREATE TABLE routing_log(
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT    NOT NULL,
  route       TEXT    NOT NULL CHECK (route IN ('LOCAL','FRONTIER')),
  reason      TEXT    NOT NULL,
  source      TEXT    NOT NULL,
  prompt_hash TEXT    NOT NULL,
  model       TEXT    NOT NULL,
  latency_ms  INTEGER NOT NULL,
  ok          INTEGER NOT NULL CHECK (ok IN (0,1))
);

CREATE INDEX idx_routing_log_ts ON routing_log(ts DESC);
`,
  },
  {
    version: 2,
    file: '002_gmail.sql',
    sql: `
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
`,
  },
  {
    version: 3,
    file: '003_calendar.sql',
    sql: `
CREATE TABLE calendar_account (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email TEXT NOT NULL,
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  sync_token TEXT,
  last_synced_at TEXT,
  last_error TEXT,
  connected_at TEXT NOT NULL
);
CREATE TABLE calendar_event (
  id TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  location TEXT,
  start_at_utc TEXT,
  end_at_utc TEXT,
  start_date TEXT,
  end_date TEXT,
  start_timezone TEXT,
  attendees TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'confirmed',
  recurring_id TEXT,
  updated_at TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  CHECK ((start_at_utc IS NOT NULL) OR (start_date IS NOT NULL))
);
CREATE INDEX idx_calendar_event_start ON calendar_event(start_at_utc);
CREATE INDEX idx_calendar_event_start_date ON calendar_event(start_date);
`,
  },
  {
    version: 4,
    file: '004_news.sql',
    sql: `
CREATE TABLE news_source (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('hn','rss','bundle')),
  country TEXT,
  sector TEXT,
  url TEXT,
  title TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  added_at TEXT NOT NULL
);
`,
  },
  {
    version: 5,
    file: '005_briefing.sql',
    sql: `
CREATE TABLE briefing (
  date TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  tz TEXT NOT NULL,
  sections TEXT NOT NULL,
  route TEXT NOT NULL CHECK (route IN ('LOCAL','FRONTIER')),
  model TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  ok INTEGER NOT NULL CHECK (ok IN (0,1))
);
CREATE TABLE briefing_item_dismissed (
  date TEXT NOT NULL,
  url_hash TEXT NOT NULL,
  dismissed_at TEXT NOT NULL,
  PRIMARY KEY (date, url_hash)
);
`,
  },
  {
    version: 6,
    file: '006_approvals_and_tier.sql',
    sql: `
CREATE TABLE IF NOT EXISTS approval (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('email_send')),
  state TEXT NOT NULL CHECK (state IN ('pending','generating','ready','approved','rejected','snoozed','interrupted','sent')),
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
  send_log_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_approval_state ON approval(state);
CREATE INDEX IF NOT EXISTS idx_approval_kind_state ON approval(kind, state);
CREATE INDEX IF NOT EXISTS idx_approval_updated_at ON approval(updated_at DESC);

CREATE TABLE IF NOT EXISTS approval_tier (
  content_class TEXT PRIMARY KEY,
  tier TEXT NOT NULL CHECK (tier IN ('silent','explicit','always-confirm'))
);
INSERT OR IGNORE INTO approval_tier (content_class, tier) VALUES ('email_send_general','always-confirm');
`,
  },
  {
    version: 7,
    file: '007_sensitivity_router.sql',
    sql: `
ALTER TABLE routing_log ADD COLUMN categories_json TEXT;
ALTER TABLE routing_log ADD COLUMN severity TEXT;
ALTER TABLE routing_log ADD COLUMN classifier_rationale TEXT;
ALTER TABLE routing_log ADD COLUMN classifier_version TEXT;
CREATE INDEX IF NOT EXISTS idx_routing_log_severity ON routing_log(severity);
`,
  },
  {
    version: 8,
    file: '008_email_triage.sql',
    sql: `
CREATE TABLE email_triage (
  message_id TEXT PRIMARY KEY,
  classifier_version TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('urgent','needs-you','fyi','archive')),
  signals_json TEXT NOT NULL,
  summary TEXT NOT NULL,
  ts TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES gmail_message(id)
);
CREATE INDEX idx_email_triage_priority ON email_triage(priority, ts DESC);
`,
  },
  {
    version: 9,
    file: '009_voice_match_drafting.sql',
    sql: `
CREATE TABLE IF NOT EXISTS voice_match_holdout (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  FOREIGN KEY (id) REFERENCES gmail_message(id)
);

ALTER TABLE approval ADD COLUMN beta_voice INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS send_log (
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
CREATE INDEX IF NOT EXISTS idx_send_log_ts ON send_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_send_log_approval ON send_log(approval_id);
`,
  },
  {
    version: 10,
    file: '010_calendar_writeback.sql',
    sql: `
ALTER TABLE approval RENAME TO approval_old;

CREATE TABLE approval (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('email_send','calendar_change')),
  state TEXT NOT NULL CHECK (state IN ('pending','generating','ready','approved','rejected','snoozed','interrupted','sent')),
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

ALTER TABLE calendar_event ADD COLUMN etag TEXT;
ALTER TABLE calendar_event ADD COLUMN i_cal_uid TEXT;
ALTER TABLE calendar_event ADD COLUMN sequence INTEGER;
ALTER TABLE calendar_event ADD COLUMN organizer_email TEXT;
ALTER TABLE calendar_event ADD COLUMN organizer_self INTEGER;
ALTER TABLE calendar_event ADD COLUMN recurrence_json TEXT;

CREATE TABLE scheduling_rules (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  rules_json TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO scheduling_rules (id, rules_json, time_zone, updated_at)
VALUES (1, '[]', 'UTC', '1970-01-01T00:00:00.000Z');

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
`,
  },
  {
    version: 11,
    file: '011_provider_accounts.sql',
    sql: `
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
`,
  },
  {
    version: 12,
    file: '012_message_provider_key.sql',
    sql: `
ALTER TABLE gmail_message ADD COLUMN provider_key TEXT;
ALTER TABLE gmail_message ADD COLUMN account_id TEXT;
ALTER TABLE calendar_event ADD COLUMN provider_key TEXT;
ALTER TABLE calendar_event ADD COLUMN account_id TEXT;
ALTER TABLE approval ADD COLUMN provider_key TEXT;
ALTER TABLE approval ADD COLUMN account_id TEXT;

CREATE INDEX IF NOT EXISTS idx_gmail_message_provider_account ON gmail_message(provider_key, account_id);
CREATE INDEX IF NOT EXISTS idx_calendar_event_provider_account ON calendar_event(provider_key, account_id);
CREATE INDEX IF NOT EXISTS idx_approval_provider_account ON approval(provider_key, account_id);

UPDATE gmail_message
   SET provider_key = 'google',
       account_id = (SELECT email FROM gmail_account LIMIT 1)
 WHERE provider_key IS NULL
   AND EXISTS (SELECT 1 FROM gmail_account);

UPDATE calendar_event
   SET provider_key = 'google',
       account_id = (SELECT email FROM calendar_account LIMIT 1)
 WHERE provider_key IS NULL
   AND EXISTS (SELECT 1 FROM calendar_account);

UPDATE approval
   SET provider_key = 'google',
       account_id = (SELECT email FROM gmail_account LIMIT 1)
 WHERE provider_key IS NULL
   AND kind = 'email_send'
   AND EXISTS (SELECT 1 FROM gmail_account);

UPDATE approval
   SET provider_key = 'google',
       account_id = (SELECT email FROM calendar_account LIMIT 1)
 WHERE provider_key IS NULL
   AND kind = 'calendar_change'
   AND EXISTS (SELECT 1 FROM calendar_account);

INSERT OR IGNORE INTO provider_account (
  account_id, provider_key, display_email, status, capabilities_json
)
SELECT email, 'google', email, 'ok', '{"mail":true,"calendar":false}'
  FROM gmail_account;

INSERT OR IGNORE INTO provider_account (
  account_id, provider_key, display_email, status, capabilities_json
)
SELECT email, 'google', email, 'ok', '{"mail":false,"calendar":true}'
  FROM calendar_account;

UPDATE provider_account
   SET capabilities_json = '{"mail":true,"calendar":true}'
 WHERE provider_key = 'google'
   AND account_id IN (SELECT email FROM gmail_account)
   AND account_id IN (SELECT email FROM calendar_account);

PRAGMA user_version = 12;
`,
  },
  {
    version: 121,
    file: '012a_idempotency_key.sql',
    sql: `
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
`,
  },
  {
    version: 122,
    file: '014_legacy_singleton_views.sql',
    sql: `
DROP TABLE IF EXISTS gmail_account;
DROP TABLE IF EXISTS calendar_account;

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
`,
  },
  {
    version: 123,
    file: '123_meeting_notes.sql',
    sql: `
CREATE TABLE meeting_note (
  id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('paste','txt','vtt','srt','json')),
  title TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  event_provider_key TEXT,
  event_account_id TEXT,
  calendar_event_id TEXT,
  link_confidence REAL,
  status TEXT NOT NULL DEFAULT 'captured' CHECK (status IN ('captured','linked','standalone'))
);

CREATE TABLE meeting_note_segment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  speaker TEXT,
  timestamp_sec REAL,
  FOREIGN KEY (note_id) REFERENCES meeting_note(id) ON DELETE CASCADE,
  CHECK (start_offset >= 0),
  CHECK (end_offset > start_offset)
);

CREATE INDEX idx_meeting_note_ingested_at ON meeting_note(ingested_at DESC);
CREATE INDEX idx_meeting_note_event ON meeting_note(event_provider_key, event_account_id, calendar_event_id);
CREATE INDEX idx_meeting_note_segment_note ON meeting_note_segment(note_id, start_offset);
`,
  },
  {
    version: 124,
    file: '124_meeting_extraction_approvals.sql',
    sql: `
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
`,
  },
  {
    version: 125,
    file: '125_todoist_tasks.sql',
    sql: `
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
`,
  },
  {
    version: 126,
    file: '126_rag_index.sql',
    sql: `
-- 126_rag_index.sql
-- Phase 7: RAG index — chunks, vectors, FTS, dirty queue, people directory, threads.

CREATE TABLE rag_chunk (
  id                  TEXT PRIMARY KEY,
  source_kind         TEXT NOT NULL CHECK (source_kind IN ('email','event','note','action')),
  source_id           TEXT NOT NULL,
  provider_key        TEXT,
  account_id          TEXT,
  parent_ref          TEXT,
  speaker_hint        TEXT,
  title               TEXT NOT NULL DEFAULT '',           -- C8/C12: denormalized at index time
  text                TEXT NOT NULL,
  char_start          INTEGER NOT NULL,
  char_end            INTEGER NOT NULL,
  token_count         INTEGER NOT NULL,
  lang                TEXT,                                -- C7: future per-language search; nullable
  sensitivity         TEXT,                                -- C5/C7: cached classifier output
  sensitivity_model   TEXT,                                -- C5: classifier modelId at the time of caching
  sensitivity_at      TEXT,                                -- C5: ISO timestamp of last classification
  source_updated_at   TEXT,                                -- C7: mirrors canonical source row updated_at
  deleted_at          TEXT,                                -- C7: soft-delete tombstone
  dirty               INTEGER NOT NULL DEFAULT 1 CHECK (dirty IN (0,1)),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX idx_rag_chunk_source ON rag_chunk(source_kind, source_id);
CREATE INDEX idx_rag_chunk_dirty ON rag_chunk(dirty) WHERE dirty = 1;
CREATE INDEX idx_rag_chunk_account ON rag_chunk(provider_key, account_id);
CREATE INDEX idx_rag_chunk_alive ON rag_chunk(source_kind, source_id) WHERE deleted_at IS NULL;

CREATE TABLE rag_embedding (
  chunk_id        TEXT NOT NULL REFERENCES rag_chunk(id) ON DELETE CASCADE,
  model_id        TEXT NOT NULL,
  dim             INTEGER NOT NULL,
  vector          BLOB NOT NULL,
  embedding_norm  REAL,                                    -- C7: cached L2 norm
  embedded_at     TEXT NOT NULL,
  PRIMARY KEY (chunk_id, model_id)
);

CREATE INDEX idx_rag_embedding_model ON rag_embedding(model_id);

CREATE VIRTUAL TABLE rag_chunk_fts USING fts5(
  text,
  content='rag_chunk',
  content_rowid='rowid',
  tokenize='porter unicode61 remove_diacritics 1'
);

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

CREATE TABLE rag_index_state (
  id                       INTEGER PRIMARY KEY CHECK (id = 1),
  active_model_id          TEXT NOT NULL,
  active_model_dim         INTEGER NOT NULL,
  rebuild_in_progress      INTEGER NOT NULL DEFAULT 0 CHECK (rebuild_in_progress IN (0,1)),
  rebuild_target_model_id  TEXT,
  rebuild_target_dim       INTEGER,
  rebuild_started_at       TEXT,
  rebuild_progress_done    INTEGER NOT NULL DEFAULT 0,
  rebuild_progress_total   INTEGER NOT NULL DEFAULT 0,
  rebuild_completed_at     TEXT,
  vector_backend           TEXT NOT NULL DEFAULT 'sqlite-vec' CHECK (vector_backend IN ('sqlite-vec','fallback')),
  updated_at               TEXT NOT NULL
);

INSERT INTO rag_index_state(id, active_model_id, active_model_dim, updated_at)
VALUES (1, 'nomic-embed-text:v1.5', 768, strftime('%Y-%m-%dT%H:%M:%fZ','now'));

CREATE TABLE rag_source_dirty (
  source_kind     TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  target_model_id TEXT,
  enqueued_at     TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source_kind, source_id, target_model_id)
);

CREATE INDEX idx_rag_source_dirty_enq ON rag_source_dirty(enqueued_at);

CREATE TABLE rag_thread (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  archived    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1))
);
CREATE INDEX idx_rag_thread_updated ON rag_thread(updated_at DESC);

CREATE TABLE rag_turn (
  id                  TEXT PRIMARY KEY,
  thread_id           TEXT NOT NULL REFERENCES rag_thread(id) ON DELETE CASCADE,
  ord                 INTEGER NOT NULL,
  role                TEXT NOT NULL CHECK (role IN ('user','assistant')),
  text                TEXT NOT NULL,
  citations_json      TEXT,
  routing_json        TEXT,
  embedding_model_id  TEXT,
  retrieval_strategy  TEXT,
  total_cost_usd      REAL NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL
);
CREATE INDEX idx_rag_turn_thread_ord ON rag_turn(thread_id, ord);

CREATE TABLE person (
  id                TEXT PRIMARY KEY,
  canonical_email   TEXT UNIQUE,
  display_name      TEXT NOT NULL,
  first_seen_at     TEXT NOT NULL,
  last_seen_at      TEXT NOT NULL,
  observed_count    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE person_alias (
  person_id   TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  alias       TEXT NOT NULL,
  alias_kind  TEXT NOT NULL CHECK (alias_kind IN ('email','displayname','shortname')),
  seen_count  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (person_id, alias, alias_kind)
);
CREATE INDEX idx_person_alias_alias ON person_alias(alias COLLATE NOCASE);

PRAGMA user_version = 126;
`,
  },
  {
    version: 127,
    file: '127_rag_source_dirty_dedupe.sql',
    sql: `
-- Phase 7 UAT Gap 8 — \`rag_source_dirty\` dedupe fix.
--
-- The original PK in 126_rag_index.sql includes \`target_model_id\` which is
-- nullable. SQLite treats NULLs as distinct in PRIMARY KEY / UNIQUE
-- constraints, so \`INSERT OR IGNORE\` against the default-enqueue path
-- (\`target_model_id IS NULL\`) was inserting duplicate rows on every
-- backfill / re-enqueue. That broke seedBackfill resumability and let the
-- worker double-process the same source.
--
-- Fix: rebuild the table without the multi-column PK on the nullable column
-- and add a UNIQUE INDEX that COALESCEs target_model_id to '' for the
-- uniqueness check. NULL semantics are preserved everywhere else
-- (discriminator queries \`target_model_id IS NULL\` still work — we only
-- collapse NULLs for dedup).

CREATE TABLE rag_source_dirty_new (
  source_kind     TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  target_model_id TEXT,
  enqueued_at     TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0
);

INSERT INTO rag_source_dirty_new (source_kind, source_id, target_model_id, enqueued_at, attempts)
SELECT source_kind, source_id, target_model_id, enqueued_at, attempts
  FROM rag_source_dirty;

DROP TABLE rag_source_dirty;

ALTER TABLE rag_source_dirty_new RENAME TO rag_source_dirty;

CREATE UNIQUE INDEX uniq_rag_source_dirty_dedupe
  ON rag_source_dirty (source_kind, source_id, COALESCE(target_model_id, ''));

CREATE INDEX idx_rag_source_dirty_enq ON rag_source_dirty(enqueued_at);

PRAGMA user_version = 127;
`,
  },
  {
    version: 128,
    file: '128_phase8_insights.sql',
    sql: `
-- Phase 8 Stream 1 — insights table for nightly aggregates.

CREATE TABLE insights (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT    NOT NULL CHECK (kind IN (
                  'calendar_load',
                  'response_time',
                  'recurring_themes',
                  'approval_edits'
                )),
  week_ymd      TEXT    NOT NULL,
  computed_at   TEXT    NOT NULL,
  payload_json  TEXT    NOT NULL,
  dismissed     INTEGER NOT NULL DEFAULT 0 CHECK (dismissed IN (0,1))
);

CREATE UNIQUE INDEX uniq_insights_kind_week ON insights(kind, week_ymd);
CREATE INDEX idx_insights_week ON insights(week_ymd DESC);

PRAGMA user_version = 128;
`,
  },
  {
    version: 129,
    file: '129_phase8_recap.sql',
    sql: `
-- Phase 8 Stream 2 — Weekly Recap.
-- VIEW action_audit_log + weekly_recap + weekly_recap_section_edit.

CREATE VIEW action_audit_log AS

  SELECT
    'email_send'                                    AS kind,
    sl.id                                           AS row_id,
    sl.ts                                           AS occurred_at,
    sl.provider                                     AS provider,
    'email'                                         AS resource,
    sl.approval_id                                  AS approval_id,
    json_object(
      'recipients',     json(sl.recipients_json),
      'subject',        sl.subject,
      'ok',             sl.ok,
      'error',          sl.error,
      'providerMsgId',  sl.provider_msg_id
    )                                               AS payload_json,
    CASE WHEN sl.ok = 1 THEN 'sent' ELSE 'failed' END AS outcome
  FROM send_log sl

  UNION ALL

  SELECT
    'calendar_change'                               AS kind,
    cal.id                                          AS row_id,
    cal.created_at                                  AS occurred_at,
    'google'                                        AS provider,
    'calendar'                                      AS resource,
    cal.approval_id                                 AS approval_id,
    json_object(
      'phase',          cal.phase,
      'eventId',        cal.event_id,
      'recurringScope', cal.recurring_scope,
      'before',         json(cal.before_json),
      'after',          json(cal.after_json),
      'googleEtag',     cal.google_etag,
      'error',          cal.google_error
    )                                               AS payload_json,
    CASE
      WHEN cal.phase = 'post_write' THEN 'applied'
      WHEN cal.phase = 'override'   THEN 'override'
      ELSE 'failed'
    END                                             AS outcome
  FROM calendar_action_log cal
  WHERE cal.phase IN ('post_write','failed','override')

  UNION ALL

  SELECT
    'task_pushed'                                   AS kind,
    mal.action_id                                   AS row_id,
    mal.created_at                                  AS occurred_at,
    'todoist'                                       AS provider,
    'tasks'                                         AS resource,
    NULL                                            AS approval_id,
    json_object(
      'taskId',         mal.task_id,
      'remoteId',       mal.remote_id,
      'content',        tt.content,
      'projectName',    tt.project_name
    )                                               AS payload_json,
    CASE WHEN tt.is_completed = 1 THEN 'completed' ELSE 'pushed' END AS outcome
  FROM meeting_action_task_link mal
  JOIN todoist_task tt ON tt.id = mal.task_id

  UNION ALL

  SELECT
    'approval_declined'                             AS kind,
    a.id                                            AS row_id,
    a.updated_at                                    AS occurred_at,
    NULL                                            AS provider,
    a.kind                                          AS resource,
    a.id                                            AS approval_id,
    json_object(
      'rejectionReason', a.rejection_reason,
      'subject',         a.subject
    )                                               AS payload_json,
    'declined'                                      AS outcome
  FROM approval a
  WHERE a.state = 'rejected'
;

CREATE TABLE weekly_recap (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  iso_week        TEXT    NOT NULL UNIQUE,
  week_start_ymd  TEXT    NOT NULL,
  generated_at    TEXT    NOT NULL,
  finalized_at    TEXT,
  canonical_json  TEXT    NOT NULL
);

CREATE INDEX idx_weekly_recap_week_start ON weekly_recap(week_start_ymd DESC);

CREATE TABLE weekly_recap_section_edit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  recap_id    INTEGER NOT NULL REFERENCES weekly_recap(id) ON DELETE CASCADE,
  section_key TEXT    NOT NULL,
  before_text TEXT    NOT NULL,
  after_text  TEXT    NOT NULL,
  category    TEXT,
  created_at  TEXT    NOT NULL
);

CREATE INDEX idx_weekly_recap_section_edit_recap ON weekly_recap_section_edit(recap_id);

PRAGMA user_version = 129;
`,
  },
];
