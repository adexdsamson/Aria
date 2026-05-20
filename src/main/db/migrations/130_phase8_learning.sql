-- Phase 8 Stream 3 — Preference learning + briefing/QA feedback.
--
-- Own dedicated migration per peer-review H-1 (round 2): each Phase-8 stream
-- owns its own migration file. Migration runner tracks user_version so dev
-- re-runs of prior streams do not silently skip 130.
--
-- Tables:
--   learning_signals      — append-only signal log (4 sources)
--   learned_preferences   — single-row typed prefs payload (id CHECK = 1)
--   briefing_feedback     — per-section thumbs + dismiss persistence
--
-- Column on existing table:
--   rag_turn.thumb        — Phase 7 turn-level thumb (-1, 0, 1)

CREATE TABLE learning_signals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source       TEXT    NOT NULL CHECK (source IN ('approval','briefing','recap','qa')),
  kind         TEXT    NOT NULL,
  payload_json TEXT    NOT NULL DEFAULT '{}',
  occurred_at  TEXT    NOT NULL
);

CREATE INDEX idx_learning_signals_occurred ON learning_signals(occurred_at DESC);
CREATE INDEX idx_learning_signals_source_occ ON learning_signals(source, occurred_at DESC);

CREATE TABLE learned_preferences (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  payload_json TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);

CREATE TABLE briefing_feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  briefing_id TEXT    NOT NULL,
  section_key TEXT    NOT NULL,
  thumb       INTEGER NOT NULL CHECK (thumb IN (-1, 0, 1)),
  created_at  TEXT    NOT NULL
);

CREATE INDEX idx_briefing_feedback_briefing ON briefing_feedback(briefing_id);

ALTER TABLE rag_turn ADD COLUMN thumb INTEGER NOT NULL DEFAULT 0;

PRAGMA user_version = 130;
