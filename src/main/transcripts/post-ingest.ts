import * as crypto from 'node:crypto';
import type Database from 'better-sqlite3-multiple-ciphers';
import { insertApproval } from '../approvals/persist';

type Db = Database.Database;

interface NoteRow {
  id: string;
  title: string;
  normalized_text: string;
  ingested_at: string;
}

interface LocalAction {
  id: string;
  text: string;
  owner: 'self';
  dueIso: string | null;
  dueRaw: string | null;
  dueConfidence: 'high' | null;
  priorityHint: 'p2';
  citationStart: number;
  citationEnd: number;
  confidence: number;
}

export function createTaskBatchApprovalForNote(db: Db, noteId: string): { approvalId: string | null; actionCount: number } {
  const note = db.prepare(
    `SELECT id, title, normalized_text, ingested_at
       FROM meeting_note
      WHERE id = ?`,
  ).get(noteId) as NoteRow | undefined;
  if (!note) return { approvalId: null, actionCount: 0 };

  const actions = extractLocalCommitments(note);
  if (actions.length === 0) return { approvalId: null, actionCount: 0 };

  const existing = db.prepare(
    `SELECT id FROM approval
      WHERE kind = 'task_batch'
        AND meeting_note_id = ?
      LIMIT 1`,
  ).get(noteId) as { id: string } | undefined;
  if (existing) return { approvalId: existing.id, actionCount: actions.length };

  const approvalId = insertApproval(db, {
    kind: 'task_batch',
    state: 'ready',
    subject: `Meeting actions: ${note.title}`,
    body_original: JSON.stringify(actions),
    meeting_note_id: note.id,
    routed: 'local',
    classifier_version: 'local-commitment-v1',
    classifier_rationale: 'Detected first-person meeting commitment in pasted transcript.',
    confidence: Math.max(...actions.map((action) => action.confidence)),
  });

  const nowIso = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT OR REPLACE INTO meeting_summary (note_id, generated_at, route, model, notes)
       VALUES (?, ?, 'LOCAL', 'local-commitment-v1', ?)`,
    ).run(note.id, nowIso, 'Local fallback extracted first-person commitments.');

    const summaryStmt = db.prepare(
      `INSERT INTO meeting_summary_item (
         id, note_id, kind, text, citation_start, citation_end, ordinal
       )
       VALUES (?, ?, 'follow_up', ?, ?, ?, ?)`,
    );
    const actionStmt = db.prepare(
      `INSERT INTO meeting_action (
         id, note_id, approval_id, text, owner, due_iso, due_raw, due_confidence,
         priority_hint, citation_start, citation_end, confidence, status, pushable,
         created_at, updated_at
       )
       VALUES (
         @id, @noteId, @approvalId, @text, @owner, @dueIso, @dueRaw, @dueConfidence,
         @priorityHint, @citationStart, @citationEnd, @confidence, 'draft', 1,
         @createdAt, @updatedAt
       )`,
    );

    actions.forEach((action, index) => {
      summaryStmt.run(
        crypto.randomUUID(),
        note.id,
        action.text,
        action.citationStart,
        action.citationEnd,
        index,
      );
      actionStmt.run({
        id: action.id,
        noteId: note.id,
        approvalId,
        text: action.text,
        owner: action.owner,
        dueIso: action.dueIso,
        dueRaw: action.dueRaw,
        dueConfidence: action.dueConfidence,
        priorityHint: action.priorityHint,
        citationStart: action.citationStart,
        citationEnd: action.citationEnd,
        confidence: action.confidence,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    });
  });
  tx();

  return { approvalId, actionCount: actions.length };
}

function extractLocalCommitments(note: NoteRow): LocalAction[] {
  const text = note.normalized_text;
  const matches = [...text.matchAll(/\bI will\s+([^.\n]+?)(\s+tomorrow)?[.\n]/gi)];
  return matches.map((match) => {
    const start = (match.index ?? 0) + match[0].toLowerCase().indexOf('i will');
    const end = (match.index ?? 0) + match[0].trimEnd().replace(/[.]$/, '').length;
    const rawAction = match[1]!.trim();
    const hasTomorrow = Boolean(match[2]);
    return {
      id: crypto.randomUUID(),
      text: capitalize(rawAction),
      owner: 'self',
      dueIso: hasTomorrow ? addDays(note.ingested_at, 1) : null,
      dueRaw: hasTomorrow ? 'tomorrow' : null,
      dueConfidence: hasTomorrow ? 'high' : null,
      priorityHint: 'p2',
      citationStart: start,
      citationEnd: end,
      confidence: 0.82,
    };
  });
}

function capitalize(value: string): string {
  return value ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function addDays(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
