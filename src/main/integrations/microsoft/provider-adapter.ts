import type {
  CanonicalEvent,
  CanonicalMessage,
  DeltaResult,
  MailSendInput,
  Provider,
} from '../../../shared/provider';
import { GraphRecurrenceUnsupported } from './errors';
import { createGraphClient, type GraphClientHandle } from './client';
import {
  getMessage,
  listMessagesDelta,
  sendMailViaGraph,
  type MicrosoftMailClient,
} from './mail';
import {
  eventInstances,
  freebusyQuery,
  insertEvent,
  listEventsDelta,
  patchEvent,
  type MicrosoftCalendarClient,
} from './calendar';
import { rruleToGraphRecurrence } from './recurrence-graph';
import type { ProviderAccountRow } from './types';

export interface MicrosoftProviderDeps {
  graphClient?: GraphClientHandle;
  buildGraphClient?: (accountId: string) => GraphClientHandle;
}

function resolveGraphClient(row: ProviderAccountRow, deps: MicrosoftProviderDeps = {}): GraphClientHandle {
  return deps.graphClient ?? deps.buildGraphClient?.(row.accountId) ?? createGraphClient(row.accountId);
}

function normalizeMessage(item: Awaited<ReturnType<typeof getMessage>>): CanonicalMessage {
  const fromAddr =
    item.from?.emailAddress?.address ??
    item.sender?.emailAddress?.address ??
    '';
  const threadId = item.conversationId ?? item.internetMessageId ?? item.id;
  const labels = item.categories ?? [];
  return {
    externalId: item.id,
    threadId,
    fromAddr,
    subject: item.subject ?? '',
    snippet: item.bodyPreview ?? '',
    receivedAtUtc: item.receivedDateTime ?? item.sentDateTime ?? new Date().toISOString(),
    labels,
    isUnread: item.isRead ? false : true,
    isImportant: item.importance === 'high' || item.flag?.flagStatus === 'flagged',
    bodyText: item.body?.content ?? null,
  };
}

function normalizeEvent(item: Awaited<ReturnType<typeof listEventsDelta>>['items'][number]): CanonicalEvent {
  const startAtUtc = item.start?.dateTime ? new Date(item.start.dateTime).toISOString() : null;
  const endAtUtc = item.end?.dateTime ? new Date(item.end.dateTime).toISOString() : null;
  const startDate = item.start?.date ?? null;
  const endDate = item.end?.date ?? null;
  const isAllDay = Boolean(startDate || endDate) && !startAtUtc && !endAtUtc;
  return {
    externalId: item.id,
    summary: item.subject ?? '',
    startAtUtc,
    endAtUtc,
    startDate,
    endDate,
    isAllDay,
    isRecurring: Boolean(item.isRecurring ?? item.recurrence),
    recurrence: item.recurrence && Array.isArray(item.recurrence) ? (item.recurrence as string[]) : null,
    recurrenceUnsupported: false,
    location: item.location?.displayName ?? null,
    description: item.body?.content ?? null,
    webLink: item.webLink ?? null,
    iCalUid: item.iCalUId ?? null,
    organizerEmail: item.organizer?.emailAddress?.address ?? null,
    organizerSelf: item.organizer?.self ?? null,
    attendees: item.attendees?.map((attendee) => ({
      email: attendee.emailAddress?.address ?? null,
      self: attendee.status?.response ? false : null,
      type: attendee.type ?? null,
    })),
  };
}

function buildRecipients(addresses: string[] | undefined): Array<{ emailAddress: { address: string } }> {
  return (addresses ?? []).map((address) => ({ emailAddress: { address } }));
}

async function findSentByIdempotencyKey(
  client: GraphClientHandle,
  key: string,
): Promise<string | null> {
  const res = await client.graph
    .api(
      `/me/mailFolders/SentItems/messages?$filter=internetMessageHeaders/any(h:h/name eq 'X-Aria-Idempotency-Key' and h/value eq '${key}')&$top=1&$select=id`,
    )
    .get();
  const body = res as { value?: Array<{ id?: string }> };
  return body.value?.[0]?.id ?? null;
}

async function sendGraphMail(
  client: GraphClientHandle,
  message: MailSendInput,
  idempotencyKey: string,
): Promise<string> {
  const body = {
    message: {
      subject: message.subject,
      body: { contentType: 'text', content: message.bodyText },
      toRecipients: buildRecipients(message.to),
      ccRecipients: buildRecipients(message.cc),
      bccRecipients: buildRecipients(message.bcc),
      internetMessageHeaders: [
        { name: 'X-Aria-Idempotency-Key', value: idempotencyKey },
      ],
      ...(message.inReplyToExternalId
        ? {
            inReplyTo: message.inReplyToExternalId,
            replyTo: buildRecipients([message.to[0] ?? '']),
          }
        : {}),
    },
    saveToSentItems: true,
  };

  if (message.inReplyToExternalId) {
    const draft = await client.graph.api(`/me/messages/${message.inReplyToExternalId}/createReply`).post(body);
    const draftId = (draft as { id?: string }).id ?? message.inReplyToExternalId;
    await client.graph.api(`/me/messages/${draftId}/send`).post({});
  } else {
    await sendMailViaGraph(client as MicrosoftMailClient, body);
  }

  const sentId = await findSentByIdempotencyKey(client, idempotencyKey);
  if (!sentId) {
    throw new Error('microsoft-send-returned-no-id');
  }
  return sentId;
}

