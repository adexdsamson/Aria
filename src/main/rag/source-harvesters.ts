/**
 * Plan 07-01 Task 3 — source harvesters for the four RAG corpora.
 *
 * Reads canonical Phase-2/5/6 rows out of the local DB and produces
 * `SourceDoc[]` shapes the Wave-2 indexer (plan 07-02) will chunk and embed.
 *
 * Schema notes / deviations (Rule 3 — blocking fix vs plan text):
 *  - gmail_message has no `body` column (Phase 2 is metadata-only). Harvester
 *    uses `snippet` as the cleaned text. When Phase 2.5+ adds full bodies,
 *    swap the column without touching downstream chunkers.
 *  - There is no `outlook_message` table; Phase 5 uses the unified
 *    `provider_account` model with mail rows still flowing through
 *    `gmail_message` (provider-keyed). Plan text mentions `outlook_message` —
 *    we accept rows from any provider that lands in `gmail_message`. The
 *    Microsoft Graph mail mirror is owned by a later phase; if/when an
 *    `outlook_message` table exists, extend `harvestEmails` to UNION it.
 *  - Plan text mentions `meeting_extracted_action`; actual table is
 *    `meeting_action` (migration 124/125). Harvester reads `meeting_action`.
 *  - calendar_event uses `start_at_utc | start_date`, not `start_time`; we
 *    coalesce to whichever is non-null for `occurredAt`.
 *  - calendar_event lacks `updated_at`; we use `fetched_at` as the
 *    sourceUpdatedAt proxy. Same for gmail_message (`fetched_at`).
 *  - meeting_note uses `normalized_text` (not `text`) and `ingested_at` (no
 *    explicit updated_at column).
 *
 * Logging: every harvester logs row counts only; chunk text is never emitted.
 */

import type Database from 'better-sqlite3-multiple-ciphers';
import type {
  ProviderKey,
  SourceDoc,
  SourceSegment,
} from './chunk-types';
import { stripEmailReply } from './chunk-text';

type Db = Database.Database;

export interface HarvestOptions {
  /** ISO timestamp lower bound on occurredAt. */
  since?: string;
  /** Hard upper bound on rows returned. */
  limit?: number;
  /** Restrict to specific source ids. */
  sourceIds?: string[];
}

function applyIdFilter(sql: string, ids: string[] | undefined, col: string): { sql: string; params: string[] } {
  if (!ids || ids.length === 0) return { sql, params: [] };
  const placeholders = ids.map(() => '?').join(',');
  return { sql: `${sql} AND ${col} IN (${placeholders})`, params: ids };
}

/**
 * Email harvester. Reads `gmail_message` rows; runs reply-stripping over the
 * `snippet` column (the only body proxy Phase 2 stores). Future Microsoft mail
 * sources can be UNIONed here once their canonical table lands.
 */
