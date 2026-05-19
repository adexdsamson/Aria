import * as crypto from 'node:crypto';
import type Database from 'better-sqlite3-multiple-ciphers';
import { normalizeTranscript, type TranscriptSourceKind } from './normalize';
import { bestCalendarLink, type CalendarLinkCandidate } from './link-calendar';

type Db = Database.Database;

export interface IngestTranscriptInput {
  sourceKind: TranscriptSourceKind;
  text: string;
  title?: string;
  ingestedAt?: string;
}

export interface IngestTranscriptResult {
  noteId: string;
  linkedEvent: CalendarLinkCandidate | null;
  candidates: CalendarLinkCandidate[];
}

export function ingestTranscriptNote(db: Db, input: IngestTranscriptInput): IngestTranscriptResult {
  const normalized = normalizeTranscript({ sourceKind: input.sourceKind, text: input.text });
  if (!normalized.normalizedText) throw new Error('transcript-empty');
  const noteId = crypto.randomUUID();
  const ingestedAt = input.ingestedAt ?? new Date().toISOString();
  const title = input.title?.trim() || deriveTitle(normalized.normalizedText);
  const link = bestCalendarLink(db, { title, normalizedText: normalized.normalizedText, ingestedAt });
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO meeting_note (
        id, source_kind, title, normalized_text, ingested_at,
        event_provider_key, event_account_id, calendar_event_id, link_confidence, status
      ) VALUES (
        @id, @sourceKind, @title, @normalizedText, @ingestedAt,
        @eventProviderKey, @eventAccountId, @calendarEventId, @linkConfidence, @status
      )`,
    ).run({
      id: noteId,
      sourceKind: input.sourceKind,
      title,
      normalizedText: normalized.normalizedText,
      ingestedAt,
      eventProviderKey: link.selected?.providerKey ?? null,
      eventAccountId: link.selected?.accountId ?? null,
      calendarEventId: link.selected?.calendarEventId ?? null,
      linkConfidence: link.selected?.score ?? null,
      status: link.selected ? 'linked' : 'standalone',
    });
    const segmentStmt = db.prepare(
      `INSERT INTO meeting_note_segment (note_id, start_offset, end_offset, speaker, timestamp_sec)
       VALUES (@noteId, @start, @end, @speaker, @timestampSec)`,
    );
    for (const segment of normalized.segments) {
      segmentStmt.run({
        noteId,
        start: segment.start,
        end: segment.end,
        speaker: segment.speaker ?? null,
        timestampSec: segment.timestampSec ?? null,
      });
    }
  });
  tx();
  return { noteId, linkedEvent: link.selected, candidates: link.candidates };
}

export interface TranscriptNoteDto {
  id: string;
  sourceKind: TranscriptSourceKind;
  title: string;
  normalizedText: string;
  ingestedAt: string;
  eventProviderKey: 'google' | 'microsoft' | null;
  eventAccountId: string | null;
  calendarEventId: string | null;
  linkConfidence: number | null;
  status: 'captured' | 'linked' | 'standalone';
  segments: Array<{ start: number; end: number; speaker?: string | null; timestampSec?: number | null }>;
}

export function getTranscriptNote(db: Db, noteId: string): TranscriptNoteDto | null {
  const row = db.prepare(
    `SELECT id,
            source_kind as sourceKind,
            title,
            normalized_text as normalizedText,
            ingested_at as ingestedAt,
            event_provider_key as eventProviderKey,
            event_account_id as eventAccountId,
            calendar_event_id as calendarEventId,
            link_confidence as linkConfidence,
            status
       FROM meeting_note
      WHERE id = ?`,
  ).get(noteId) as Omit<TranscriptNoteDto, 'segments'> | undefined;
  if (!row) return null;
  const segments = db.prepare(
    `SELECT start_offset as start,
            end_offset as end,
            speaker,
            timestamp_sec as timestampSec
       FROM meeting_note_segment
      WHERE note_id = ?
      ORDER BY start_offset ASC`,
  ).all(noteId) as TranscriptNoteDto['segments'];
  return { ...row, segments };
}

export function listTranscriptNotes(db: Db): Array<Omit<TranscriptNoteDto, 'normalizedText' | 'segments'>> {
  return db.prepare(
    `SELECT id,
            source_kind as sourceKind,
            title,
            ingested_at as ingestedAt,
            event_provider_key as eventProviderKey,
            event_account_id as eventAccountId,
            calendar_event_id as calendarEventId,
            link_confidence as linkConfidence,
            status
       FROM meeting_note
      ORDER BY ingested_at DESC
      LIMIT 100`,
  ).all() as Array<Omit<TranscriptNoteDto, 'normalizedText' | 'segments'>>;
}

export function linkTranscriptNoteToEvent(
  db: Db,
  args: {
    noteId: string;
    providerKey: 'google' | 'microsoft';
    accountId: string;
    calendarEventId: string;
  },
): void {
  db.prepare(
    `UPDATE meeting_note
        SET event_provider_key = @providerKey,
            event_account_id = @accountId,
            calendar_event_id = @calendarEventId,
            link_confidence = 1,
            status = 'linked'
      WHERE id = @noteId`,
  ).run(args);
}

function deriveTitle(text: string): string {
  return text.split('\n')[0]!.trim().slice(0, 80) || 'Untitled meeting note';
}
