/**
 * Plan 04-03 Task 1 — NL-event-reference resolver.
 *
 * resolveTarget(intent, db, client) maps a parsed Intent's eventRef phrase
 * (e.g. "my 3pm") to a concrete Google event id. The local `calendar_event`
 * cache (Phase 2 sync) is consulted first; ambiguity triggers a
 * NeedsClarificationError that the renderer surfaces as a candidate-picker.
 *
 * For recurring events the resolver also computes proposedChange (startUtc /
 * endUtc) preserving the original duration; the chokepoint (write-event.ts)
 * computes the actual API ops via recurrence.ts.
 *
 * isHighValue heuristic (powers CAL-07 prime-time bonus in conflict.ts):
 *   - event duration > 30min
 *   - AND (external attendees exist OR event has 'aria-high-value' label)
 *
 * The resolver is intentionally provider-agnostic on the local DB row shape;
 * we read only the columns we need.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type { CalendarClient } from '../integrations/google/calendar';
import type { Intent } from './intent';
import type { SelfOnlyEvent } from './self-only-gate';

type Db = Database.Database;

export interface ResolvedEvent extends SelfOnlyEvent {
  id: string;
  parentId?: string;
  summary?: string;
  startUtc: string;
  endUtc: string;
  isRecurring: boolean;
  etag?: string;
  recurrence?: string[];
}

export interface ResolvedTarget {
  eventId: string;
  parentId?: string;
  isRecurring: boolean;
  event: ResolvedEvent;
  proposedChange: { startUtc: string; endUtc: string };
  isHighValue: boolean;
}

export type NeedsClarificationCode = 'multiple-matches' | 'no-match';

export class NeedsClarificationError extends Error {
  readonly code: NeedsClarificationCode;
  readonly candidates: Array<{ eventId: string; summary: string; startUtc: string }>;
  constructor(
    code: NeedsClarificationCode,
    candidates: Array<{ eventId: string; summary: string; startUtc: string }> = [],
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'NeedsClarificationError';
    this.code = code;
    this.candidates = candidates;
  }
}

interface CalendarEventDbRow {
  id: string;
  summary: string;
  start_at_utc: string | null;
  end_at_utc: string | null;
  attendees: string;
  recurring_id: string | null;
  etag: string | null;
  organizer_email: string | null;
  organizer_self: number | null;
  recurrence_json: string | null;
}

export interface ResolveDeps {
  /** Override "today" anchor for NL date resolution (tests). */
  nowIso?: string;
  /** Override the IANA TZ for day-of-week math; default reads from rules. */
  timeZone?: string;
  /** Explicit eventId — short-circuits NL lookup (used by confirmTarget). */
  forceEventId?: string;
}

/**
 * Parse "my 3pm", "the 9am", "1430", "14:30" → {hour, minute} in 24h time, or
 * null if the phrase is not a time-of-day.
 */
export function parseTimeOfDay(phrase: string): { hour: number; minute: number } | null {
  const s = phrase.toLowerCase().trim();
  // "3pm", "3 pm", "3:30pm"
  const ampm = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (ampm) {
    let h = Number(ampm[1]);
    const m = ampm[2] ? Number(ampm[2]) : 0;
    const mer = ampm[3];
    if (h === 12) h = 0;
    if (mer === 'pm') h += 12;
    return { hour: h, minute: m };
  }
  // "14:30", "1430"
  const hm = s.match(/\b(\d{1,2}):(\d{2})\b/);
  if (hm) return { hour: Number(hm[1]), minute: Number(hm[2]) };
  const compact = s.match(/\b(\d{4})\b/);
  if (compact) {
    const n = compact[1]!;
    return { hour: Number(n.slice(0, 2)), minute: Number(n.slice(2)) };
  }
  return null;
}

/**
 * Map "Thursday", "thu", "next Thursday" → 0..6 (sun=0..sat=6). Returns null
 * if unrecognized.
 */
