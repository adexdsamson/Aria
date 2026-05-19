import { describe, expect, it, beforeEach, vi } from 'vitest';
import { GraphRecurrenceUnsupported } from '../../../../../src/main/integrations/microsoft/errors';
import { createMicrosoftProvider } from '../../../../../src/main/integrations/microsoft/provider-adapter';

function makeRow() {
  return {
    accountId: 'acct-ms',
    providerKey: 'microsoft' as const,
    displayEmail: 'user@contoso.com',
    displayLabel: 'Contoso',
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

describe('microsoft provider adapter', () => {
  let api: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    api = vi.fn((path: string) => {
      const post = vi.fn(async () => {
        if (path.includes('/createReply')) {
          return { id: 'draft-1' };
        }
        return {};
      });
      const get = vi.fn(async () => {
        if (path.includes('SentItems')) {
          return { value: [{ id: 'sent-1' }] };
        }
        return { value: [] };
      });
      const patch = vi.fn(async () => ({ id: 'evt-1', '@odata.etag': 'etag-2' }));
      return {
        select: vi.fn(() => ({ get })),
        get,
        post,
        patch,
        header: vi.fn(() => ({ patch })),
      };
    });
  });

  it('uses the Graph send/write paths and converts recurrence losslessly', async () => {
    const provider = createMicrosoftProvider(makeRow() as never, {
      graphClient: { graph: { api } } as never,
    });

    const sent = await provider.mail!.sendMessage(
      {
        to: ['recipient@example.com'],
        subject: 'Hello',
        bodyText: 'Reply body',
        inReplyToExternalId: 'msg-1',
      },
      { idempotencyKey: 'idem-ms-1' },
    );
    expect(sent.externalId).toBe('sent-1');
    expect(api).toHaveBeenCalledWith('/me/messages/msg-1/createReply');
    expect(api).toHaveBeenCalledWith('/me/messages/draft-1/send');

    const sentAgain = await provider.mail!.sendMessage(
      {
        to: ['recipient@example.com'],
        subject: 'Hello',
        bodyText: 'One-off send',
      },
      { idempotencyKey: 'idem-ms-2' },
    );
    expect(sentAgain.externalId).toBe('sent-1');
    expect(api).toHaveBeenCalledWith('/me/sendMail');

    const lookedUp = await provider.mail!.findSentByIdempotencyKey('idem-ms-2');
    expect(lookedUp).toBe('sent-1');
    expect(api).toHaveBeenCalledWith(
      "/me/mailFolders/SentItems/messages?$filter=internetMessageHeaders/any(h:h/name eq 'X-Aria-Idempotency-Key' and h/value eq 'idem-ms-2')&$top=1&$select=id",
    );

    const patched = await provider.calendar!.patchEvent({
      externalId: 'evt-1',
      event: {
        recurrence: ['RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE'],
      },
    });
    expect(patched).toEqual({ externalId: 'evt-1', etag: 'etag-2' });
    expect(api).toHaveBeenCalledWith('/me/events/evt-1');

    await expect(
      provider.calendar!.patchEvent({
        externalId: 'evt-1',
        event: { recurrence: ['RRULE:FREQ=MONTHLY;BYDAY=MO'] },
      }),
    ).rejects.toBeInstanceOf(GraphRecurrenceUnsupported);

    expect(provider.capabilities.recurrenceFormat).toBe('graph');
  });
});
