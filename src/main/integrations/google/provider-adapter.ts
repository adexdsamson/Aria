import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import {
  createCalendarClient,
  type CalendarClient,
  type CalendarEventRaw,
} from '../google/calendar';
import {
  createGmailClient,
  HistoryInvalidatedError,
  type GmailClient,
  type GmailMessageMetadata,
  type HistoryEntry,
} from '../google/gmail';
import { getOAuth2Client } from '../google/auth';
import type {
  CanonicalEvent,
  CanonicalMessage,
  DeltaResult,
  MailSendInput,
  Provider,
} from '../../../shared/provider';
import type { ProviderAccountRow } from '../microsoft/types';

export interface GoogleProviderDeps {
  gmailClient?: GmailClient;
  calendarClient?: CalendarClient;
  getOAuth2Client?: (kind: 'gmail' | 'calendar') => OAuth2Client | null;
  buildGmailClient?: (oauth: OAuth2Client) => GmailClient;
  buildCalendarClient?: (oauth: OAuth2Client) => CalendarClient;
}

function resolveOAuthClient(
  kind: 'gmail' | 'calendar',
  deps: GoogleProviderDeps,
): OAuth2Client | null {
  return deps.getOAuth2Client?.(kind) ?? getOAuth2Client(kind);
}

async function resolveGmailClient(deps: GoogleProviderDeps): Promise<GmailClient> {
  if (deps.gmailClient) return deps.gmailClient;
  const oauth = resolveOAuthClient('gmail', deps);
  if (!oauth) throw new Error('gmail-not-connected');
  if (deps.buildGmailClient) return deps.buildGmailClient(oauth);
  return createGmailClient(oauth);
}

async function resolveCalendarClient(deps: GoogleProviderDeps): Promise<CalendarClient> {
  if (deps.calendarClient) return deps.calendarClient;
  const oauth = resolveOAuthClient('calendar', deps);
  if (!oauth) throw new Error('calendar-not-connected');
  if (deps.buildCalendarClient) return deps.buildCalendarClient(oauth);
  return createCalendarClient(oauth);
}

function header(msg: GmailMessageMetadata, name: string): string {
  const found = msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return found?.value ?? '';
}