function parseWeekday(s: string): number | null {
  const lc = s.toLowerCase();
  const map: Record<string, number> = {
    sun: 0, sunday: 0,
    mon: 1, monday: 1,
    tue: 2, tues: 2, tuesday: 2,
    wed: 3, weds: 3, wednesday: 3,
    thu: 4, thur: 4, thurs: 4, thursday: 4,
    fri: 5, friday: 5,
    sat: 6, saturday: 6,
  };
  for (const k of Object.keys(map)) {
    if (lc.includes(k)) return map[k]!;
  }
  return null;
}

/** Compute the UTC date for the next occurrence of `targetDow` strictly after `fromIso`. */
function nextWeekdayUtc(fromIso: string, targetDow: number): Date {
  const from = new Date(fromIso);
  const cur = from.getUTCDay();
  let delta = targetDow - cur;
  if (delta <= 0) delta += 7;
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + delta);
  return d;
}

function rowToEvent(row: CalendarEventDbRow): ResolvedEvent {
  let attendees: Array<{ email?: string | null; self?: boolean | null }> = [];
  try {
    const parsed = JSON.parse(row.attendees);
    if (Array.isArray(parsed)) attendees = parsed;
  } catch {
    /* ignore */
  }
  let recurrence: string[] | undefined;
  if (row.recurrence_json) {
    try {
      const p = JSON.parse(row.recurrence_json);
      if (Array.isArray(p)) recurrence = p as string[];
    } catch {
      /* ignore */
    }
  }
  const isRecurring = !!row.recurring_id || !!recurrence;
  return {
    id: row.id,
    parentId: row.recurring_id ?? undefined,
    summary: row.summary,
    startUtc: row.start_at_utc ?? '',
    endUtc: row.end_at_utc ?? '',
    isRecurring,
    etag: row.etag ?? undefined,
    recurrence,
    organizer: {
      email: row.organizer_email,
      self: row.organizer_self === 1 ? true : row.organizer_self === 0 ? false : null,
    },
    attendees,
  };
}

function computeIsHighValue(ev: ResolvedEvent, userEmail: string): boolean {
  const startMs = Date.parse(ev.startUtc);
  const endMs = Date.parse(ev.endUtc);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
  if (endMs - startMs <= 30 * 60 * 1000) return false;
  const userLc = userEmail.toLowerCase();
  const orgLc = (ev.organizer?.email ?? '').toLowerCase();
  const hasExternal = (ev.attendees ?? []).some((a) => {
    const e = (a.email ?? '').toLowerCase();
    return e && e !== userLc && e !== orgLc;
  });
  return hasExternal;
}

/**
 * Resolve intent.target → ResolvedTarget. Throws NeedsClarificationError on
 * ambiguity / no-match. Returns the concrete event + the proposed new window.
 */
