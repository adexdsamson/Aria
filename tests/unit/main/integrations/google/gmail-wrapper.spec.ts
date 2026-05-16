/**
 * Plan 02-01 Task 2 — gmail.ts wrapper error-translation tests.
 *
 * This is the ONE test file that uses `vi.mock('googleapis', ...)` so we can
 * inject error shapes the real Gmail API returns. Every other test in this
 * plan uses pure DI against the `GmailClient` interface.
 *
 * Cases:
 *   - 404 / notFound on history.list → HistoryInvalidatedError
 *   - 401 + invalid_grant reason → TokenInvalidError({reason:'expired'})
 *   - H2: real google-auth-library payload shape
 *         { response: { status:400, data:{ error:'invalid_grant',
 *           error_description:'Token has been expired or revoked.' }}}
 *         → TokenInvalidError({reason:'expired'})  (test-mode 7d, NOT revoked)
 *   - happy path passthrough.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted ensures the stubs are created BEFORE the hoisted vi.mock factory
// runs (otherwise the references inside the factory are undefined).
const stubs = vi.hoisted(() => ({
  historyList: vi.fn(),
  messagesGet: vi.fn(),
  messagesList: vi.fn(),
  getProfile: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    gmail: () => ({
      users: {
        history: { list: stubs.historyList },
        messages: { list: stubs.messagesList, get: stubs.messagesGet },
        getProfile: stubs.getProfile,
      },
    }),
  },
}));

import { createGmailClient, HistoryInvalidatedError, TokenInvalidError } from '../../../../../src/main/integrations/google/gmail';

describe('createGmailClient error translation', () => {
  beforeEach(() => {
    stubs.historyList.mockReset();
    stubs.messagesGet.mockReset();
    stubs.messagesList.mockReset();
    stubs.getProfile.mockReset();
  });

  function makeClient() {
    return createGmailClient(null as never);
  }
  const m = { HistoryInvalidatedError, TokenInvalidError };

  it('history.list returning 404/notFound → HistoryInvalidatedError', async () => {
    stubs.historyList.mockRejectedValue({ code: 404, errors: [{ reason: 'notFound' }] });
    const client = makeClient();
    await expect(client.listHistory({ startHistoryId: '1' })).rejects.toBeInstanceOf(
      m.HistoryInvalidatedError,
    );
  });

  it('messages.get with 401 invalid_grant reason → TokenInvalidError(expired)', async () => {
    stubs.messagesGet.mockRejectedValue({ code: 401, errors: [{ reason: 'invalid_grant' }] });
    const client = makeClient();
    try {
      await client.getMessageMetadata('m1');
      throw new Error('expected rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(m.TokenInvalidError);
      expect((err as InstanceType<typeof m.TokenInvalidError>).reason).toBe('expired');
    }
  });

  it('H2: real google-auth-library invalid_grant payload → TokenInvalidError(expired)', async () => {
    // The test-mode 7d-expiry payload shape google-auth-library actually emits:
    stubs.historyList.mockRejectedValue({
      response: {
        status: 400,
        data: {
          error: 'invalid_grant',
          error_description: 'Token has been expired or revoked.',
        },
      },
    });
    const client = makeClient();
    try {
      await client.listHistory({ startHistoryId: '1' });
      throw new Error('expected rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(m.TokenInvalidError);
      // "Token has been expired or revoked." MUST map to 'expired' (test-mode 7d),
      // NOT 'revoked'. Only an unambiguous 'revoked' (e.g. user-revoked via
      // myaccount.google.com/permissions) yields reason: 'revoked'.
      expect((err as InstanceType<typeof m.TokenInvalidError>).reason).toBe('expired');
    }
  });

  it('happy path: history.list passes through with historyId', async () => {
    stubs.historyList.mockResolvedValue({ data: { history: [], historyId: '42' } });
    const client = makeClient();
    const result = await client.listHistory({ startHistoryId: '1' });
    expect(result).toEqual({ history: [], historyId: '42' });
  });
});
