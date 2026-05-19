import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import { CHANNELS, type TaskRowDto } from '../../shared/ipc-contract';
import type { DbHolder } from './onboarding';

export interface TasksHandlerDeps {
  logger: Logger;
  dbHolder: DbHolder;
}

export function registerTasksHandlers(ipcMain: IpcMain, deps: TasksHandlerDeps): void {
  ipcMain.handle(CHANNELS.TASKS_LIST, async (_e, req: unknown) => {
    const db = deps.dbHolder.db;
    if (!db) return { error: 'DB_NOT_OPEN' };
    const source = (req as { source?: string } | undefined)?.source;
    const completed = (req as { completed?: boolean } | undefined)?.completed;
    const where: string[] = [];
    const params: unknown[] = [];
    if (source === 'todoist' || source === 'aria') {
      where.push('source = ?');
      params.push(source);
    }
    if (typeof completed === 'boolean') {
      where.push('is_completed = ?');
      params.push(completed ? 1 : 0);
    }
    const rows = db.prepare(
      `SELECT id, remote_id, content, description, project_name, labels_json, due_iso,
              priority, is_completed, source, note_id, meeting_action_id
         FROM todoist_task
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY COALESCE(due_iso, '9999-12-31') ASC, priority DESC, local_updated_at DESC`,
    ).all(...params) as Array<{
      id: string;
      remote_id: string | null;
      content: string;
      description: string | null;
      project_name: string | null;
      labels_json: string;
      due_iso: string | null;
      priority: number;
      is_completed: 0 | 1;
      source: 'todoist' | 'aria';
      note_id: string | null;
      meeting_action_id: string | null;
    }>;

    return {
      rows: rows.map((row): TaskRowDto => ({
        id: row.id,
        remoteId: row.remote_id,
        content: row.content,
        description: row.description,
        projectName: row.project_name,
        labels: safeJsonArray(row.labels_json),
        dueIso: row.due_iso,
        priority: row.priority,
        isCompleted: row.is_completed === 1,
        source: row.source,
        noteId: row.note_id,
        meetingActionId: row.meeting_action_id,
      })),
    };
  });
}

function safeJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