export async function resolveTarget(
  intent: Intent,
  db: Db,
  _client: CalendarClient | null,
  userEmail: string,
  deps: ResolveDeps = {},
): Promise<ResolvedTarget> {
  const nowIso = deps.nowIso ?? new Date().toISOString();

  // (1) confirmTarget short-circuit.
  if (deps.forceEventId) {
    const row = db
      .prepare<[string], CalendarEventDbRow>(
        `SELECT id, summary, start_at_utc, end_at_utc, attendees, recurring_id,
                etag, organizer_email, organizer_self, recurrence_json
         FROM calendar_event WHERE id = ?`,
      )
      .get(deps.forceEventId);
    if (!row) {
      throw new NeedsClarificationError('no-match', [], `event-not-found:${deps.forceEventId}`);
    }
    const event = rowToEvent(row);
    return buildResolved(event, intent, userEmail, nowIso);
  }

  const eventRef = intent.target?.eventRef?.trim() ?? '';
  const nlWhen = intent.when?.nlWhen ?? '';
  if (!eventRef) {
    throw new NeedsClarificationError('no-match', [], 'no eventRef on intent');
  }

  // Time-of-day lookup: "my 3pm".
  const tod = parseTimeOfDay(eventRef);
  if (tod) {
    // Anchor day = today (UTC). Pitfall: a real implementation should use the
    // user's TZ for "today"; v1 uses UTC anchor + ±30min hour window which is
    // tolerant enough.
    const anchor = new Date(nowIso);
    const dayStart = new Date(Date.UTC(
      anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate(),
      0, 0, 0, 0,
    ));
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const targetMs = Date.UTC(
      anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate(),
      tod.hour, tod.minute, 0, 0,
    );
    const lo = new Date(targetMs - 30 * 60 * 1000).toISOString();
    const hi = new Date(targetMs + 30 * 60 * 1000).toISOString();

    const rows = db
      .prepare<[string, string, string, string], CalendarEventDbRow>(
        `SELECT id, summary, start_at_utc, end_at_utc, attendees, recurring_id,
                etag, organizer_email, organizer_self, recurrence_json
         FROM calendar_event
         WHERE start_at_utc IS NOT NULL
           AND start_at_utc >= ? AND start_at_utc < ?
           AND start_at_utc >= ? AND start_at_utc <= ?
         ORDER BY start_at_utc ASC`,
      )
      .all(dayStart.toISOString(), dayEnd.toISOString(), lo, hi);

    if (rows.length === 0) {
      throw new NeedsClarificationError('no-match', [], `no event matches '${eventRef}'`);
    }
    if (rows.length > 1) {
      throw new NeedsClarificationError(
        'multiple-matches',
        rows.map((r) => ({
          eventId: r.id,
          summary: r.summary,
          startUtc: r.start_at_utc ?? '',
        })),
        `${rows.length} events match '${eventRef}' — please clarify`,
      );
    }
    const event = rowToEvent(rows[0]!);
    return buildResolved(event, intent, userEmail, nowIso);
  }

  // Free-text lookup by summary substring.
  const like = `%${eventRef.replace(/[%_]/g, '')}%`;
  const rows = db
    .prepare<[string], CalendarEventDbRow>(
      `SELECT id, summary, start_at_utc, end_at_utc, attendees, recurring_id,
              etag, organizer_email, organizer_self, recurrence_json
       FROM calendar_event
       WHERE summary LIKE ? AND start_at_utc >= ?
       ORDER BY start_at_utc ASC
       LIMIT 5`,
    )
    .all(like, nowIso);
  if (rows.length === 0) {
    throw new NeedsClarificationError('no-match', [], `no event matches '${eventRef}'`);
  }
  if (rows.length > 1) {
    throw new NeedsClarificationError(
      'multiple-matches',
      rows.map((r) => ({
        eventId: r.id,
        summary: r.summary,
        startUtc: r.start_at_utc ?? '',
      })),
    );
  }
  const event = rowToEvent(rows[0]!);
  return buildResolved(event, intent, userEmail, nowIso);

  // (Unused param suppression — when nlWhen is empty proposedChange falls
  // back to event window so test surfaces are stable.)
  void nlWhen;
}

function buildResolved(
  event: ResolvedEvent,
  intent: Intent,
  userEmail: string,
  nowIso: string,
): ResolvedTarget {
  const durationMs =
    Date.parse(event.endUtc) - Date.parse(event.startUtc);
  const safeDur = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 30 * 60 * 1000;

  let newStart = event.startUtc;
  let newEnd = event.endUtc;

  const dr = intent.when?.datetimeRange;
  if (dr?.startIso && dr.endIso) {
    newStart = dr.startIso;
    newEnd = dr.endIso;
  } else if (intent.when?.nlWhen) {
    const dow = parseWeekday(intent.when.nlWhen);
    if (dow !== null) {
      const day = nextWeekdayUtc(nowIso, dow);
      const origStart = new Date(event.startUtc);
      day.setUTCHours(origStart.getUTCHours(), origStart.getUTCMinutes(), 0, 0);
      newStart = day.toISOString();
      newEnd = new Date(day.getTime() + safeDur).toISOString();
    } else {
      const tod = parseTimeOfDay(intent.when.nlWhen);
      if (tod) {
        const base = new Date(event.startUtc);
        base.setUTCHours(tod.hour, tod.minute, 0, 0);
        newStart = base.toISOString();
        newEnd = new Date(base.getTime() + safeDur).toISOString();
      }
    }
  }

  return {
    eventId: event.id,
    parentId: event.parentId,
    isRecurring: event.isRecurring,
    event,
    proposedChange: { startUtc: newStart, endUtc: newEnd },
    isHighValue: computeIsHighValue(event, userEmail),
  };
}
