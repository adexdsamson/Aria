-- Plan 03-03 — Email triage persistence (EMAIL-03).
-- One row per gmail_message; written once, never re-written (store-once
-- immutable per CONTEXT decision). Re-classification on classifier_version
-- upgrade is explicitly deferred (CONTEXT §deferred).
CREATE TABLE email_triage (
  message_id TEXT PRIMARY KEY,               -- gmail_message.id
  classifier_version TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('urgent','needs-you','fyi','archive')),
  signals_json TEXT NOT NULL,
  summary TEXT NOT NULL,
  ts TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES gmail_message(id)
);
CREATE INDEX idx_email_triage_priority ON email_triage(priority, ts DESC);
