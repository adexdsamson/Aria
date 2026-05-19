import type Database from 'better-sqlite3-multiple-ciphers';

type Db = Database.Database;

export interface CalendarLinkCandidate {
  providerKey: 'google' | 'microsoft';
  accountId: string;
  calendarEventId: string;
  summary: string;
  startUtc: string | null;
  score: number;
}

export interface LinkCalendarInput {
  title?: string;
  normalizedText: string;
  ingestedAt: string;
}

export function findCalendarLinkCandidates(db: Db, input: LinkCalendarInput): CalendarLinkCandidate[] {
  const start = new Date(input.ingestedAt);
  const min = new Date(start.getTime() - 60 * 60 * 1000).toISOString();
  const max = new Date(start.getTime() + 60 * 60 * 1000).toISOString();
  const rows = db.prepare(
    `SELECT id as calendarEventId,
            provider_key as providerKey,
            account_id as accountId,
            summary,
            start_at_utc as startUtc,
            attendees
       FROM calendar_event
      WHERE start_at_utc BETWEEN @min AND @max
        AND provider_key IS NOT NULL
        AND account_id IS NOT NULL
      ORDER BY ABS(strftime('%s', start_at_utc) - strftime('%s', @ingestedAt)) ASC
      LIMIT 5`,
  ).all({ min, max, ingestedAt: input.ingestedAt }) as Array<CalendarLinkCandidate & { attendees: string }>;
  return rows
    .map((row) => ({
      providerKey: row.providerKey,
      accountId: row.accountId,
      calendarEventId: row.calendarEventId,
      summary: row.summary,
      startUtc: row.startUtc,
      score: scoreCandidate(row.summary, row.attendees, input),
    }))
    .sort((a, b) => b.score - a.score);
}

export function bestCalendarLink(
  db: Db,
  input: LinkCalendarInput,
  threshold = 0.55,
): { selected: CalendarLinkCandidate | null; candidates: CalendarLinkCandidate[] } {
  const candidates = findCalendarLinkCandidates(db, input);
  const selected = candidates[0] && candidates[0].score >= threshold ? candidates[0] : null;
  return { selected, candidates };
}

function scoreCandidate(summary: string, attendeesJson: string | null, input: LinkCalendarInput): number {
  const haystack = `${input.title ?? ''} ${input.normalizedText}`.toLowerCase();
  const summaryTokens = tokens(summary);
  let score = 0.25;
  if (summaryTokens.length > 0) {
    const hits = summaryTokens.filter((token) => haystack.includes(token)).length;
    score += Math.min(0.5, hits / summaryTokens.length);
  }
  for (const attendee of parseAttendees(attendeesJson)) {
    const t = tokens(attendee);
    if (t.some((token) => haystack.includes(token))) score += 0.15;
  }
  return Math.min(1, score);
}

function tokens(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
}

function parseAttendees(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (typeof item === 'string') return [item];
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        return [obj.email, obj.displayName, obj.name].filter((v): v is string => typeof v === 'string');
      }
      return [];
    });
  } catch {
    return [];
  }
}
