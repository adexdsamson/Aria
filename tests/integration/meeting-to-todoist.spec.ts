import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as crypto from 'node:crypto';
import { createTempUserDataDir } from '../setup';
import { openDb, closeDb } from '../../src/main/db/connect';
import { ingestTranscriptNote } from '../../src/main/transcripts/ingest';
import { pushApprovedMeetingActions } from '../../src/main/integrations/todoist/push-actions';

describe('Phase 6 integration: meeting note to Todoist task', () => {
  let dataDir: string;
  let dbKey: Buffer;

  beforeEach(() => {
    dataDir = createTempUserDataDir('aria-phase6-integration');
    dbKey = crypto.randomBytes(32);
  });

  it('persists a pasted transcript, pushes approved action once, and stores task with citation link', async () => {
    const db = openDb({ dataDir, dbKey });
    const transcript = 'Alice: I will send the QBR deck tomorrow.\nBob: Great, thanks.';
    const result = ingestTranscriptNote(db, {
      sourceKind: 'paste',
      title: 'QBR prep',
      text: transcript,
      ingestedAt: '2026-05-19T10:00:00.000Z',
    });
    const note = db.prepare('SELECT id, normalized_text FROM meeting_note WHERE id = ?').get(result.noteId) as {
      id: string;
      normalized_text: string;
    };
    const citationStart = note.normalized_text.indexOf('I will send');
    const citationEnd = note.normalized_text.indexOf(' tomorrow') + ' tomorrow'.length;

    db.prepare(
      `INSERT INTO approval (id, kind, state, created_at, updated_at, idempotency_key, meeting_note_id)
       VALUES ('approval-1', 'task_batch', 'approved', '2026-05-19T10:01:00.000Z',
               '2026-05-19T10:01:00.000Z', 'approval-idem-1', @noteId)`,
    ).run({ noteId: result.noteId });
    db.prepare(
      `INSERT INTO meeting_action (
         id, note_id, approval_id, text, owner, due_iso, due_raw, due_confidence,
         priority_hint, citation_start, citation_end, confidence, status, pushable,
         created_at, updated_at
       )
       VALUES (
         'action-1', @noteId, 'approval-1', 'Send the QBR deck', 'self', '2026-05-20',
         'tomorrow', 'high', 'p1', @citationStart, @citationEnd, 0.94,
         'approved', 1, '2026-05-19T10:01:00.000Z', '2026-05-19T10:01:00.000Z'
       )`,
    ).run({ noteId: result.noteId, citationStart, citationEnd });

    const createTask = vi.fn(async () => ({ externalId: 'todoist-remote-1' }));
    const push = await pushApprovedMeetingActions({
      db,
      approvalId: 'approval-1',
      client: {
        validateToken: async () => ({ ok: true }),
        listTasks: async () => [],
        createTask,
      },
      now: new Date('2026-05-19T10:02:00.000Z'),
    });

    expect(push).toEqual({ ok: true, pushed: 1, skipped: 0 });
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(createTask.mock.calls[0]![0]).toMatchObject({
      content: 'Send the QBR deck',
      dueIso: '2026-05-20',
      priority: 4,
      labels: ['from-meeting'],
    });
    expect(createTask.mock.calls[0]![0].description).toContain(`aria://notes/${result.noteId}#`);
    expect(createTask.mock.calls[0]![0].description).toContain('I will send the QBR deck tomorrow');

    const task = db.prepare(
      `SELECT remote_id, content, source, note_id, meeting_action_id, due_iso, priority
         FROM todoist_task
        WHERE remote_id = 'todoist-remote-1'`,
    ).get() as {
      remote_id: string;
      content: string;
      source: string;
      note_id: string;
      meeting_action_id: string;
      due_iso: string;
      priority: number;
    };
    expect(task).toMatchObject({
      remote_id: 'todoist-remote-1',
      content: 'Send the QBR deck',
      source: 'aria',
      note_id: result.noteId,
      meeting_action_id: 'action-1',
      due_iso: '2026-05-20',
      priority: 4,
    });
    expect(db.prepare('SELECT state FROM approval WHERE id = ?').get('approval-1')).toMatchObject({ state: 'sent' });

    closeDb(db);
  });
});
