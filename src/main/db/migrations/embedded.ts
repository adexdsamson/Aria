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
];
