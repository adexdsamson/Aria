import * as http from 'node:http';
import { URL } from 'node:url';
import { BrowserWindow } from 'electron';
import {
  CryptoProvider,
  PublicClientApplication,
  type AuthorizationCodeRequest,
  type AuthorizationUrlRequest,
  type Configuration,
  type AuthenticationResult,
} from '@azure/msal-node';
import { OAuthConfigMissingError } from './errors';
import { fetchSelfIdentity } from './identity';
import { writeMicrosoftCache } from './cache';

export const MICROSOFT_SCOPES = [
  'User.Read',
  'offline_access',
  'Mail.Read',
  'Mail.Send',
  'Calendars.ReadWrite',
] as const;

export interface ConnectMicrosoftResult {
  accountId: string;
  email: string;
  displayName: string;
  identitySet: { primaryEmail: string; aliases: string[] };
}

export interface ConnectMicrosoftDeps {
  openAuthWindow?: (url: string) => { close: () => void };
  createLoopback?: (opts: { expectedState: string }) => Promise<LoopbackSession>;
  createPca?: (config: Configuration) => PublicClientApplication;
  fetchSelfIdentity?: typeof fetchSelfIdentity;
  persistCache?: (accountId: string, blob: string) => void;
}

interface LoopbackSession {
  server: http.Server;
  port: number;
  close: () => void;
  waitForCode: Promise<string>;
}

function readOAuthConfig(): { clientId: string; tenantId: string } {
  const clientId = process.env.MS_OAUTH_CLIENT_ID;
  const tenantId = process.env.MS_OAUTH_TENANT_ID ?? 'common';
  if (!clientId) {
    throw new OAuthConfigMissingError('Missing MS_OAUTH_CLIENT_ID. Register a public-client desktop app in Entra.');
  }
  return { clientId, tenantId };
}

export function buildMicrosoftPca(config: Configuration): PublicClientApplication {
  return new PublicClientApplication(config);
}

function createDefaultLoopbackSession(input: { expectedState: string }): Promise<LoopbackSession> {
  const { expectedState } = input;
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    let settled = false;
    let resolveCode: (code: string) => void = () => {};
    let rejectCode: (err: Error) => void = () => {};
    const waitForCode = new Promise<string>((resolvePromise, rejectPromise) => {
      resolveCode = resolvePromise;
      rejectCode = rejectPromise;
    });

    const finishWithError = (message: string) => {
      if (settled) return;
      settled = true;
      rejectCode(new Error(message));
    };

    server.on('request', (req, res) => {
      try {
        const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (requestUrl.pathname !== '/callback') {
          res.writeHead(404).end('Not found');
          return;
        }
        const code = requestUrl.searchParams.get('code');
        const gotState = requestUrl.searchParams.get('state');
        const error = requestUrl.searchParams.get('error');
        if (error) {
          res.writeHead(400).end(`OAuth error: ${error}`);
          finishWithError(`OAuth error: ${error}`);
          return;
        }
        if (gotState !== expectedState) {
          res.writeHead(400).end('State mismatch');
          finishWithError('OAuth state parameter did not match expected value');
          return;
        }
        if (!code) {
          res.writeHead(400).end('Missing code');
          finishWithError('OAuth redirect missing code parameter');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Aria connected.</h1><p>You may close this window.</p></body></html>');
        if (!settled) {
          settled = true;
          resolveCode(code);
        }
      } catch (err) {
        finishWithError(err instanceof Error ? err.message : 'OAuth loopback failed');
      }
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('loopback server failed to bind'));
        return;
      }
      resolve({
        server,
        port: addr.port,
        close: () => server.close(),
        waitForCode,
      });
    });
  });
}

export async function connectMicrosoft(deps: ConnectMicrosoftDeps = {}): Promise<ConnectMicrosoftResult> {
  const { clientId, tenantId } = readOAuthConfig();
  const authority = `https://login.microsoftonline.com/${tenantId}`;
  const pca = deps.createPca ?? ((config) => buildMicrosoftPca(config));
  const app = pca({
    auth: {
      clientId,
      authority,
    },
  });
  const pkce = await new CryptoProvider().generatePkceCodes();
  const state = new CryptoProvider().createNewGuid();
  const loopbackFactory = deps.createLoopback ?? createDefaultLoopbackSession;
  const { port, close, waitForCode } = await loopbackFactory({ expectedState: state });
  const redirectUri = `http://localhost:${port}/callback`;
  const authRequest: AuthorizationUrlRequest = {
    scopes: [...MICROSOFT_SCOPES],
    redirectUri,
    prompt: 'select_account',
    codeChallenge: pkce.challenge,
    codeChallengeMethod: 'S256',
    state,
  };

  const authWindow = deps.openAuthWindow ?? ((url: string) => {
    const win = new BrowserWindow({
      width: 540,
      height: 760,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    void win.loadURL(url);
    return { close: () => win.destroy() };
  });

  const windowHandle = authWindow(await app.getAuthCodeUrl(authRequest));

  try {
    const code = await waitForCode;

    const tokenRequest: AuthorizationCodeRequest = {
      scopes: [...MICROSOFT_SCOPES],
      redirectUri,
      code,
      codeVerifier: pkce.verifier,
    };
    const result: AuthenticationResult = await app.acquireTokenByCode(tokenRequest);
    const account = result.account;
    if (!account?.homeAccountId) {
      throw new Error('Microsoft auth did not return an account homeAccountId');
    }

    const identity = await (deps.fetchSelfIdentity ?? fetchSelfIdentity)(result.accessToken);
    const cacheBlob = app.getTokenCache().serialize();
    (deps.persistCache ?? writeMicrosoftCache)(account.homeAccountId, cacheBlob);

    return {
      accountId: account.homeAccountId,
      email: identity.primaryEmail,
      displayName: identity.displayName || identity.primaryEmail,
      identitySet: identity.identitySet,
    };
  } finally {
    windowHandle.close();
    close();
  }
}
