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
