import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { OAuth2Client } from 'google-auth-library';

const googleMocks = vi.hoisted(() => ({
  gmailFactory: vi.fn(),
  gmailSend: vi.fn(),
  gmailList: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    gmail: googleMocks.gmailFactory,
  },
}));

function makeRow() {
  return {
    accountId: 'acct-google',
    providerKey: 'google' as const,
    displayEmail: 'user@gmail.com',
    displayLabel: 'User',
    displayColor: null,
    status: 'ok' as const,
    identitySet: null,
    capabilitiesJson: '{"mail":true,"calendar":true}',
    lastSyncedAt: null,
    lastError: null,
    lastErrorAt: null,
    createdAt: '2026-05-18T00:00:00.000Z',
  };
}

describe('google provider adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    googleMocks.gmailFactory.mockReturnValue({
      users: {
        messages: {
          send: googleMocks.gmailSend,
          list: googleMocks.gmailList,
        },
      },
    });
  });

  it('returns canonical deltas and injects the idempotency header on send', async () => {
    const gmailClient = {
      listHistory: vi.fn(async () => ({
        history: [
          {
            messagesAdded: [{ message: { id: 'msg-1', threadId: 'thread-1' } }],
            messagesDeleted: [{ message: { id: 'gone-1', threadId: 'thread-1' } }],
          },
        ],
        historyId: 'history-2',
      })),
      listMessages: vi.fn(),
      getMessageMetadata: vi.fn(async (id: string) => ({
        id,
        threadId: 'thread-1',
        internalDate: '1716026400000',
        snippet: 'Preview',
        labelIds: ['UNREAD', 'IMPORTANT'],
        payload: {
          headers: [
            { name: 'From', value: 'sender@example.com' },
            { name: 'Subject', value: 'Hello from Gmail' },
          ],
        },
      })),
      getProfile: vi.fn(),
    };
    const oauth = {} as OAuth2Client;
    const { createGoogleProvider } = await import('../../../../../src/main/integrations/google/provider-adapter');
    const provider = createGoogleProvider(makeRow() as never, {
      gmailClient: gmailClient as never,
      getOAuth2Client: () => oauth,
    });

    const delta = await provider.mail!.listMessagesDelta({ cursor: 'history-1' });
    expect(delta.cursor).toBe('history-2');
    expect(delta.tombstones).toEqual(['gone-1']);
    expect(delta.items[0]).toMatchObject({
      externalId: 'msg-1',
      threadId: 'thread-1',
      fromAddr: 'sender@example.com',
      subject: 'Hello from Gmail',
      isUnread: true,
      isImportant: true,
    });

    googleMocks.gmailSend.mockResolvedValue({ data: { id: 'sent-1' } });
    googleMocks.gmailList.mockResolvedValue({ data: { messages: [{ id: 'sent-1' }] } });

    const result = await provider.mail!.sendMessage(
      {
        to: ['recipient@example.com'],
        subject: 'Reply',
        bodyText: 'Hello there',
        inReplyToExternalId: 'msg-1',
      },
      { idempotencyKey: 'idem-1' },
    );

    expect(result.externalId).toBe('sent-1');
    const raw = googleMocks.gmailSend.mock.calls[0]?.[0]?.requestBody?.raw as string;
    expect(Buffer.from(raw, 'base64url').toString('utf8')).toContain('X-Aria-Idempotency-Key: idem-1');
    expect(googleMocks.gmailFactory).toHaveBeenCalled();

    const sentId = await provider.mail!.findSentByIdempotencyKey('idem-1');
    expect(sentId).toBe('sent-1');
    expect(googleMocks.gmailList).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'me',
        q: 'in:sent rfc822msgid:* "X-Aria-Idempotency-Key:idem-1"',
      }),
    );
    expect(provider.capabilities.recurrenceFormat).toBe('rrule');
  });
});
