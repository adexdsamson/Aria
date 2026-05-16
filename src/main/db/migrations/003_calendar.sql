-- Plan 02-02 — Calendar ingest schema.
--
-- Tables:
--   calendar_account  — singleton (id=1) holding the connected calendar's
--                       email, calendar_id (default 'primary'), the current
--                       sync_token cursor, last_synced_at, last_error,
--                       connected_at. NO refresh token here — those live in
--                       safeStorage.googleTokens (T-02-02-01, reuses Plan 02-01).
--   calendar_event    — metadata-only mirror of recent calendar events. Holds
--                       BOTH start_at_utc (timed events) and start_date
--                       (YYYY-MM-DD all-day events). CHECK constraint enforces
--                       exactly-one-not-null. start_timezone preserves
--                       event.start.timeZone for forward-compat (XCUT-07).
--
-- Indices:
--   idx_calendar_event_start       — timed-event lookups for today's briefing
--   idx_calendar_event_start_date  — all-day-event lookups for today's briefing

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
