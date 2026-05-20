-- 128_phase8_insights.sql
-- Phase 8 Stream 1 — insights table for nightly aggregates.
--
-- Stream 1 OWNS this migration. Streams 2 (weekly recap) and 3 (learning)
-- each own their own migration file (129, 130) per peer-review H-1 round 2 —
-- so the runner's user_version tracking handles dev-machine re-runs without
-- silently skipping schema for streams that landed later.
--
-- Storage shape:
--   - One row per (kind, week_ymd). Unique index supports ON CONFLICT upsert
--     from the aggregate orchestrator.
--   - payload_json holds the typed InsightPayload (see src/main/insights/schema.ts):
--     numeric/structural aggregates + theme LABELS only, NEVER raw content.
--   - dismissed=1 hides a row from the briefing read path without deleting it
--     (Stream 3 backfill replays user dismissals into briefing_feedback).

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
