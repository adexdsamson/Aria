import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import { CHANNELS, type TranscriptSourceKind } from '../../shared/ipc-contract';
import type { DbHolder } from './onboarding';
import {
  getTranscriptNote,
  ingestTranscriptNote,
  linkTranscriptNoteToEvent,
  listTranscriptNotes,
} from '../transcripts/ingest';
import { createTaskBatchApprovalForNote } from '../transcripts/post-ingest';

export interface TranscriptHandlerDeps {
  logger: Logger;
  dbHolder: DbHolder;
}

export function registerTranscriptHandlers(ipcMain: IpcMain, deps: TranscriptHandlerDeps): void {
  const { dbHolder, logger } = deps;

  ipcMain.handle(CHANNELS.TRANSCRIPT_INGEST, async (_event, req: {
    sourceKind: TranscriptSourceKind;
    text: string;
    title?: string;
  }) => {
    const db = dbHolder.db;
    if (!db) return { error: 'db-locked' } as const;
    try {
      const result = ingestTranscriptNote(db, req);
      const approval = createTaskBatchApprovalForNote(db, result.noteId);
      return { ...result, taskBatchApprovalId: approval.approvalId, actionCount: approval.actionCount };
    } catch (err) {
      logger.warn({ scope: 'transcripts', err: err instanceof Error ? err.message : String(err) }, 'transcript ingest failed');
      return { error: err instanceof Error ? err.message : String(err) } as const;
    }
  });

  ipcMain.handle(CHANNELS.TRANSCRIPT_GET_NOTE, async (_event, req: { noteId: string }) => {
    const db = dbHolder.db;
    if (!db) return { error: 'db-locked' } as const;
    return { note: getTranscriptNote(db, req.noteId) } as const;
  });

  ipcMain.handle(CHANNELS.TRANSCRIPT_LIST_NOTES, async () => {
    const db = dbHolder.db;
    if (!db) return { error: 'db-locked' } as const;
    return { rows: listTranscriptNotes(db) } as const;
  });

  ipcMain.handle(CHANNELS.TRANSCRIPT_LINK_EVENT, async (_event, req: {
    noteId: string;
    providerKey: 'google' | 'microsoft';
    accountId: string;
    calendarEventId: string;
  }) => {
    const db = dbHolder.db;
    if (!db) return { error: 'db-locked' } as const;
    linkTranscriptNoteToEvent(db, req);
    return { ok: true } as const;
  });

  ipcMain.handle(CHANNELS.TRANSCRIPT_GET_REVIEW, async (_event, req: { noteId: string }) => {
    const db = dbHolder.db;
    if (!db) return { error: 'db-locked' } as const;
    const note = getTranscriptNote(db, req.noteId);
    const summaryItems = db.prepare(
      `SELECT id,
              kind,
              text,
              citation_start as citationStart,
              citation_end as citationEnd,
              ordinal
         FROM meeting_summary_item
        WHERE note_id = ?
        ORDER BY kind ASC, ordinal ASC`,
    ).all(req.noteId);
    const actions = db.prepare(
      `SELECT id,
              note_id as noteId,
              approval_id as approvalId,
              text,
              owner,
              follow_up_with as followUpWith,
              due_iso as dueIso,
              due_raw as dueRaw,
              due_confidence as dueConfidence,
              priority_hint as priorityHint,
              citation_start as citationStart,
              citation_end as citationEnd,
              confidence,
              status,
              pushable
         FROM meeting_action
        WHERE note_id = ?
        ORDER BY created_at ASC`,
    ).all(req.noteId);
    return { note, summaryItems, actions } as const;
  });
}
