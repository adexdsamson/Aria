/**
 * Plan 02-01 — OAuth/auth.ts tests.
 *
 * Task 1 portion (this file initially): safeStorage googleTokens round-trip
 * cases for the new setGoogleTokens / getGoogleTokens / clearGoogleTokens
 * surface. Task 2 will extend this file with the connectGoogle() loopback-flow
 * cases (PKCE challenge, success, NoRefreshTokenError, state-mismatch).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createTempUserDataDir } from '../../../../setup';

async function freshModule(dataDir: string) {
  vi.resetModules();
  vi.doMock('electron', async () => {
    const real = await vi.importActual<typeof import('electron')>('electron');
    return {
      ...real,
      app: {
        ...((real as { app?: unknown }).app ?? {}),
        isReady: () => true,
        whenReady: () => Promise.resolve(),
        getPath: () => dataDir,
        getName: () => 'Aria',
        getVersion: () => '0.1.0-test',
      },
      safeStorage: {
        isEncryptionAvailable: () => true,
        // Distinctive prefix so we can confirm the on-disk blob is NOT the raw token.
        encryptString: (s: string) => Buffer.from('enc:' + s, 'utf8'),
        decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
        getSelectedStorageBackend: () => 'keychain',
      },
    };
  });
  return await import('../../../../../src/main/secrets/safeStorage');
}

describe('safeStorage googleTokens subtree (Plan 02-01 Task 1)', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = createTempUserDataDir('aria-google-tokens');
  });

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('electron');
  });

  it('setGoogleTokens writes the disk file', async () => {
    const m = await freshModule(dataDir);
    m.setGoogleTokens({ kind: 'gmail', refreshToken: 'rt-abc', email: 'foo@bar.com' });
    const secretsPath = path.join(dataDir, 'secrets.json');
    expect(fs.existsSync(secretsPath)).toBe(true);
    const raw = fs.readFileSync(secretsPath, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.googleTokens?.gmail).toBeTruthy();
    expect(parsed.googleTokens.gmail.email).toBe('foo@bar.com');
  });

  it('getGoogleTokens round-trips', async () => {
    const m = await freshModule(dataDir);
    m.setGoogleTokens({ kind: 'gmail', refreshToken: 'rt-abc', email: 'foo@bar.com' });
    const got = m.getGoogleTokens('gmail');
    expect(got).toEqual({ refreshToken: 'rt-abc', email: 'foo@bar.com' });
  });

  it('clearGoogleTokens removes the entry; subsequent get returns null', async () => {
    const m = await freshModule(dataDir);
    m.setGoogleTokens({ kind: 'gmail', refreshToken: 'rt-abc', email: 'foo@bar.com' });
    m.clearGoogleTokens('gmail');
    expect(m.getGoogleTokens('gmail')).toBeNull();
  });

  it('the raw refresh token is NOT readable from on-disk JSON (encrypted at rest)', async () => {
    const m = await freshModule(dataDir);
    m.setGoogleTokens({ kind: 'gmail', refreshToken: 'rt-abc', email: 'foo@bar.com' });
    const raw = fs.readFileSync(path.join(dataDir, 'secrets.json'), 'utf8');
    expect(raw.includes('rt-abc')).toBe(false);
  });

  it('Phase-1 fields untouched: getActiveProvider returns null before AND after googleTokens write', async () => {
    const m = await freshModule(dataDir);
    expect(await m.getActiveProvider()).toBeNull();
    m.setGoogleTokens({ kind: 'gmail', refreshToken: 'rt-abc', email: 'foo@bar.com' });
    expect(await m.getActiveProvider()).toBeNull();
  });

  it('clearing gmail leaves calendar entry intact', async () => {
    const m = await freshModule(dataDir);
    m.setGoogleTokens({ kind: 'gmail', refreshToken: 'rt-g', email: 'g@e.com' });
    m.setGoogleTokens({ kind: 'calendar', refreshToken: 'rt-c', email: 'g@e.com' });
    m.clearGoogleTokens('gmail');
    expect(m.getGoogleTokens('gmail')).toBeNull();
    expect(m.getGoogleTokens('calendar')).toEqual({ refreshToken: 'rt-c', email: 'g@e.com' });
  });
});

// ============================================================================
// Plan 02-01 Task 2: OAuth loopback flow tests (connectGoogle)
// ============================================================================

describe('connectGoogle OAuth loopback flow (Plan 02-01 Task 2)', () => {
  let dataDir: string;
  const ENV_BACKUP = {
    id: process.env.GOOGLE_OAUTH_CLIENT_ID,
    secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  };

  beforeEach(() => {
    dataDir = createTempUserDataDir('aria-oauth-flow');
  });

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('electron');
    if (ENV_BACKUP.id === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    else process.env.GOOGLE_OAUTH_CLIENT_ID = ENV_BACKUP.id;
    if (ENV_BACKUP.secret === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    else process.env.GOOGLE_OAUTH_CLIENT_SECRET = ENV_BACKUP.secret;
  });

  async function freshAuthModule() {
    vi.resetModules();
    vi.doMock('electron', async () => {
      const real = await vi.importActual<typeof import('electron')>('electron');
      return {
        ...real,
        app: {
          ...((real as { app?: unknown }).app ?? {}),
          isReady: () => true,
          whenReady: () => Promise.resolve(),
          getPath: () => dataDir,
          getName: () => 'Aria',
          getVersion: () => '0.1.0-test',
        },
        safeStorage: {
          isEncryptionAvailable: () => true,
          encryptString: (s: string) => Buffer.from('enc:' + s, 'utf8'),
          decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
          getSelectedStorageBackend: () => 'keychain',
        },
      };
    });
    return await import('../../../../../src/main/integrations/google/auth');
  }

  it('throws OAuthConfigMissingError when env vars are unset', async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const m = await freshAuthModule();
    await expect(m.connectGoogle('gmail')).rejects.toBeInstanceOf(m.OAuthConfigMissingError);
  });

  it('buildAuthorizationUrl includes code_challenge_method=S256 + access_type=offline + prompt=consent', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-id';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'client-secret';
    const m = await freshAuthModule();
    const { OAuth2Client } = await import('google-auth-library');
    const client = new OAuth2Client('client-id', 'client-secret', 'http://127.0.0.1:1/callback');
    const url = m.buildAuthorizationUrl({ client, kind: 'gmail', state: 's', challenge: 'c' });
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain('access_type=offline');
    expect(url).toContain('prompt=consent');
    expect(url).toContain('gmail.readonly');
    expect(url).toContain('state=s');
  });

  it('successful flow persists refresh token via setGoogleTokens and resolves { ok, email }', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-id';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'client-secret';
    const m = await freshAuthModule();
    const { OAuth2Client } = await import('google-auth-library');

    // Spy on the OAuth2Client.getToken so we don't hit the network.
    const stubClient = new OAuth2Client('client-id', 'client-secret', 'http://127.0.0.1:1/callback');
    vi.spyOn(stubClient, 'getToken').mockResolvedValue({
      tokens: { refresh_token: 'rt', access_token: 'at' },
      res: null,
    } as Awaited<ReturnType<OAuth2Client['getToken']>>);

    let capturedState = '';

    const result = await m.connectGoogle('gmail', {
      openAuthWindow: (url: string) => {
        // Extract `state` from the authorization URL and fire the loopback
        // request synchronously to drive the flow.
        const u = new URL(url);
        capturedState = u.searchParams.get('state') ?? '';
        return { close: () => undefined };
      },
      createLoopback: async () => {
        // Tiny in-memory event emitter that quacks like http.Server for our usage:
        // .on('request', ...) is invoked with (req, res); .close() is a no-op.
        const handlers: ((req: unknown, res: unknown) => void)[] = [];
        const fakeServer = {
          on: (event: string, cb: (req: unknown, res: unknown) => void) => {
            if (event === 'request') {
              handlers.push(cb);
              // Defer firing so awaitLoopbackCode's promise is set up first.
              queueMicrotask(() => {
                const res = {
                  writeHead: () => res,
                  end: () => undefined,
                };
                const req = { url: `/callback?code=test-code&state=${capturedState}` };
                for (const h of handlers) h(req, res);
              });
            }
          },
        } as unknown as import('node:http').Server;
        return { server: fakeServer, port: 1, close: () => undefined };
      },
      createOAuthClient: () => stubClient,
      resolveEmail: async () => 'foo@bar.com',
    });

    expect(result).toEqual({ ok: true, email: 'foo@bar.com' });

    // Verify setGoogleTokens was actually called (token now retrievable).
    const safeStorage = await import('../../../../../src/main/secrets/safeStorage');
    expect(safeStorage.getGoogleTokens('gmail')).toEqual({ refreshToken: 'rt', email: 'foo@bar.com' });
  });

  it('throws NoRefreshTokenError when getToken returns no refresh_token (Pitfall 12)', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-id';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'client-secret';
    const m = await freshAuthModule();
    const { OAuth2Client } = await import('google-auth-library');
    const stubClient = new OAuth2Client('client-id', 'client-secret', 'http://127.0.0.1:1/callback');
    vi.spyOn(stubClient, 'getToken').mockResolvedValue({
      tokens: { access_token: 'at' }, // <-- no refresh_token
      res: null,
    } as Awaited<ReturnType<OAuth2Client['getToken']>>);

    let capturedState = '';
    await expect(
      m.connectGoogle('gmail', {
        openAuthWindow: (url: string) => {
          capturedState = new URL(url).searchParams.get('state') ?? '';
          return { close: () => undefined };
        },
        createLoopback: async () => {
          const handlers: ((req: unknown, res: unknown) => void)[] = [];
          const fakeServer = {
            on: (event: string, cb: (req: unknown, res: unknown) => void) => {
              if (event === 'request') {
                handlers.push(cb);
                queueMicrotask(() => {
                  const res = { writeHead: () => res, end: () => undefined };
                  const req = { url: `/callback?code=c&state=${capturedState}` };
                  for (const h of handlers) h(req, res);
                });
              }
            },
          } as unknown as import('node:http').Server;
          return { server: fakeServer, port: 1, close: () => undefined };
        },
        createOAuthClient: () => stubClient,
        resolveEmail: async () => 'foo@bar.com',
      }),
    ).rejects.toBeInstanceOf(m.NoRefreshTokenError);
  });

  it('state mismatch on redirect rejects with OAuthStateMismatchError', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-id';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'client-secret';
    const m = await freshAuthModule();
    const { OAuth2Client } = await import('google-auth-library');
    const stubClient = new OAuth2Client('client-id', 'client-secret', 'http://127.0.0.1:1/callback');

    await expect(
      m.connectGoogle('gmail', {
        openAuthWindow: () => ({ close: () => undefined }),
        createLoopback: async () => {
          const handlers: ((req: unknown, res: unknown) => void)[] = [];
          const fakeServer = {
            on: (event: string, cb: (req: unknown, res: unknown) => void) => {
              if (event === 'request') {
                handlers.push(cb);
                queueMicrotask(() => {
                  const res = { writeHead: () => res, end: () => undefined };
                  // state intentionally wrong:
                  const req = { url: `/callback?code=c&state=WRONG` };
                  for (const h of handlers) h(req, res);
                });
              }
            },
          } as unknown as import('node:http').Server;
          return { server: fakeServer, port: 1, close: () => undefined };
        },
        createOAuthClient: () => stubClient,
        resolveEmail: async () => 'foo@bar.com',
      }),
    ).rejects.toBeInstanceOf(m.OAuthStateMismatchError);
  });
});
