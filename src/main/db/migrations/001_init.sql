-- Plan 02 Task 2 — initial Aria schema.
--
-- Tables:
--   app_meta     — single-row key/value app metadata (schema_created_at, etc.)
--   settings     — user-tunable string settings (theme, briefing time, etc.)
--   routing_log  — Plan 04 LLM-routing audit trail; pre-created here so Plan 04
--                  has no schema work of its own.

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
