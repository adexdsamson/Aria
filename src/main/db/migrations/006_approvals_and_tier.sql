-- Plan 03-01: Approval Queue + Tier config (polymorphic schema).
-- All downstream-shared columns are pre-declared here so later Phase-3 plans
-- (02 sensitivity router, 03 triage, 04 voice-match drafting/send) do NOT
-- add columns to this table. send_log lives in Plan 04 migration 009.
CREATE TABLE IF NOT EXISTS approval (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('email_send')),
  state TEXT NOT NULL CHECK (state IN ('pending','generating','ready','approved','rejected','snoozed','interrupted','sent')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  -- APPR-07 belt+suspenders — every transition into 'approved' MUST record
  -- the path the user took; assertApproved enforces 'explicit' when severity
  -- is high or category is in {financial,legal,hr}.
  approval_path TEXT NOT NULL DEFAULT 'explicit' CHECK (approval_path IN ('explicit','silent')),

  -- email_send payload (NULL when kind != 'email_send'; Phase 4 adds calendar columns)
  source_message_id TEXT,
  recipients_json TEXT,
  subject TEXT,
  body_original TEXT,
  body_edited TEXT,

  -- classifier output (populated by Plan 03-02)
  classifier_version TEXT,
  categories_json TEXT,
  severity TEXT,
  confidence REAL,
  classifier_rationale TEXT,
  routed TEXT,

  -- triage rationale (populated by Plan 03-03)
  triage_signals_json TEXT,
  triage_summary TEXT,

  -- terminal states
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
