import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('microsoft auth', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.MS_OAUTH_CLIENT_ID;
    delete process.env.MS_OAUTH_TENANT_ID;
    vi.doMock('electron', () => ({
      BrowserWindow: class BrowserWindow {
        destroy = vi.fn();
        loadURL = vi.fn();
      },
    }));
    vi.doMock('../../../../src/main/integrations/microsoft/cache', () => ({
      writeMicrosoftCache: vi.fn(),
      readMicrosoftCache: vi.fn(),
      createMicrosoftPca: vi.fn(),
      createSafeStorageCachePlugin: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('electron');
    vi.doUnmock('../../../../src/main/integrations/microsoft/cache');
  });

  it('runs the loopback auth flow and persists the token cache', async () => {
    process.env.MS_OAUTH_CLIENT_ID = 'client-id';
    process.env.MS_OAUTH_TENANT_ID = 'common';

    let capturedAuthRequest: {
      scopes: string[];
      redirectUri: string;
      prompt: string;
      codeChallenge: string;
      codeChallengeMethod: string;
      state: string;
    } | null = null;
    const openAuthWindow = vi.fn(() => ({ close: vi.fn() }));
    const persistCache = vi.fn();
    const fetchSelfIdentity = vi.fn(async () => ({
      upn: 'user@contoso.com',
      mail: 'user@contoso.com',
      proxyAddresses: ['SMTP:user@contoso.com'],
      displayName: 'Contoso User',
      primaryEmail: 'user@contoso.com',
      identitySet: { primaryEmail: 'user@contoso.com', aliases: ['user@contoso.com'] },
    }));
    const createPca = vi.fn(() => {
      return {
        getAuthCodeUrl: vi.fn(async (request) => {
          capturedAuthRequest = request;
          return 'https://login.example/authorize';
        }),
        acquireTokenByCode: vi.fn(async (request) => ({
          accessToken: 'access-token',
          account: { homeAccountId: 'home-account-1' },
          scopes: request.scopes,
        })),
        getTokenCache: () => ({
          serialize: () => 'serialized-cache',
        }),
      };
    });
    const createLoopback = vi.fn(async ({ expectedState }: { expectedState: string }) => ({
      port: 37891,
      close: vi.fn(),
      waitForCode: Promise.resolve('auth-code-123'),
      expectedState,
      server: {} as never,
    }));

    const { connectMicrosoft, MICROSOFT_SCOPES } = await import('../../../../../src/main/integrations/microsoft/auth');
    const result = await connectMicrosoft({
      openAuthWindow,
      createLoopback,
      createPca: createPca as any,
      fetchSelfIdentity,
      persistCache,
    });

    expect(result).toEqual({
      accountId: 'home-account-1',
      email: 'user@contoso.com',
      displayName: 'Contoso User',
      identitySet: { primaryEmail: 'user@contoso.com', aliases: ['user@contoso.com'] },
    });
    expect(createLoopback).toHaveBeenCalledWith({ expectedState: expect.any(String) });
    expect(capturedAuthRequest).toMatchObject({
      scopes: [...MICROSOFT_SCOPES],
      redirectUri: 'http://localhost:37891/callback',
      prompt: 'select_account',
      codeChallengeMethod: 'S256',
    });
    expect(capturedAuthRequest?.state).toBeTruthy();
    expect(openAuthWindow).toHaveBeenCalledWith('https://login.example/authorize');
    expect(persistCache).toHaveBeenCalledWith('home-account-1', 'serialized-cache');
    expect(fetchSelfIdentity).toHaveBeenCalledWith('access-token');
  });
});
