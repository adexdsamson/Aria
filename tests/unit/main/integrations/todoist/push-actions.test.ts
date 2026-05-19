import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as crypto from 'node:crypto';
import { createTempUserDataDir } from '../../../../setup';
import { openDb, closeDb } from '../../../../../src/main/db/connect';
import { pushApprovedMeetingActions } from '../../../../../src/main/integrations/todoist/push-actions';

describe('pushApprovedMeetingActions', () => {
  let dataDir: string;
  let dbKey: Buffer;

  beforeEach(() => {
    dataDir = createTempUserDataDir('aria-todoist-push');
    dbKey = crypto.randomBytes(32);
  });

  it('creates one Todoist task per approved meeting action and is idempotent', async () => {
    const db = openDb({ dataDir, dbKey });
    const now = '2026-05-19T10:00:00.000Z';
    db.prepare(`INSERT INTO meeting_note (id, source_kind, title, normalized_text, ingested_at) VALUES ('note-1','paste','Sync','Alice will send deck tomorrow.',?)`).run(now);
    db.prepare(`INSERT INTO approval (id, kind, state, created_at, updated_at, idempotency_key, meeting_note_id) VALUES ('appr-1','task_batch','approved',?,?, 'idem', 'note-1')`).run(now, now);
    db.prepare(
      `INSERT INTO meeting_action (
         id, note_id, approval_id, text, owner, due_iso, due_confidence, priority_hint,
         citation_start, citation_end, confidence, status, pushable, created_at, updated_at
       )
       VALUES ('act-1','note-1','appr-1','Send deck','self','2026-05-20','high','p1',0,29,0.9,'approved',1,?,?)`,
    ).run(now, now);
    const createTask = vi.fn(async () => ({ externalId: 'remote-1' }));

    const result = await pushApprovedMeetingActions({
      db,
      approvalId: 'appr-1',
      client: { validateToken: async () => ({ ok: true }), listTasks: async () => [], createTask },
      now: new Date(now),
    });
    const second = await pushApprovedMeetingActions({
      db,
      approvalId: 'appr-1',
      client: { validateToken: async () => ({ ok: true }), listTasks: async () => [], createTask },
      now: new Date(now),
    });

    expect(result).toEqual({ ok: true, pushed: 1, skipped: 0 });
    expect(second).toEqual({ ok: true, pushed: 0, skipped: 0 });
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(createTask.mock.calls[0]![0]).toMatchObject({
      content: 'Send deck',
      dueIso: '2026-05-20',
      priority: 4,
      labels: ['from-meeting'],
    });
    expect(db.prepare('SELECT status FROM meeting_action WHERE id = ?').get('act-1')).toMatchObject({ status: 'pushed' });
    closeDb(db);
  });
});
