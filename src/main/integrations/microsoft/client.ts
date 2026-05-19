import { Client } from '@microsoft/microsoft-graph-client';
import type { AuthenticationResult, PublicClientApplication, SilentFlowRequest } from '@azure/msal-node';
import { createMicrosoftPca, readMicrosoftCache } from './cache';
import { TokenInvalidError } from './errors';

export interface GraphClientDeps {
  pca?: PublicClientApplication;
  createPca?: (accountId: string) => PublicClientApplication;
}

export interface GraphClientHandle {
  graph: Client;
  getAccessToken(opts?: { forceRefresh?: boolean }): Promise<string>;
  request<T = unknown>(opts: {
    path: string;
    method?: 'get' | 'post' | 'patch' | 'delete';
    body?: unknown;
    forceRefresh?: boolean;
  }): Promise<T>;
}

function isGraph401(err: unknown): boolean {
  const e = err as { statusCode?: number; status?: number; response?: { status?: number } };
  const status = e?.statusCode ?? e?.status ?? e?.response?.status;
  return status === 401;
}

function msalConfig() {
  const clientId = process.env.MS_OAUTH_CLIENT_ID;
  const tenantId = process.env.MS_OAUTH_TENANT_ID ?? 'common';
  if (!clientId) throw new Error('MS_OAUTH_CLIENT_ID is required to build Microsoft PCA');
  return {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
    },
    system: {
      loggerOptions: {
        loggerCallback: () => undefined,
        piiLoggingEnabled: false,
      },
    },
  } as const;
}

async function accountFromCache(pca: PublicClientApplication, accountId: string) {
  const cache = readMicrosoftCache(accountId);
  if (cache) {
    pca.getTokenCache().deserialize(cache);
  }
  const accounts = await pca.getTokenCache().getAllAccounts();
  return accounts.find((a) => a.homeAccountId === accountId) ?? null;
}

async function acquireTokenSilent(
  pca: PublicClientApplication,
  accountId: string,
  forceRefresh = false,
): Promise<string> {
  const account = await accountFromCache(pca, accountId);
  if (!account) {
    throw new TokenInvalidError({ reason: 'expired', message: 'Microsoft account cache missing' });
  }
  const request: SilentFlowRequest = {
    account,
    scopes: ['User.Read', 'offline_access', 'Mail.Read', 'Mail.Send', 'Calendars.ReadWrite'],
    forceRefresh,
  };
  try {
    const result: AuthenticationResult = await pca.acquireTokenSilent(request);
    if (!result.accessToken) {
      throw new TokenInvalidError({ reason: 'expired', message: 'Microsoft access token missing' });
    }
    return result.accessToken;
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'InteractionRequiredAuthError') {
      throw new TokenInvalidError({ reason: 'expired', message: err instanceof Error ? err.message : 'Interaction required' });
    }
    throw err;
  }
}

export function createGraphClient(accountId: string, deps: GraphClientDeps = {}): GraphClientHandle {
  const pca = deps.pca ?? (deps.createPca ? deps.createPca(accountId) : createMicrosoftPca(accountId, msalConfig()));
  let forceRefreshNext = false;

  async function getAccessToken(opts: { forceRefresh?: boolean } = {}): Promise<string> {
    const token = await acquireTokenSilent(pca, accountId, opts.forceRefresh ?? forceRefreshNext);
    forceRefreshNext = false;
    return token;
  }

  const graph = Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => getAccessToken(),
    },
  });

  async function request<T = unknown>(opts: {
    path: string;
    method?: 'get' | 'post' | 'patch' | 'delete';
    body?: unknown;
    forceRefresh?: boolean;
  }): Promise<T> {
    const run = async (): Promise<T> => {
      const req = graph.api(opts.path);
      switch (opts.method ?? 'get') {
        case 'get':
          return (await req.get()) as T;
        case 'post':
          return (await req.post(opts.body ?? {})) as T;
        case 'patch':
          return (await req.patch(opts.body ?? {})) as T;
        case 'delete':
          return (await req.delete()) as T;
      }
    };

    try {
      if (opts.forceRefresh) {
        forceRefreshNext = true;
      }
      return await run();
    } catch (err) {
      if (isGraph401(err) && !forceRefreshNext) {
        forceRefreshNext = true;
        try {
          return await run();
        } catch (retryErr) {
          if (isGraph401(retryErr)) {
            throw new TokenInvalidError({ reason: 'expired', message: 'Microsoft Graph returned 401 after refresh' });
          }
          throw retryErr;
        } finally {
          forceRefreshNext = false;
        }
      }
      if (isGraph401(err)) {
        throw new TokenInvalidError({ reason: 'expired', message: 'Microsoft Graph returned 401' });
      }
      throw err;
    } finally {
      if (opts.forceRefresh) {
        forceRefreshNext = false;
      }
    }
  }

  return {
    graph,
    getAccessToken,
    request,
  };
}
