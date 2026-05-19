import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import { ingestTranscriptNote, getTranscriptNote } from '../../../../src/main/transcripts/ingest';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
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
      timestamp_sec REAL
    );
    CREATE TABLE calendar_event (
      id TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      start_at_utc TEXT,
      attendees TEXT NOT NULL DEFAULT '[]',
      provider_key TEXT,
      account_id TEXT
    );
  `);
  return db;
}

describe('ingestTranscriptNote', () => {
  it('persists a normalized note and segments', () => {
    const db = makeDb();
    const result = ingestTranscriptNote(db, {
      sourceKind: 'paste',
      title: 'Standalone',
      text: 'Alice: I will send notes.',
      ingestedAt: '2026-05-19T10:00:00.000Z',
    });

    const note = getTranscriptNote(db, result.noteId);
    expect(note?.title).toBe('Standalone');
    expect(note?.status).toBe('standalone');
    expect(note?.segments).toHaveLength(1);
    db.close();
  });

  it('links a high-confidence calendar event', () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO calendar_event (id, summary, start_at_utc, attendees, provider_key, account_id)
       VALUES ('ev1', 'Board review', '2026-05-19T10:00:00.000Z', '[]', 'microsoft', 'boss@example.com')`,
    ).run();
    const result = ingestTranscriptNote(db, {
      sourceKind: 'paste',
      title: 'Board review',
      text: 'We discussed the board review.',
      ingestedAt: '2026-05-19T10:05:00.000Z',
    });

    expect(result.linkedEvent?.calendarEventId).toBe('ev1');
    expect(getTranscriptNote(db, result.noteId)?.status).toBe('linked');
    db.close();
  });
});
