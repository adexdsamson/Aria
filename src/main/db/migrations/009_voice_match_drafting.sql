-- Plan 03-04 — Voice-match holdout + drafting metadata + send_log.
--
-- (1) `voice_match_holdout` — the 50 stratified sent-message IDs sampled for
--     the voice-match eval. The drafting agent (Plan 03-04 Task 3) must
--     EXCLUDE these IDs from any few-shot exemplar pool to keep the eval
--     unpolluted on every re-run.
--
-- (2) Add `approval.beta_voice` column UNCONDITIONALLY. Default 0. The
--     drafting agent sets this to 1 only when the Task 2 checkpoint decision
--     in 03-04-SPIKE-VOICE-MATCH.md selected `few-shot-beta` (i.e. neither
--     approach passed the bar so we ship few-shot with a visible "beta voice"
--     label). When 1, the ApprovalCard renders a small "Beta voice" chip.
--
-- (3) `send_log` — append-only audit row written by `sendApprovedEmail` on
--     every send attempt (ok=1 success path or ok=0 failure path). The
--     persist.writeSendLog helper landed dormant in Plan 03-01; this
--     migration creates the table so the helper becomes live.

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
