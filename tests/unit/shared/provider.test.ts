import { describe, expect, it } from 'vitest';
import type {
  CanonicalEvent,
  CanonicalMessage,
  Provider,
  ProviderCapabilities,
  ProviderKey,
} from '../../../src/shared/provider';

describe('shared provider types', () => {
  it('exports the shared provider key and capability surface', () => {
    const keys: ProviderKey[] = ['google', 'microsoft'];
    expect(keys).toEqual(['google', 'microsoft']);

    const capabilities: ProviderCapabilities = {
      recurrenceFormat: 'rrule',
      supportsSendUpdates: true,
      mailLabelModel: 'gmail',
      mailSendReturnsId: true,
    };

    const message: CanonicalMessage = {
      externalId: 'msg-1',
      threadId: 'thread-1',
      fromAddr: 'sender@example.com',
      subject: 'Hello',
      snippet: 'Preview',
      receivedAtUtc: '2026-05-18T00:00:00.000Z',
      labels: ['Inbox'],
      isUnread: true,
      isImportant: false,
      bodyText: 'Hello world',
    };

    const event: CanonicalEvent = {
      externalId: 'evt-1',
      summary: 'Team sync',
      startAtUtc: '2026-05-18T10:00:00.000Z',
      endAtUtc: '2026-05-18T10:30:00.000Z',
      isAllDay: false,
      isRecurring: false,
      recurrence: null,
      location: 'Room 1',
      description: 'Discuss status',
      webLink: 'https://example.com',
      iCalUid: 'ical-1',
      organizerEmail: 'organizer@example.com',
      organizerSelf: true,
      attendees: [{ email: 'attendee@example.com', self: false, type: 'required' }],
    };

    const provider: Provider = {
      providerKey: 'google',
      accountId: 'acct-1',
      accountEmail: 'user@example.com',
      capabilities,
      mail: {
        listMessagesDelta: async () => ({ items: [message], tombstones: [], cursor: 'cursor-1', hadFullResync: false }),
        getMessage: async () => message,
        sendMessage: async () => ({ externalId: 'sent-1' }),
        findSentByIdempotencyKey: async () => 'sent-1',
      },
      calendar: {
        listEventsDelta: async () => ({ items: [event], tombstones: [], cursor: 'cursor-1', hadFullResync: false }),
        listEventsWindow: async () => ({ items: [event], tombstones: [], cursor: 'cursor-1', hadFullResync: true }),
        getEvent: async () => event,
        patchEvent: async () => ({ externalId: 'evt-1' }),
        insertEvent: async () => ({ externalId: 'evt-2' }),
        eventInstances: async () => [event],
        freeBusy: async () => ({ primary: [{ start: event.startAtUtc ?? '', end: event.endAtUtc ?? '' }] }),
      },
      disconnect: () => undefined,
    };

    expect(provider.capabilities.recurrenceFormat).toBe('rrule');
    expect(provider.mail?.findSentByIdempotencyKey).toBeDefined();
    expect(provider.calendar?.patchEvent).toBeDefined();
  });
});
