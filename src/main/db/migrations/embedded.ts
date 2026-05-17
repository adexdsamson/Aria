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
];
