import { beforeEach, describe, expect, it } from 'vitest';
import * as crypto from 'node:crypto';
import { createTempUserDataDir } from '../../../../setup';
import { openDb, closeDb } from '../../../../../src/main/db/connect';
import { syncTodoistTasks } from '../../../../../src/main/integrations/todoist/sync-tasks';

describe('syncTodoistTasks', () => {
  let dataDir: string;
  let dbKey: Buffer;

  beforeEach(() => {
    dataDir = createTempUserDataDir('aria-todoist-sync');
    dbKey = crypto.randomBytes(32);
  });

  it('pulls Todoist tasks into local task table and records sync state', async () => {
    const db = openDb({ dataDir, dbKey });
    db.prepare(
      `INSERT INTO provider_account (
         account_id, provider_key, display_email, status, capabilities_json, last_error, last_error_at
       )
       VALUES ('default', 'todoist', 'Todoist', 'degraded', '{"tasks":true}', 'tasks.map is not a function', '2026-05-19T09:00:00.000Z')`,
    ).run();
    const result = await syncTodoistTasks({
      db,
      client: {
        validateToken: async () => ({ ok: true }),
        createTask: async () => ({ externalId: 'unused' }),
        listTasks: async () => [{
          externalId: 'r1',
          content: 'Review deck',
          labels: ['exec'],
          priority: 3,
          isCompleted: false,
          dueIso: '2026-05-20',
        }],
      },
      now: new Date('2026-05-19T10:00:00.000Z'),
    });

    expect(result).toEqual({ ok: true, count: 1, hadFullResync: true });
    expect(db.prepare('SELECT remote_id, content, source FROM todoist_task').get()).toMatchObject({
      remote_id: 'r1',
      content: 'Review deck',
      source: 'todoist',
    });
    expect(db.prepare('SELECT resource FROM provider_sync_state WHERE provider_key = ?').get('todoist')).toMatchObject({
      resource: 'tasks',
    });
    expect(db.prepare("SELECT status, last_error, last_synced_at FROM provider_account WHERE provider_key = 'todoist'").get()).toMatchObject({
      status: 'ok',
      last_error: null,
      last_synced_at: '2026-05-19T10:00:00.000Z',
    });
    closeDb(db);
  });
});
