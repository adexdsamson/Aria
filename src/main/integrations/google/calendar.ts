/**
 * Plan 02-02 — CalendarClient interface + googleapis-backed implementation.
 *
 * Mirrors the Plan 02-01 GmailClient wrapper pattern. Wraps the three
 * googleapis Calendar v3 surfaces the sync engine consumes:
 *   - events.list              (incremental via syncToken; or bounded window)
 *   - calendarList.get('primary')  (resolves the connected email/summary)
 *
 * Error translation:
 *   - 410 GONE on events.list                → SyncTokenInvalidatedError
 *   - 401 / errors[0].reason==='invalid_grant' / response.data.error==='invalid_grant'
 *                                            → TokenInvalidError({reason:'expired'|'revoked'})
 *
 * Pitfall 14 enforcement (defensive, BEFORE the API call):
 *   - `listEvents({syncToken, ...})` MUST NOT combine syncToken with
 *     timeMin/timeMax/orderBy/q/iCalUID/singleEvents — Google returns 400.
 *     The wrapper throws IncompatibleEventsListParamsError to surface bugs in
 *     callers at unit-test time rather than via a runtime 400.
 *
 * Two distinct entrypoints:
 *   - listEvents       — syncToken-driven incremental path (NO window args).
 *   - listEventsWindow — syncToken-free path used by full-resync AND by the
 *                        Plan 02-04 readTodaysEvents helper.
 */
import type { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { TokenInvalidError } from './auth';

export class SyncTokenInvalidatedError extends Error {
  override readonly name = 'SyncTokenInvalidatedError';
}

export class IncompatibleEventsListParamsError extends Error {
  override readonly name = 'IncompatibleEventsListParamsError';
}

export interface CalendarEventRaw {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ email?: string; responseStatus?: string; displayName?: string }>;
  recurringEventId?: string;
  updated?: string;
}

export interface ListEventsOpts {
  /** Incremental cursor. When set, the wrapper rejects any window args. */
  syncToken?: string;
  /** Pagination cursor. Safe to combine with either syncToken OR window args. */
  pageToken?: string;
}

export interface ListEventsWindowOpts {
  timeMin: string;
  timeMax: string;
  singleEvents?: boolean;
  pageToken?: string;
}

export interface ListEventsResult {
  items: CalendarEventRaw[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export interface CalendarClient {
  listEvents(opts: ListEventsOpts): Promise<ListEventsResult>;
  listEventsWindow(opts: ListEventsWindowOpts): Promise<ListEventsResult>;
  getCalendarMetadata(): Promise<{ email: string }>;
}

interface GoogleErrorShape {
  code?: number;
  message?: string;
  errors?: { reason?: string; message?: string }[];
  response?: {
    status?: number;
    data?: {
      error?: string;
      error_description?: string;
    };
  };
}

function isGone(err: unknown): boolean {
  const e = err as GoogleErrorShape;
  const code = e.code ?? e.response?.status;
  if (code === 410) return true;
  const reasons = e.errors?.map((x) => x.reason) ?? [];
  return reasons.includes('fullSyncRequired');
}

function maybeThrowTokenInvalid(err: unknown): never | void {
  const e = err as GoogleErrorShape;
  const dataError = e.response?.data?.error;
  const reasons = e.errors?.map((x) => x.reason).filter(Boolean) ?? [];
  const code = e.code ?? e.response?.status;
  const message = e.message ?? '';

  const hasInvalidGrant =
    dataError === 'invalid_grant' ||
    reasons.includes('invalid_grant') ||
    (code === 401 && /invalid_grant/i.test(message)) ||
    (code === 401 && reasons.length === 1 && reasons[0] === 'invalid_grant');

  if (!hasInvalidGrant) return;

  const desc = e.response?.data?.error_description ?? '';
  const explicitlyRevoked =
    /revoked/i.test(desc) && !/expired or revoked/i.test(desc);
  const reason: 'expired' | 'revoked' = explicitlyRevoked ? 'revoked' : 'expired';
  throw new TokenInvalidError({ reason, message: desc || `invalid_grant (${reason})` });
}

/**
 * Build a CalendarClient bound to the given OAuth2Client. All errors translated
 * to domain types before escaping. Pitfall 14 enforced defensively.
 */
export function createCalendarClient(oauth2Client: OAuth2Client): CalendarClient {
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  return {
    async listEvents(opts: ListEventsOpts) {
      // Pitfall 14 defensive check: callers must not pass window args alongside
      // syncToken. We accept extra unknown props at the typed surface only
      // through the @ts-expect-error path in the test; this guard catches both
      // typed and accidental untyped misuse before the HTTP call.
      const anyOpts = opts as unknown as Record<string, unknown>;
      if (opts.syncToken) {
        const forbidden = ['timeMin', 'timeMax', 'orderBy', 'q', 'iCalUID', 'singleEvents'];
        for (const k of forbidden) {
          if (anyOpts[k] !== undefined) {
            throw new IncompatibleEventsListParamsError(
              `events.list rejects ${k} when syncToken is set (Pitfall 14)`,
            );
          }
        }
      }
      try {
        const res = await calendar.events.list({
          calendarId: 'primary',
          syncToken: opts.syncToken,
          pageToken: opts.pageToken,
        });
        return {
          items: (res.data.items ?? []) as CalendarEventRaw[],
          nextPageToken: res.data.nextPageToken ?? undefined,
          nextSyncToken: res.data.nextSyncToken ?? undefined,
        };
      } catch (err) {
        if (isGone(err)) {
          throw new SyncTokenInvalidatedError(
            'events.list returned 410 — syncToken is invalidated; full resync required',
          );
        }
        maybeThrowTokenInvalid(err);
        throw err;
      }
    },

    async listEventsWindow(opts: ListEventsWindowOpts) {
      try {
        const res = await calendar.events.list({
          calendarId: 'primary',
          timeMin: opts.timeMin,
          timeMax: opts.timeMax,
          singleEvents: opts.singleEvents,
          pageToken: opts.pageToken,
        });
        return {
          items: (res.data.items ?? []) as CalendarEventRaw[],
          nextPageToken: res.data.nextPageToken ?? undefined,
          nextSyncToken: res.data.nextSyncToken ?? undefined,
        };
      } catch (err) {
        maybeThrowTokenInvalid(err);
        throw err;
      }
    },

    async getCalendarMetadata() {
      try {
        const res = await calendar.calendarList.get({ calendarId: 'primary' });
        const summary = res.data.summary ?? res.data.id ?? '';
        return { email: summary };
      } catch (err) {
        maybeThrowTokenInvalid(err);
        throw err;
      }
    },
  };
}

export { TokenInvalidError } from './auth';