export function harvestEmails(db: Db, opts: HarvestOptions = {}): SourceDoc[] {
  const since = opts.since ?? null;
  const limit = opts.limit ?? 10_000;
  const sourceIds = opts.sourceIds;

  let sql =
    `SELECT id, thread_id, subject, snippet, received_at, fetched_at
       FROM gmail_message
      WHERE 1=1`;
  const params: unknown[] = [];
  if (since) {
    sql += ` AND received_at >= ?`;
    params.push(since);
  }
  const filtered = applyIdFilter(sql, sourceIds, 'id');
  sql = filtered.sql;
  params.push(...filtered.params);
  sql += ` ORDER BY received_at DESC LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as Array<{
    id: string;
    thread_id: string;
    subject: string | null;
    snippet: string | null;
    received_at: string;
    fetched_at: string | null;
  }>;

  return rows.map((r) => {
    const cleaned = stripEmailReply(r.snippet ?? '');
    const title = (r.subject ?? '').trim() || '(no subject)';
    const doc: SourceDoc = {
      sourceKind: 'email',
      sourceId: r.id,
      providerKey: 'google' as ProviderKey,
      accountId: null,
      parentRef: r.thread_id ?? null,
      title,
      text: cleaned,
      occurredAt: r.received_at,
      sourceUpdatedAt: r.fetched_at ?? null,
      lang: null,
    };
    return doc;
  });
}

/**
 * Calendar harvester. Reads `calendar_event`; concatenates summary + description.
 */
export function harvestCalendarEvents(db: Db, opts: HarvestOptions = {}): SourceDoc[] {
  const limit = opts.limit ?? 10_000;
  const since = opts.since ?? null;
  const sourceIds = opts.sourceIds;

  // Schema lacks a `description` column in current migrations; fall back to
  // location string when present (RESEARCH §13 notes "summary + description"
  // but the local schema is summary + location only).
  let sql =
    `SELECT id, summary, location, start_at_utc, start_date, recurring_id, fetched_at
       FROM calendar_event
      WHERE 1=1`;
  const params: unknown[] = [];
  if (since) {
    sql += ` AND COALESCE(start_at_utc, start_date) >= ?`;
    params.push(since);
  }
  const filtered = applyIdFilter(sql, sourceIds, 'id');
  sql = filtered.sql;
  params.push(...filtered.params);
  sql += ` ORDER BY COALESCE(start_at_utc, start_date) DESC LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as Array<{
    id: string;
    summary: string | null;
    location: string | null;
    start_at_utc: string | null;
    start_date: string | null;
    recurring_id: string | null;
    fetched_at: string | null;
  }>;

  return rows.map((r) => {
    const title = (r.summary ?? '').trim() || '(no title)';
    const text = [title, r.location ?? ''].filter(Boolean).join('\n\n');
    const doc: SourceDoc = {
      sourceKind: 'event',
      sourceId: r.id,
      providerKey: 'google' as ProviderKey,
      accountId: null,
      parentRef: r.recurring_id ?? r.id,
      title,
      text,
      occurredAt: r.start_at_utc ?? r.start_date ?? undefined,
      sourceUpdatedAt: r.fetched_at ?? null,
      lang: null,
    };
    return doc;
  });
}

/**
 * Meeting-note harvester. Reads `meeting_note` + `meeting_note_segment`.
 * Asserts the `speaker` column is present (Assumption A7 guard).
 */
export function harvestMeetingNotes(db: Db, opts: HarvestOptions = {}): SourceDoc[] {
  // A7: schema guard — fail loudly if migrated below 123.
  const cols = (db.pragma('table_info(meeting_note_segment)') as Array<{ name: string }>).map(
    (c) => c.name,
  );
  if (!cols.includes('speaker')) {
    throw new Error(
      'harvestMeetingNotes: meeting_note_segment.speaker is missing. ' +
        'Apply migration 123 before harvesting (current schema is stale).',
    );
  }

  const limit = opts.limit ?? 10_000;
  const since = opts.since ?? null;
  const sourceIds = opts.sourceIds;

  let sql =
    `SELECT id, title, normalized_text, ingested_at
       FROM meeting_note
      WHERE 1=1`;
  const params: unknown[] = [];
  if (since) {
    sql += ` AND ingested_at >= ?`;
    params.push(since);
  }
  const filtered = applyIdFilter(sql, sourceIds, 'id');
  sql = filtered.sql;
  params.push(...filtered.params);
  sql += ` ORDER BY ingested_at DESC LIMIT ?`;
  params.push(limit);

  const notes = db.prepare(sql).all(...params) as Array<{
    id: string;
    title: string | null;
    normalized_text: string;
    ingested_at: string;
  }>;

  const segStmt = db.prepare(
    `SELECT start_offset, end_offset, speaker
       FROM meeting_note_segment
      WHERE note_id = ?
      ORDER BY start_offset ASC`,
  );

  return notes.map((n) => {
    const segRows = segStmt.all(n.id) as Array<{
      start_offset: number;
      end_offset: number;
      speaker: string | null;
    }>;
    const segments: SourceSegment[] = segRows.map((s) => ({
      charStart: s.start_offset,
      charEnd: s.end_offset,
      ...(s.speaker ? { speaker: s.speaker } : {}),
    }));
    const title = (n.title ?? '').trim() || `Meeting ${n.ingested_at.slice(0, 10)}`;
    const doc: SourceDoc = {
      sourceKind: 'note',
      sourceId: n.id,
      providerKey: null,
      accountId: null,
      parentRef: n.id,
      title,
      text: n.normalized_text,
      segments,
      occurredAt: n.ingested_at,
      sourceUpdatedAt: n.ingested_at,
      lang: null,
    };
    return doc;
  });
}