function eventToGraph(event: Partial<CanonicalEvent>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (event.summary !== undefined) out.subject = event.summary;
  if (event.location !== undefined) out.location = { displayName: event.location ?? '' };
  if (event.description !== undefined) {
    out.body = { contentType: 'text', content: event.description ?? '' };
  }
  if (event.startAtUtc || event.startDate) {
    out.start = event.startDate
      ? { date: event.startDate, timeZone: 'UTC' }
      : { dateTime: event.startAtUtc, timeZone: 'UTC' };
  }
  if (event.endAtUtc || event.endDate) {
    out.end = event.endDate
      ? { date: event.endDate, timeZone: 'UTC' }
      : { dateTime: event.endAtUtc, timeZone: 'UTC' };
  }
  if (event.recurrence) {
    const converted = rruleToGraphRecurrence(event.recurrence[0] ?? '');
    if (converted.unsupported) {
      throw new GraphRecurrenceUnsupported(converted.reason);
    }
    out.recurrence = converted.recurrence;
  }
  if (event.attendees) {
    out.attendees = event.attendees.map((attendee) => ({
      emailAddress: { address: attendee.email ?? '' },
      type: attendee.type ?? 'required',
    }));
  }
  return out;
}

export function createMicrosoftProvider(
  row: ProviderAccountRow,
  deps: MicrosoftProviderDeps = {},
): Provider {
  const graphClient = resolveGraphClient(row, deps);
  return {
    providerKey: 'microsoft',
    accountId: row.accountId,
    accountEmail: row.displayEmail,
    capabilities: {
      recurrenceFormat: 'graph',
      supportsSendUpdates: true,
      mailLabelModel: 'outlook',
      mailSendReturnsId: true,
    },
    disconnect: () => undefined,
    mail: {
      async listMessagesDelta(opts = {}) {
        const result = await listMessagesDelta(graphClient as MicrosoftMailClient, { cursor: opts.cursor ?? null });
        return {
          items: result.items.map((item) => ({
            externalId: item.id,
            threadId: item.conversationId ?? item.internetMessageId ?? item.id,
            fromAddr: item.from?.emailAddress?.address ?? item.sender?.emailAddress?.address ?? '',
            subject: item.subject ?? '',
            snippet: item.bodyPreview ?? '',
            receivedAtUtc: item.receivedDateTime ?? item.sentDateTime ?? new Date().toISOString(),
            labels: item.categories ?? [],
            isUnread: item.isRead ? false : true,
            isImportant: item.importance === 'high' || item.flag?.flagStatus === 'flagged',
            bodyText: item.body?.content ?? null,
          })),
          tombstones: result.tombstones,
          cursor: result.cursor,
          hadFullResync: result.hadFullResync,
        } satisfies DeltaResult<CanonicalMessage>;
      },
      async getMessage(externalId: string) {
        return normalizeMessage(await getMessage(graphClient as MicrosoftMailClient, externalId));
      },
      async sendMessage(message, opts) {
        return { externalId: await sendGraphMail(graphClient, message, opts.idempotencyKey) };
      },
      async findSentByIdempotencyKey(key: string) {
        return findSentByIdempotencyKey(graphClient, key);
      },
    },
    calendar: {
      async listEventsDelta(opts = {}) {
        const result = await listEventsDelta(graphClient as MicrosoftCalendarClient, {
          cursor: opts.cursor ?? null,
          startDateTime: opts.startDateTime,
          endDateTime: opts.endDateTime,
        });
        return {
          items: result.items.map(normalizeEvent),
          tombstones: result.tombstones,
          cursor: result.cursor,
          hadFullResync: result.hadFullResync,
        };
      },
      async listEventsWindow(opts) {
        const result = await listEventsDelta(graphClient as MicrosoftCalendarClient, {
          startDateTime: opts.startDateTime,
          endDateTime: opts.endDateTime,
        });
        return {
          items: result.items.map(normalizeEvent),
          tombstones: result.tombstones,
          cursor: result.cursor,
          hadFullResync: result.hadFullResync,
        };
      },
      async getEvent(externalId: string) {
        const result = await listEventsDelta(graphClient as MicrosoftCalendarClient, {});
        return result.items.map(normalizeEvent).find((event) => event.externalId === externalId) ?? null;
      },
      async patchEvent(args) {
        const result = await patchEvent(graphClient as MicrosoftCalendarClient, {
          eventId: args.externalId,
          requestBody: eventToGraph(args.event),
          ifMatch: args.ifMatch,
          sendUpdates: args.sendUpdates ?? 'none',
        });
        return { externalId: result.id, etag: result.etag };
      },
      async insertEvent(args) {
        const result = await insertEvent(graphClient as MicrosoftCalendarClient, {
          requestBody: eventToGraph(args.event),
          sendUpdates: args.sendUpdates ?? 'none',
        });
        return { externalId: result.id, etag: result.etag };
      },
      async eventInstances(args) {
        const items = await eventInstances(graphClient as MicrosoftCalendarClient, {
          eventId: args.externalId,
          timeMin: args.startDateTime,
          timeMax: args.endDateTime,
        });
        return items.map(normalizeEvent);
      },
      async freeBusy(args) {
        const result = await freebusyQuery(graphClient as MicrosoftCalendarClient, {
          timeMin: args.startDateTime,
          timeMax: args.endDateTime,
          calendarIds: args.calendarIds,
        });
        const busy: Record<string, Array<{ start: string; end: string }>> = {};
        for (const [id, value] of Object.entries(result.calendars)) {
          busy[id] = value.busy;
        }
        return busy;
      },
    },
  };
}
