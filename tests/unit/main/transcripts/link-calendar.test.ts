import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import { bestCalendarLink } from '../../../../src/main/transcripts/link-calendar';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
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

describe('calendar transcript linking', () => {
  it('selects a high-confidence nearby event by title match', () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO calendar_event (id, summary, start_at_utc, attendees, provider_key, account_id)
       VALUES ('ev1', 'Board deck review', '2026-05-19T10:00:00.000Z', '[]', 'google', 'me@example.com')`,
    ).run();

    const result = bestCalendarLink(db, {
      title: 'Board deck review transcript',
      normalizedText: 'Alice said she will send the board deck.',
      ingestedAt: '2026-05-19T10:10:00.000Z',
    });

    expect(result.selected?.calendarEventId).toBe('ev1');
    db.close();
  });

  it('leaves low-confidence events unselected', () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO calendar_event (id, summary, start_at_utc, attendees, provider_key, account_id)
       VALUES ('ev1', 'Finance sync', '2026-05-19T10:00:00.000Z', '[]', 'google', 'me@example.com')`,
    ).run();

    const result = bestCalendarLink(db, {
      title: 'Marketing launch',
      normalizedText: 'Brand campaign and launch notes.',
      ingestedAt: '2026-05-19T10:10:00.000Z',
    });

    expect(result.selected).toBeNull();
    expect(result.candidates).toHaveLength(1);
    db.close();
  });
});
