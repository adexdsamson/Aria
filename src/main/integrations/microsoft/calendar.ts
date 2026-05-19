import { DeltaExpiredError, TokenInvalidError, TransientGraphError } from './errors';
import { graphRecurrenceToRrule } from './recurrence-graph';

export const EVENT_DELTA_SELECT = [
  'id',
  'iCalUId',
  'subject',
  'body',
  'bodyPreview',
  'organizer',
  'attendees',
  'start',
  'end',
  'location',
  'isAllDay',
  'isRecurring',
  'recurrence',
  'seriesMasterId',
  'type',
  'sensitivity',
  'showAs',
  'isOrganizer',
  'responseRequested',
  'responseStatus',
  'transactionId',
  'onlineMeeting',
  'onlineMeetingProvider',
  'importance',
  'categories',
  'webLink',
  'lastModifiedDateTime',
  '@odata.etag',
] as const;

export interface MicrosoftEventItem {
  id: string;
  iCalUId?: string;
  subject?: string;
  body?: { content?: string; contentType?: string };
  bodyPreview?: string;
  organizer?: { emailAddress?: { address?: string; name?: string }; self?: boolean };
  attendees?: Array<{
    emailAddress?: { address?: string; name?: string };
    type?: string;
    status?: { response?: string; time?: string };
  }>;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  location?: { displayName?: string };
  isAllDay?: boolean;
  isRecurring?: boolean;
  recurrence?: unknown;
  seriesMasterId?: string;
  type?: string;
  sensitivity?: string;
  showAs?: string;
  isOrganizer?: boolean;
  responseRequested?: boolean;
  responseStatus?: { response?: string; time?: string };
  transactionId?: string;
  onlineMeeting?: unknown;
  onlineMeetingProvider?: string;
  importance?: string;
  categories?: string[];
  webLink?: string;
  lastModifiedDateTime?: string;
  '@odata.etag'?: string;
  '@removed'?: { reason?: string } | unknown;
}

export interface DeltaResult<T> {
  items: T[];
  tombstones: string[];
  cursor: string;
  hadFullResync: boolean;
}

export interface MicrosoftCalendarClient {
  graph: {
    api(path: string): {
      select(fields: string): {
        get(): Promise<unknown>;
      };
      header(key: string, value: string): {
        patch(body: unknown): Promise<unknown>;
        post(body: unknown): Promise<unknown>;
      };
      patch(body: unknown): Promise<unknown>;
      post(body: unknown): Promise<unknown>;
      get(): Promise<unknown>;
    };
  };
}

export interface CalendarDeltaOpts {
  cursor?: string | null;
  startDateTime?: string;
  endDateTime?: string;
}

export interface FreeBusyResult {
  calendars: Record<string, { busy: Array<{ start: string; end: string }> }>;
}

function isGraphStatus(err: unknown, status: number): boolean {
  const e = err as { status?: number; statusCode?: number; response?: { status?: number } };
  return (e.status ?? e.statusCode ?? e.response?.status) === status;
}

function withSelect(path: string): boolean {
  return path.startsWith('/me/calendarView/delta') || path.startsWith('/me/events/delta');
}

export function normalizeCalendarItem(item: MicrosoftEventItem, fetchedAtIso: string) {
  const isTimed = Boolean(item.start?.dateTime);
  const recurrence = graphRecurrenceToRrule(item.recurrence);
  const recurrence_json = recurrence.unsupported ? null : JSON.stringify([recurrence.rrule]);
  const recurrence_unsupported = recurrence.unsupported ? 1 : 0;
  return {
    id: item.id,
    calendar_id: 'primary',
    summary: item.subject ?? '',
    location: item.location?.displayName ?? null,
    start_at_utc: isTimed ? new Date(item.start!.dateTime!).toISOString() : null,
    end_at_utc: isTimed && item.end?.dateTime ? new Date(item.end.dateTime).toISOString() : null,
    start_date: !isTimed ? item.start?.date ?? null : null,
    end_date: !isTimed ? item.end?.date ?? null : null,
    start_timezone: item.start?.timeZone ?? null,
    attendees: JSON.stringify(item.attendees ?? []),
    status: item.type === 'cancelled' ? 'cancelled' : 'confirmed',
    recurring_id: item.seriesMasterId ?? null,
    updated_at: item.lastModifiedDateTime ?? fetchedAtIso,
    fetched_at: fetchedAtIso,
    etag: item['@odata.etag'] ?? null,
    i_cal_uid: item.iCalUId ?? null,
    sequence: null as number | null,
    organizer_email: item.organizer?.emailAddress?.address ?? null,
    organizer_self: item.organizer?.self === true ? 1 : item.organizer ? 0 : null,
    recurrence_json,
    recurrence_unsupported,
  };
}

