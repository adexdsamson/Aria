import * as crypto from 'node:crypto';
import type Database from 'better-sqlite3-multiple-ciphers';
import { assertApproved } from '../../approvals/gate';
import type { TodoistClient } from './client';

interface ActionRow {
  id: string;
  note_id: string;
  text: string;
  due_iso: string | null;
  due_confidence: 'high' | 'med' | 'low' | null;
  priority_hint: 'p1' | 'p2' | 'p3' | 'p4' | null;
  citation_start: number;
  citation_end: number;
  normalized_text: string;
}

export interface PushApprovedActionsResult {
  ok: true;
  pushed: number;
  skipped: number;
}

export async function pushApprovedMeetingActions(opts: {
  db: Database.Database;
  approvalId: string;
  client: TodoistClient;
  now?: Date;
}): Promise<PushApprovedActionsResult> {
  const { db, approvalId, client } = opts;
  assertApproved(db, approvalId);
  const nowIso = (opts.now ?? new Date()).toISOString();
  const rows = db.prepare(
    `SELECT a.id, a.note_id, a.text, a.due_iso, a.due_confidence, a.priority_hint,
            a.citation_start, a.citation_end, n.normalized_text
       FROM meeting_action a
       JOIN meeting_note n ON n.id = a.note_id
      WHERE a.approval_id = ?
        AND a.pushable = 1
        AND a.status IN ('draft','approved','failed')`,
  ).all(approvalId) as ActionRow[];

  let pushed = 0;
  let skipped = 0;
  for (const row of rows) {
    const existing = db.prepare('SELECT remote_id FROM meeting_action_task_link WHERE action_id = ?').get(row.id);
    if (existing) {
      skipped += 1;
      continue;
    }

    const idempotencyKey = stableIdempotencyKey(approvalId, row.id);
    const quote = row.normalized_text.slice(row.citation_start, row.citation_end).trim();
    const description = [
      `Created by Aria from meeting note ${row.note_id}.`,
      `Deep link: aria://notes/${row.note_id}#${row.citation_start}-${row.citation_end}`,
      quote ? `Cited quote: "${quote}"` : '',
    ].filter(Boolean).join('\n\n');

    try {
      const result = await client.createTask(
        {
          content: row.text,
          description,
          dueIso: row.due_confidence === 'high' ? row.due_iso ?? undefined : undefined,
          priority: mapPriority(row.priority_hint),
          labels: ['from-meeting'],
        },
        { idempotencyKey },
      );

      const taskId = `todoist:${result.externalId}`;
      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO todoist_task (
             id, remote_id, content, description, labels_json, due_iso, priority,
             is_completed, source, meeting_action_id, note_id, local_updated_at
           )
           VALUES (
             @taskId, @remoteId, @content, @description, '["from-meeting"]', @dueIso,
             @priority, 0, 'aria', @actionId, @noteId, @nowIso
           )
           ON CONFLICT(remote_id) DO UPDATE SET
             content = excluded.content,
             description = excluded.description,
             labels_json = excluded.labels_json,
             due_iso = excluded.due_iso,
             priority = excluded.priority,
             source = 'aria',
             meeting_action_id = excluded.meeting_action_id,
             note_id = excluded.note_id,
             local_updated_at = excluded.local_updated_at,
             last_error = NULL`,
        ).run({
          taskId,
          remoteId: result.externalId,
          content: row.text,
          description,
          dueIso: row.due_confidence === 'high' ? row.due_iso : null,
          priority: mapPriority(row.priority_hint),
          actionId: row.id,
          noteId: row.note_id,
          nowIso,
        });
        db.prepare(
          `INSERT INTO meeting_action_task_link (action_id, task_id, remote_id, idempotency_key, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(row.id, taskId, result.externalId, idempotencyKey, nowIso);
        db.prepare(
          `UPDATE meeting_action
              SET status = 'pushed', updated_at = ?
            WHERE id = ?`,
        ).run(nowIso, row.id);
        db.prepare(
          `UPDATE approval
              SET state = 'sent', sent_at = ?, updated_at = ?, last_error_message = NULL
            WHERE id = ?`,
        ).run(nowIso, nowIso, approvalId);
      });
      tx();
      pushed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      db.prepare(
        `UPDATE meeting_action
            SET status = 'failed', updated_at = ?
          WHERE id = ?`,
      ).run(nowIso, row.id);
      db.prepare(
        `UPDATE approval
            SET state = 'approved', updated_at = ?, last_error_message = ?
          WHERE id = ?`,
      ).run(nowIso, message, approvalId);
      throw err;
    }
  }

  return { ok: true, pushed, skipped };
}

function stableIdempotencyKey(approvalId: string, actionId: string): string {
  return crypto.createHash('sha256').update(`todoist:${approvalId}:${actionId}`).digest('hex');
}

function mapPriority(priority: ActionRow['priority_hint']): number {
  if (priority === 'p1') return 4;
  if (priority === 'p2') return 3;
  if (priority === 'p3') return 2;
  return 1;
}
