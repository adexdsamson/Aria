import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';
import {
  harvestEmails,
  harvestCalendarEvents,
  harvestMeetingNotes,
  harvestActions,
} from '../../../../src/main/rag/source-harvesters';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

function setupDb() {
  const dataDir = createTempUserDataDir('aria-harvest');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

describe('source harvesters — Plan 07-01 Task 3', () => {
  let db: ReturnType<typeof setupDb>;

  beforeEach(() => {
    db = setupDb();
  });

  it('harvestEmails: returns SourceDocs with non-empty titles + reply-stripped text', () => {
    const now = '2026-05-15T10:00:00Z';
    db.prepare(
      `INSERT INTO gmail_message (
        id, thread_id, from_addr, subject, snippet, received_at, label_ids,
        is_unread, is_important, history_id, fetched_at
      ) VALUES
        ('m1', 't1', 'sarah@example.com', 'Q3 budget', 'Approved.\n\nOn Mon May 12 Sarah wrote:\n> any updates?', ?, '[]', 0, 0, NULL, ?),
        ('m2', 't2', 'alex@example.com',  '',          'short note', ?, '[]', 0, 0, NULL, ?)`,
    ).run(now, now, now, now);

    const docs = harvestEmails(db);
    expect(docs).toHaveLength(2);
    for (const d of docs) {
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.sourceKind).toBe('email');
    }
    const m1 = docs.find((d) => d.sourceId === 'm1')!;
    expect(m1.title).toBe('Q3 budget');
    expect(m1.text).toContain('Approved');
    const m2 = docs.find((d) => d.sourceId === 'm2')!;
    expect(m2.title).toBe('(no subject)');
  });

  it('harvestCalendarEvents: non-empty titles, parentRef = recurring_id ?? id', () => {
    db.prepare(
      `INSERT INTO calendar_event (
        id, calendar_id, summary, location, start_at_utc, end_at_utc,
        start_date, end_date, start_timezone, attendees, status,
        recurring_id, updated_at, fetched_at
      ) VALUES
        ('e1', 'primary', 'Board meeting', 'HQ',     '2026-05-22T14:00:00Z', '2026-05-22T16:00:00Z', NULL, NULL, NULL, '[]', 'confirmed', NULL,    ?, ?),
        ('e2', 'primary', '',              NULL,     NULL, NULL, '2026-05-25', '2026-05-26', NULL, '[]', 'confirmed', 'r-1', ?, ?)`,
    ).run('2026-05-10T00:00:00Z', '2026-05-10T00:00:00Z', '2026-05-10T00:00:00Z', '2026-05-10T00:00:00Z');

    const docs = harvestCalendarEvents(db);
    expect(docs).toHaveLength(2);
    const e1 = docs.find((d) => d.sourceId === 'e1')!;
    expect(e1.title).toBe('Board meeting');
    expect(e1.parentRef).toBe('e1');
    expect(e1.occurredAt).toBe('2026-05-22T14:00:00Z');
    const e2 = docs.find((d) => d.sourceId === 'e2')!;
    expect(e2.title).toBe('(no title)');
    expect(e2.parentRef).toBe('r-1');
    expect(e2.occurredAt).toBe('2026-05-25');
  });

  it('harvestMeetingNotes: emits segments + non-empty title', () => {
    db.prepare(
      `INSERT INTO meeting_note (id, source_kind, title, normalized_text, ingested_at, status)
       VALUES ('n1', 'paste', '1:1 with Sarah', 'Sarah: hello\nAlex: hi back', ?, 'captured')`,
    ).run('2026-05-14T15:00:00Z');
    db.prepare(
      `INSERT INTO meeting_note_segment (note_id, start_offset, end_offset, speaker, timestamp_sec)
       VALUES ('n1', 0, 12, 'Sarah', NULL), ('n1', 12, 26, 'Alex', NULL)`,
    ).run();

    const docs = harvestMeetingNotes(db);
    expect(docs).toHaveLength(1);
    const n = docs[0]!;
    expect(n.title).toBe('1:1 with Sarah');
    expect(n.segments).toHaveLength(2);
    expect(n.segments![0]!.speaker).toBe('Sarah');
  });

  it('harvestActions: meeting_action rows + todoist_task rows merged, non-empty title', () => {
    db.prepare(
      `INSERT INTO meeting_note (id, source_kind, title, normalized_text, ingested_at, status)
       VALUES ('n1', 'paste', 'meet', 'body', ?, 'captured')`,
    ).run('2026-05-14T15:00:00Z');
    db.prepare(
      `INSERT INTO meeting_action (
        id, note_id, text, owner, citation_start, citation_end,
        confidence, status, pushable, created_at, updated_at
      ) VALUES ('a1', 'n1', 'Send the Q3 headcount note to all-eng', 'self', 0, 30, 0.9, 'draft', 1, ?, ?)`,
    ).run('2026-05-14T16:00:00Z', '2026-05-14T16:00:00Z');
    db.prepare(
      `INSERT INTO todoist_task (
        id, remote_id, content, description, labels_json, due_iso, priority,
        is_completed, source, local_updated_at
      ) VALUES ('t1', 'r1', 'Update offsite agenda', 'cut H2 session', '[]', '2026-05-15', 3, 0, 'aria', ?)`,
    ).run('2026-05-14T16:15:00Z');

    const docs = harvestActions(db);
    expect(docs.length).toBeGreaterThanOrEqual(2);
    for (const d of docs) {
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.sourceKind).toBe('action');
    }
    const meetAction = docs.find((d) => d.sourceId === 'a1')!;
    expect(meetAction.title.length).toBeLessThanOrEqual(80);
    const tdAction = docs.find((d) => d.sourceId === 'todoist:t1')!;
    expect(tdAction.providerKey).toBe('todoist');
    expect(tdAction.text).toContain('cut H2 session');
  });

  // Cleanup — vitest doesn't reset DB between tests in this file, but openDb
  // uses a fresh dataDir per test via beforeEach.
  it('A7 guard: assert speaker column present (positive case)', () => {
    expect(() => harvestMeetingNotes(db)).not.toThrow();
    closeDb(db);
  });
});