async function readPage(client: MicrosoftCalendarClient, path: string): Promise<{
  items: MicrosoftEventItem[];
  nextLink?: string;
  deltaLink?: string;
}> {
  try {
    const req = client.graph.api(path);
    const res = withSelect(path)
      ? await req.select(EVENT_DELTA_SELECT.join(',')).get()
      : await req.get();
    const body = res as {
      value?: MicrosoftEventItem[];
      '@odata.nextLink'?: string;
      '@odata.deltaLink'?: string;
    };
    return {
      items: (body.value ?? []) as MicrosoftEventItem[],
      nextLink: body['@odata.nextLink'],
      deltaLink: body['@odata.deltaLink'],
    };
  } catch (err) {
    if (isGraphStatus(err, 410)) {
      throw new DeltaExpiredError('Microsoft calendar delta cursor expired');
    }
    if (isGraphStatus(err, 401)) {
      throw new TokenInvalidError({ reason: 'expired', message: 'Microsoft Graph returned 401' });
    }
    if (isGraphStatus(err, 429)) {
      throw new TransientGraphError('Microsoft Graph throttled calendar delta');
    }
    throw err;
  }
}

export async function listEventsDelta(
  client: MicrosoftCalendarClient,
  opts: CalendarDeltaOpts = {},
): Promise<DeltaResult<MicrosoftEventItem>> {
  const startDateTime = opts.startDateTime ?? new Date(Date.now() - 86_400_000).toISOString();
  const endDateTime = opts.endDateTime ?? new Date(Date.now() + 30 * 86_400_000).toISOString();
  const initial = opts.cursor ?? `/me/calendarView/delta?startDateTime=${encodeURIComponent(startDateTime)}&endDateTime=${encodeURIComponent(endDateTime)}`;
  const items: MicrosoftEventItem[] = [];
  const tombstones: string[] = [];
  let cursor = initial;
  let pagePath = initial;
  const hadFullResync = !opts.cursor;

  while (true) {
    const page = await readPage(client, pagePath);
    for (const item of page.items) {
      if (item['@removed']) {
        tombstones.push(item.id);
      } else {
        items.push(item);
      }
    }
    if (page.deltaLink) {
      cursor = page.deltaLink;
      break;
    }
    if (!page.nextLink) break;
    pagePath = page.nextLink;
  }

  return { items, tombstones, cursor, hadFullResync };
}

export { graphRecurrenceToRrule, rruleToGraphRecurrence } from './recurrence-graph';

export async function patchEvent(
  client: MicrosoftCalendarClient,
  args: { eventId: string; requestBody: Record<string, unknown>; ifMatch?: string; sendUpdates?: 'none' | 'all' | 'externalOnly' },
): Promise<{ id: string; etag?: string }> {
  const req = client.graph.api(`/me/events/${encodeURIComponent(args.eventId)}`);
  const patched = args.ifMatch ? await req.header('If-Match', args.ifMatch).patch(args.requestBody) : await req.patch(args.requestBody);
  const body = patched as { id?: string; '@odata.etag'?: string; etag?: string };
  return { id: body.id ?? args.eventId, etag: body['@odata.etag'] ?? body.etag };
}

export async function insertEvent(
  client: MicrosoftCalendarClient,
  args: { requestBody: Record<string, unknown>; sendUpdates?: 'none' | 'all' | 'externalOnly' },
): Promise<{ id: string; etag?: string }> {
  const created = await client.graph.api('/me/events').post(args.requestBody);
  const body = created as { id?: string; '@odata.etag'?: string; etag?: string };
  return { id: body.id ?? '', etag: body['@odata.etag'] ?? body.etag };
}

export async function eventInstances(
  client: MicrosoftCalendarClient,
  args: { eventId: string; timeMin: string; timeMax: string },
): Promise<MicrosoftEventItem[]> {
  const res = await client.graph
    .api(`/me/events/${encodeURIComponent(args.eventId)}/instances?startDateTime=${encodeURIComponent(args.timeMin)}&endDateTime=${encodeURIComponent(args.timeMax)}`)
    .select(EVENT_DELTA_SELECT.join(','))
    .get();
  const body = res as { value?: MicrosoftEventItem[] };
  return (body.value ?? []) as MicrosoftEventItem[];
}

export async function freebusyQuery(
  client: MicrosoftCalendarClient,
  args: { timeMin: string; timeMax: string; calendarIds: string[] },
): Promise<FreeBusyResult> {
  const res = await client.graph.api('/me/calendar/getSchedule').post({
    schedules: args.calendarIds,
    startTime: { dateTime: args.timeMin, timeZone: 'UTC' },
    endTime: { dateTime: args.timeMax, timeZone: 'UTC' },
    availabilityViewInterval: 30,
  });
  const body = res as {
    value?: Array<{
      scheduleId?: string;
      scheduleItems?: Array<{ startTime?: string; endTime?: string }>;
    }>;
  };
  const calendars: Record<string, { busy: Array<{ start: string; end: string }> }> = {};
  for (const entry of body.value ?? []) {
    const key = entry.scheduleId ?? 'primary';
    calendars[key] = {
      busy: (entry.scheduleItems ?? []).flatMap((item) =>
        item.startTime && item.endTime ? [{ start: item.startTime, end: item.endTime }] : [],
      ),
    };
  }
  return { calendars };
}
