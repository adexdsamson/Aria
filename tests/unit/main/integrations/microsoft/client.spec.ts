import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('microsoft client', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doMock('../../../../src/main/integrations/microsoft/cache', () => ({
      readMicrosoftCache: vi.fn(() => 'serialized-cache'),
      writeMicrosoftCache: vi.fn(),
      createMicrosoftPca: vi.fn(),
      createSafeStorageCachePlugin: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../../../../src/main/integrations/microsoft/cache');
    vi.doUnmock('@microsoft/microsoft-graph-client');
  });

  it('retries a 401 once with forceRefresh enabled', async () => {
    let authProviderRef: { getAccessToken: () => Promise<string> } | null = null;
    let requestCount = 0;
    const graph = {
      api: vi.fn((path: string) => ({
        get: async () => {
          const token = await authProviderRef!.getAccessToken();
          requestCount += 1;
          if (requestCount === 1) {
            const err = new Error('Unauthorized') as Error & { statusCode: number };
            err.statusCode = 401;
            throw err;
          }
          return { path, token, requestCount };
        },
      })),
    };
    vi.doMock('@microsoft/microsoft-graph-client', () => ({
      Client: {
        initWithMiddleware: vi.fn((options: { authProvider: { getAccessToken: () => Promise<string> } }) => {
          authProviderRef = options.authProvider;
          return graph;
        }),
      },
    }));

    const acquireTokenSilent = vi.fn(async (request: { forceRefresh?: boolean }) => ({
      accessToken: request.forceRefresh ? 'token-refreshed' : 'token-initial',
    }));
    const pca = {
      getTokenCache: () => ({
        deserialize: vi.fn(),
        getAllAccounts: vi.fn(async () => [{ homeAccountId: 'acct-1' }]),
      }),
      acquireTokenSilent,
    };

    const { createGraphClient } = await import('../../../../../src/main/integrations/microsoft/client');
    const client = createGraphClient('acct-1', { pca: pca as any });

    const result = await client.request<{ path: string; token: string; requestCount: number }>({
      path: '/me',
    });

    expect(result).toEqual({
      path: '/me',
      token: 'token-refreshed',
      requestCount: 2,
    });
    expect(acquireTokenSilent).toHaveBeenNthCalledWith(1, expect.objectContaining({ forceRefresh: false }));
    expect(acquireTokenSilent).toHaveBeenNthCalledWith(2, expect.objectContaining({ forceRefresh: true }));
    expect(graph.api).toHaveBeenCalledWith('/me');
  });
});
