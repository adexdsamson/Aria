import type Database from 'better-sqlite3-multiple-ciphers';
import type { CanonicalTask } from '../../../shared/provider';
import type { TodoistClient } from './client';

export interface TodoistSyncResult {
  ok: true;
  count: number;
  hadFullResync: boolean;
}

export async function syncTodoistTasks(opts: {
  db: Database.Database;
  client: TodoistClient;
  now?: Date;
}): Promise<TodoistSyncResult> {
  const { db, client } = opts;
  const nowIso = (opts.now ?? new Date()).toISOString();
  const tasks = await client.listTasks();

  const tx = db.transaction((rows: CanonicalTask[]) => {
    db.prepare(
      `INSERT OR IGNORE INTO provider_account (
         account_id, provider_key, display_email, status, capabilities_json, created_at
       )
       VALUES ('default', 'todoist', 'Todoist', 'ok', '{"tasks":true}', @nowIso)`,
    ).run({ nowIso });

    const upsert = db.prepare(
      `INSERT INTO todoist_task (
         id, remote_id, content, description, project_id, project_name, labels_json,
         due_iso, priority, is_completed, source, remote_updated_at, local_updated_at
       )
       VALUES (
         @id, @remoteId, @content, @description, @projectId, @projectName, @labelsJson,
         @dueIso, @priority, @isCompleted, 'todoist', @remoteUpdatedAt, @localUpdatedAt
       )
       ON CONFLICT(remote_id) DO UPDATE SET
         content = excluded.content,
         description = excluded.description,
         project_id = excluded.project_id,
         project_name = excluded.project_name,
         labels_json = excluded.labels_json,
         due_iso = excluded.due_iso,
         priority = excluded.priority,
         is_completed = excluded.is_completed,
         remote_updated_at = excluded.remote_updated_at,
         local_updated_at = excluded.local_updated_at,
         last_error = NULL`,
    );

    for (const task of rows) {
      upsert.run({
        id: `todoist:${task.externalId}`,
        remoteId: task.externalId,
        content: task.content,
        description: task.description ?? null,
        projectId: task.projectId ?? null,
        projectName: task.projectName ?? null,
        labelsJson: JSON.stringify(task.labels),
        dueIso: task.dueIso ?? null,
        priority: task.priority,
        isCompleted: task.isCompleted ? 1 : 0,
        remoteUpdatedAt: task.updatedAt ?? null,
        localUpdatedAt: nowIso,
      });
    }

    db.prepare(
      `INSERT INTO provider_sync_state (
         provider_key, account_id, resource, cursor, last_sync_at, last_error
       )
       VALUES ('todoist', 'default', 'tasks', @cursor, @nowIso, NULL)
       ON CONFLICT(provider_key, account_id, resource) DO UPDATE SET
         cursor = excluded.cursor,
         last_sync_at = excluded.last_sync_at,
         last_error = NULL`,
    ).run({ cursor: nowIso, nowIso });

    db.prepare(
      `UPDATE provider_account
          SET status = 'ok',
              last_synced_at = @nowIso,
              last_error = NULL,
              last_error_at = NULL
        WHERE provider_key = 'todoist'
          AND account_id = 'default'`,
    ).run({ nowIso });
  });

  tx(tasks);
  return { ok: true, count: tasks.length, hadFullResync: true };
}
