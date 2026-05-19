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

/**
 * Plan 04-01 — Google returns 412 Precondition Failed when an If-Match
 * (etag) header does not match the current event. patchEvent translates
 * this to an EtagMismatchError so the chokepoint (write-event.ts) can
 * write a `failed` audit row and surface a refresh prompt to the user.
 */
export class EtagMismatchError extends Error {
  override readonly name = 'EtagMismatchError';
  readonly code: 'etag-mismatch' = 'etag-mismatch';
}

/**
 * Plan 04-01 — thrown by the chokepoint when a caller asks to patch a
 * single instance (scope='this') but the event id does not look like an
 * instance id (instance ids contain an underscore separator). Defended
 * here as a wrapper-level guard against Pitfall 3 ("this instance" patch
 * hits parent series).
 */
export class InvalidInstanceIdError extends Error {
  override readonly name = 'InvalidInstanceIdError';
  readonly code: 'invalid-instance-id' = 'invalid-instance-id';
}

export interface CalendarEventRaw {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  webLink?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ email?: string; responseStatus?: string; displayName?: string; self?: boolean }>;
  recurringEventId?: string;
  updated?: string;
  etag?: string;
  iCalUID?: string;
  sequence?: number;
  organizer?: { email?: string; self?: boolean; displayName?: string };
  recurrence?: string[];
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

// Plan 04-01 — minimal write-side type surface. We don't depend on
// calendar_v3.Schema$Event directly so unit tests with hand-rolled fakes
// don't have to import googleapis types.
export interface PatchEventArgs {
  eventId: string;
  requestBody: Record<string, unknown>;
  /** Etag for optimistic-concurrency If-Match header. */
  ifMatch?: string;
  /** Default 'none' at the chokepoint. */
  sendUpdates?: 'none' | 'externalOnly' | 'all';
}

export interface InsertEventArgs {
  requestBody: Record<string, unknown>;
  sendUpdates?: 'none' | 'externalOnly' | 'all';
}

export interface EventsInstancesArgs {
  eventId: string;
  timeMin: string;
  timeMax: string;
}

export interface FreebusyQueryArgs {
  timeMin: string;
  timeMax: string;
  calendarIds: string[];
}
export interface FreeBusyResult {
  calendars: Record<string, { busy: Array<{ start: string; end: string }> }>;
}

export interface CalendarSettings {
  timeZone: string;
  /** Best-effort — Google does not expose working hours on the settings
   *  endpoint as of v3. Undefined by default; populated only if a future
   *  API surface adds it (Open Q 1 in 04-RESEARCH). */
  workingHours?: undefined;
}

export interface CalendarClient {
  listEvents(opts: ListEventsOpts): Promise<ListEventsResult>;
  listEventsWindow(opts: ListEventsWindowOpts): Promise<ListEventsResult>;
  getCalendarMetadata(): Promise<{ email: string }>;
  // Plan 04-01 write-side
  patchEvent(args: PatchEventArgs): Promise<{ id: string; etag?: string }>;
  insertEvent(args: InsertEventArgs): Promise<{ id: string; etag?: string }>;
  eventsInstances(args: EventsInstancesArgs): Promise<CalendarEventRaw[]>;
  freebusyQuery(args: FreebusyQueryArgs): Promise<FreeBusyResult>;
  getCalendarSettings(): Promise<CalendarSettings>;
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

    async patchEvent(args: PatchEventArgs) {
      const params: Record<string, unknown> = {
        calendarId: 'primary',
        eventId: args.eventId,
        requestBody: args.requestBody,
        sendUpdates: args.sendUpdates ?? 'none',
      };
      // googleapis exposes If-Match via the `ifMatch` option (Calendar v3
      // optimistic concurrency); pass alongside a manual header for
      // belt-and-braces support across googleapis versions.
      if (args.ifMatch) {
        (params as { headers?: Record<string, string> }).headers = { 'If-Match': args.ifMatch };
        (params as { ifMatch?: string }).ifMatch = args.ifMatch;
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await calendar.events.patch(params as any);
        return { id: String(res.data.id ?? args.eventId), etag: res.data.etag ?? undefined };
      } catch (err) {
        const e = err as GoogleErrorShape;
        const code = e.code ?? e.response?.status;
        if (code === 412) {
          throw new EtagMismatchError(
            `events.patch returned 412: etag mismatch for event ${args.eventId}`,
          );
        }
        maybeThrowTokenInvalid(err);
        throw err;
      }
    },

    async insertEvent(args: InsertEventArgs) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await calendar.events.insert({
          calendarId: 'primary',
          requestBody: args.requestBody,
          sendUpdates: args.sendUpdates ?? 'none',
        } as any);
        return { id: String(res.data.id ?? ''), etag: res.data.etag ?? undefined };
      } catch (err) {
        maybeThrowTokenInvalid(err);
        throw err;
      }
    },

    async eventsInstances(args: EventsInstancesArgs) {
      try {
        const res = await calendar.events.instances({
          calendarId: 'primary',
          eventId: args.eventId,
          timeMin: args.timeMin,
          timeMax: args.timeMax,
        });
        return (res.data.items ?? []) as CalendarEventRaw[];
      } catch (err) {
        maybeThrowTokenInvalid(err);
        throw err;
      }
    },

    async freebusyQuery(args: FreebusyQueryArgs) {
      try {
        const res = await calendar.freebusy.query({
          requestBody: {
            timeMin: args.timeMin,
            timeMax: args.timeMax,
            items: args.calendarIds.map((id) => ({ id })),
          },
        });
        const out: FreeBusyResult = { calendars: {} };
        const cals = res.data.calendars ?? {};
        for (const [id, info] of Object.entries(cals)) {
          const busy = (info?.busy ?? [])
            .map((b) => ({ start: String(b.start ?? ''), end: String(b.end ?? '') }))
            .filter((b) => b.start && b.end);
          out.calendars[id] = { busy };
        }
        return out;
      } catch (err) {
        maybeThrowTokenInvalid(err);
        throw err;
      }
    },

    async getCalendarSettings() {
      try {
        const res = await calendar.calendarList.get({ calendarId: 'primary' });
        const tz = res.data.timeZone ?? 'UTC';
        return { timeZone: tz };
      } catch (err) {
        maybeThrowTokenInvalid(err);
        throw err;
      }
    },
  };
}

export { TokenInvalidError } from './auth';