function parseDateTime(value: string | number | undefined): string {
  if (typeof value === 'number') {
    return new Date(value).toISOString();
  }
  if (typeof value === 'string' && value.length > 0) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      return new Date(asNumber).toISOString();
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function canonicalMessageFromGmail(msg: GmailMessageMetadata): CanonicalMessage {
  const labels = msg.labelIds ?? [];
  return {
    externalId: msg.id,
    threadId: msg.threadId ?? msg.id,
    fromAddr: header(msg, 'From'),
    subject: header(msg, 'Subject'),
    snippet: msg.snippet ?? '',
    receivedAtUtc: parseDateTime(msg.internalDate),
    labels,
    isUnread: labels.includes('UNREAD'),
    isImportant: labels.includes('IMPORTANT'),
    bodyText: null,
  };
}

function buildRfc2822(input: MailSendInput, idempotencyKey: string): string {
  const lines = [
    `To: ${input.to.join(', ')}`,
    ...(input.cc && input.cc.length ? [`Cc: ${input.cc.join(', ')}`] : []),
    ...(input.bcc && input.bcc.length ? [`Bcc: ${input.bcc.join(', ')}`] : []),
    `Subject: ${input.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    `X-Aria-Idempotency-Key: ${idempotencyKey}`,
  ];
  if (input.inReplyToExternalId) {
    const reply = input.inReplyToExternalId.startsWith('<')
      ? input.inReplyToExternalId
      : `<${input.inReplyToExternalId}>`;
    lines.push(`In-Reply-To: ${reply}`);
    lines.push(`References: ${reply}`);
  }
  lines.push('', input.bodyText);
  return lines.join('\r\n');
}

function collectAddedIds(history: HistoryEntry[]): string[] {
  const out: string[] = [];
  for (const entry of history) {
    for (const added of entry.messagesAdded ?? []) {
      if (added.message?.id) out.push(added.message.id);
    }
  }
  return out;
}

function collectDeletedIds(history: HistoryEntry[]): string[] {
  const out: string[] = [];
  for (const entry of history) {
    for (const deleted of entry.messagesDeleted ?? []) {
      if (deleted.message?.id) out.push(deleted.message.id);
    }
  }
  return out;
}

async function gmailSearchByIdempotencyKey(
  auth: OAuth2Client,
  idempotencyKey: string,
): Promise<string | null> {
  const gmail = google.gmail({ version: 'v1', auth });
  const q = `in:sent rfc822msgid:* "X-Aria-Idempotency-Key:${idempotencyKey}"`;
  const res = await gmail.users.messages.list({ userId: 'me', q });
  return res.data.messages?.[0]?.id ?? null;
}

async function listMessagesDelta(
  client: GmailClient,
  cursor?: string | null,
): Promise<DeltaResult<CanonicalMessage>> {
  if (cursor) {
    try {
      const history = await client.listHistory({ startHistoryId: cursor });
      const ids = collectAddedIds(history.history);
      const items: CanonicalMessage[] = [];
      for (const id of ids) {
        items.push(canonicalMessageFromGmail(await client.getMessageMetadata(id)));
      }
      return {
        items,
        tombstones: collectDeletedIds(history.history),
        cursor: history.historyId,
        hadFullResync: false,
      };
    } catch (err) {
      // Gmail retains history for ~7 days. If the stored historyId is older
      // than the retention window, Gmail returns 404/notFound on
      // history.list and the client wraps it in HistoryInvalidatedError.
      // Recover by falling through to the full-window resync below, which
      // re-anchors the cursor at the current historyId via getProfile —
      // same pattern the legacy sync-gmail.ts uses. Anything else re-throws.
      if (!(err instanceof HistoryInvalidatedError)) throw err;
    }
  }

  const profile = await client.getProfile();
  const items: CanonicalMessage[] = [];
  let pageToken: string | undefined;
  do {
    const page = await client.listMessages({ q: 'newer_than:7d', pageToken });
    for (const message of page.messages) {
      items.push(canonicalMessageFromGmail(await client.getMessageMetadata(message.id)));
    }
    pageToken = page.nextPageToken;
  } while (pageToken);

  return {
    items,
    tombstones: [],
    cursor: profile.historyId,
    hadFullResync: true,
  };
}

function calendarEventToCanonical(raw: CalendarEventRaw): CanonicalEvent {
  const startAtUtc = raw.start?.dateTime ? new Date(raw.start.dateTime).toISOString() : null;
  const endAtUtc = raw.end?.dateTime ? new Date(raw.end.dateTime).toISOString() : null;
  const startDate = raw.start?.date ?? null;
  const endDate = raw.end?.date ?? null;
  const isAllDay = Boolean(startDate || endDate) && !startAtUtc && !endAtUtc;
  return {
    externalId: raw.id,
    summary: raw.summary ?? '',
    startAtUtc,
    endAtUtc,
    startDate,
    endDate,
    isAllDay,
    isRecurring: Boolean(raw.recurrence?.length ?? 0),
    recurrence: raw.recurrence ?? null,
    recurrenceUnsupported: false,
    location: raw.location ?? null,
    description: (raw as { description?: string }).description ?? null,
    webLink: raw.webLink ?? null,
    iCalUid: raw.iCalUID ?? null,
    organizerEmail: raw.organizer?.email ?? null,
    organizerSelf: raw.organizer?.self ?? null,
    attendees: raw.attendees?.map((attendee) => ({
      email: attendee.email ?? null,
      self: attendee.self ?? null,
      type: attendee.responseStatus ?? null,
    })),
  };
}

function canonicalEventToGoogle(event: Partial<CanonicalEvent>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (event.summary !== undefined) out.summary = event.summary;
  if (event.location !== undefined) out.location = event.location;
  if (event.description !== undefined) out.description = event.description;
  if (event.webLink !== undefined) out.source = { url: event.webLink };
  if (event.startAtUtc || event.startDate) {
    out.start = event.startDate
      ? { date: event.startDate }
      : { dateTime: event.startAtUtc, timeZone: 'UTC' };
  }
  if (event.endAtUtc || event.endDate) {
    out.end = event.endDate
      ? { date: event.endDate }
      : { dateTime: event.endAtUtc, timeZone: 'UTC' };
  }
  if (event.recurrence) {
    out.recurrence = event.recurrence;
  }
  if (event.attendees) {
    out.attendees = event.attendees.map((attendee) => ({
      email: attendee.email ?? undefined,
      self: attendee.self ?? undefined,
      responseStatus: attendee.type ?? undefined,
    }));
  }
  return out;
}

export function createGoogleProvider(
  row: ProviderAccountRow,
  deps: GoogleProviderDeps = {},
): Provider {
  return {
    providerKey: 'google',
    accountId: row.accountId,
    accountEmail: row.displayEmail,
    capabilities: {
      recurrenceFormat: 'rrule',
      supportsSendUpdates: true,
      mailLabelModel: 'gmail',
      mailSendReturnsId: true,
    },
    disconnect: () => undefined,
    mail: {
      async listMessagesDelta(opts = {}) {
        return listMessagesDelta(await resolveGmailClient(deps), opts.cursor ?? null);
      },
      async getMessage(externalId: string) {
        return canonicalMessageFromGmail(await (await resolveGmailClient(deps)).getMessageMetadata(externalId));
      },
      async sendMessage(message: MailSendInput, opts: { idempotencyKey: string }) {
        const oauth = resolveOAuthClient('gmail', deps);
        if (!oauth) throw new Error('gmail-not-connected');
        const gmail = google.gmail({ version: 'v1', auth: oauth });
        const raw = buildRfc2822(message, opts.idempotencyKey);
        const response = await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw: Buffer.from(raw, 'utf8').toString('base64url') },
        });
        const externalId = response.data.id ?? null;
        if (!externalId) {
          throw new Error('gmail-send-returned-no-id');
        }
        return { externalId };
      },
      async findSentByIdempotencyKey(key: string) {
        const oauth = resolveOAuthClient('gmail', deps);
        if (!oauth) throw new Error('gmail-not-connected');
        return gmailSearchByIdempotencyKey(oauth, key);
      },
    },
    calendar: {
      async listEventsDelta(opts = {}) {
        const client = await resolveCalendarClient(deps);
        const page = opts.cursor
          ? await client.listEvents({ syncToken: opts.cursor })
          : await client.listEventsWindow({
              timeMin: opts.startDateTime ?? new Date(Date.now() - 86_400_000).toISOString(),
              timeMax: opts.endDateTime ?? new Date(Date.now() + 30 * 86_400_000).toISOString(),
              singleEvents: true,
            });
        return {
          items: page.items.map(calendarEventToCanonical),
          tombstones: [],
          cursor: page.nextSyncToken ?? opts.cursor ?? '',
          hadFullResync: !opts.cursor,
        };
      },
      async listEventsWindow(opts) {
        const client = await resolveCalendarClient(deps);
        const page = await client.listEventsWindow({
          timeMin: opts.startDateTime,
          timeMax: opts.endDateTime,
          singleEvents: true,
        });
        return {
          items: page.items.map(calendarEventToCanonical),
          tombstones: [],
          cursor: page.nextSyncToken ?? '',
          hadFullResync: true,
        };
      },
      async getEvent(externalId: string) {
        const client = await resolveCalendarClient(deps);
        const res = await client.listEventsWindow({
          timeMin: new Date(Date.now() - 86_400_000).toISOString(),
          timeMax: new Date(Date.now() + 86_400_000).toISOString(),
          singleEvents: true,
        });
        return res.items.map(calendarEventToCanonical).find((event) => event.externalId === externalId) ?? null;
      },
      async patchEvent(args) {
        const client = await resolveCalendarClient(deps);
        const result = await client.patchEvent({
          eventId: args.externalId,
          requestBody: canonicalEventToGoogle(args.event),
          ifMatch: args.ifMatch,
          sendUpdates: args.sendUpdates ?? 'none',
        });
        return { externalId: result.id, etag: result.etag };
      },
      async insertEvent(args) {
        const client = await resolveCalendarClient(deps);
        const result = await client.insertEvent({
          requestBody: canonicalEventToGoogle(args.event),
          sendUpdates: args.sendUpdates ?? 'none',
        });
        return { externalId: result.id, etag: result.etag };
      },
      async eventInstances(args) {
        const client = await resolveCalendarClient(deps);
        const items = await client.eventsInstances({
          eventId: args.externalId,
          timeMin: args.startDateTime,
          timeMax: args.endDateTime,
        });
        return items.map(calendarEventToCanonical);
      },
      async freeBusy(args) {
        const client = await resolveCalendarClient(deps);
        const result = await client.freebusyQuery({
          timeMin: args.startDateTime,
          timeMax: args.endDateTime,
          calendarIds: args.calendarIds,
        });
        const busy: Record<string, Array<{ start: string; end: string }>> = {};
        for (const [id, entry] of Object.entries(result.calendars)) {
          busy[id] = entry.busy;
        }
        return busy;
      },
    },
  };
}