/**
 * Action-item harvester. Reads `meeting_action` (Aria-extracted) and
 * `todoist_task` (if migration 125 has landed).
 */
export function harvestActions(db: Db, opts: HarvestOptions = {}): SourceDoc[] {
  const limit = opts.limit ?? 10_000;
  const since = opts.since ?? null;
  const sourceIds = opts.sourceIds;

  // meeting_action portion
  let actionSql =
    `SELECT id, note_id, text, created_at, updated_at
       FROM meeting_action
      WHERE 1=1`;
  const actionParams: unknown[] = [];
  if (since) {
    actionSql += ` AND created_at >= ?`;
    actionParams.push(since);
  }
  const actionFiltered = applyIdFilter(actionSql, sourceIds, 'id');
  actionSql = actionFiltered.sql;
  actionParams.push(...actionFiltered.params);
  actionSql += ` ORDER BY created_at DESC LIMIT ?`;
  actionParams.push(limit);

  const actions = db.prepare(actionSql).all(...actionParams) as Array<{
    id: string;
    note_id: string | null;
    text: string;
    created_at: string;
    updated_at: string;
  }>;

  const docs: SourceDoc[] = actions.map((a) => {
    const title = a.text.slice(0, 80) || '(action)';
    const doc: SourceDoc = {
      sourceKind: 'action',
      sourceId: a.id,
      providerKey: null,
      accountId: null,
      parentRef: a.note_id,
      title,
      text: a.text,
      occurredAt: a.created_at,
      sourceUpdatedAt: a.updated_at,
      lang: null,
    };
    return doc;
  });

  // todoist_task portion (optional — only if migration 125 landed)
  const hasTodoist =
    (db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='todoist_task'")
      .get() as { name: string } | undefined) != null;
  if (hasTodoist) {
    let tdSql =
      `SELECT id, content, description, local_updated_at
         FROM todoist_task
        WHERE 1=1`;
    const tdParams: unknown[] = [];
    if (since) {
      tdSql += ` AND local_updated_at >= ?`;
      tdParams.push(since);
    }
    const tdFiltered = applyIdFilter(tdSql, sourceIds, 'id');
    tdSql = tdFiltered.sql;
    tdParams.push(...tdFiltered.params);
    tdSql += ` ORDER BY local_updated_at DESC LIMIT ?`;
    tdParams.push(limit);

    const tasks = db.prepare(tdSql).all(...tdParams) as Array<{
      id: string;
      content: string;
      description: string | null;
      local_updated_at: string;
    }>;
    for (const t of tasks) {
      const text = t.description ? `${t.content}\n${t.description}` : t.content;
      const title = t.content.slice(0, 80) || '(task)';
      docs.push({
        sourceKind: 'action',
        sourceId: `todoist:${t.id}`,
        providerKey: 'todoist',
        accountId: 'default',
        parentRef: null,
        title,
        text,
        occurredAt: t.local_updated_at,
        sourceUpdatedAt: t.local_updated_at,
        lang: null,
      });
    }
  }

  // Sort combined list by occurredAt DESC NULLS LAST.
  docs.sort((a, b) => {
    const ao = a.occurredAt ?? '';
    const bo = b.occurredAt ?? '';
    if (ao === bo) return 0;
    if (!ao) return 1;
    if (!bo) return -1;
    return ao < bo ? 1 : -1;
  });

  return docs.slice(0, limit);
}
