import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('microsoft identity', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps Graph profile data into a stable identity shape', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          mail: 'primary@contoso.com',
          userPrincipalName: 'user@contoso.com',
          proxyAddresses: ['SMTP:alias@contoso.com', 42],
          displayName: 'Contoso User',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const { fetchSelfIdentity } = await import('../../../../../src/main/integrations/microsoft/identity');

    const identity = await fetchSelfIdentity('access-token');

    expect(identity.primaryEmail).toBe('primary@contoso.com');
    expect(identity.identitySet.aliases).toEqual([
      'primary@contoso.com',
      'user@contoso.com',
      'SMTP:alias@contoso.com',
    ]);
    expect(identity.displayName).toBe('Contoso User');
  });

  it('translates 401s into TokenInvalidError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 401 })),
    );
    const { fetchSelfIdentity } = await import('../../../../../src/main/integrations/microsoft/identity');

    await expect(fetchSelfIdentity('expired-token')).rejects.toMatchObject({
      name: 'TokenInvalidError',
      reason: 'expired',
    });
  });
});
