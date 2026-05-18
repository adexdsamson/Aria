/**
 * Plan 02-01 — OAuth loopback flow for Google (Gmail + Calendar).
 *
 * Reference: 02-RESEARCH.md §"Pattern: OAuth Loopback Flow (Desktop)".
 *
 * Flow (connectGoogle):
 *   1. Read GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET from process.env
 *      (electron-vite `define` injects in production; dev reads .env.local).
 *   2. Spin up http.createServer on 127.0.0.1:0 (kernel picks free port).
 *   3. Build OAuth2Client with redirectUri http://127.0.0.1:<port>/callback.
 *   4. Generate strong random `state` (32 random bytes hex) for CSRF defense (T-02-01-04).
 *   5. Generate PKCE verifier + S256 challenge (T-02-01-03 defense-in-depth).
 *   6. Construct auth URL with access_type=offline + prompt=consent + scope +
 *      code_challenge + code_challenge_method=S256.
 *   7. Open a sandboxed BrowserWindow (nodeIntegration:false, contextIsolation:true,
 *      sandbox:true, NO preload — Pitfall 18 / T-02-01-03).
 *   8. Await the loopback redirect, parse ?code & ?state, reject on mismatch.
 *   9. exchange code → tokens via oauth2Client.getToken({ code, codeVerifier }).
 *  10. Assert tokens.refresh_token is present (Pitfall 12); fail with
 *      NoRefreshTokenError if not.
 *  11. One-shot users.getProfile to resolve emailAddress.
 *  12. setGoogleTokens({ kind, refreshToken, email }) into safeStorage.
 *  13. Close BrowserWindow + server. Return { ok:true, email }.
 *
 * Token persistence (after first connect):
 *   getOAuth2Client(kind) reads the refresh token via getGoogleTokens(kind),
 *   constructs an OAuth2Client with the token set, and listens for the
 *   'tokens' event to re-persist any rotated refresh_token (rare but possible).
 *
 * Error classes:
 *   OAuthConfigMissingError   — env vars unset
 *   NoRefreshTokenError       — Google returned tokens without refresh_token
 *   OAuthStateMismatchError   — CSRF defense tripped
 *   TokenInvalidError         — refresh failed: invalid_grant (expired/revoked)
 */
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { URL } from 'node:url';
import { OAuth2Client, type CodeChallengeMethod } from 'google-auth-library';
import { setGoogleTokens, getGoogleTokens, type GoogleTokenKind } from '../../secrets/safeStorage';

export const SCOPES: Record<GoogleTokenKind, readonly string[]> = {
  // Plan 03-04 — Gmail scope extends to gmail.send (incremental consent,
  // RESEARCH §Pattern 5 Shape A). Existing Phase 2 users see Settings →
  // Integrations banner prompting re-connect; new tokens replace old.
  gmail: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
  ],
  // Plan 04-01 — calendar scope extends to calendar.events (incremental
  // consent, narrowest write scope per T-04-01-05). Existing Phase 2 users
  // see a Settings → Integrations re-consent banner prompting reconnect.
  calendar: [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events',
  ],
} as const;

export class OAuthConfigMissingError extends Error {
  override readonly name = 'OAuthConfigMissingError';
}
export class NoRefreshTokenError extends Error {
  override readonly name = 'NoRefreshTokenError';
}
export class OAuthStateMismatchError extends Error {
  override readonly name = 'OAuthStateMismatchError';
}
export class TokenInvalidError extends Error {
  override readonly name = 'TokenInvalidError';
  readonly reason: 'expired' | 'revoked';
  constructor(opts: { reason: 'expired' | 'revoked'; message?: string }) {
    super(opts.message ?? `Google OAuth token ${opts.reason}`);
    this.reason = opts.reason;
  }
}

interface OAuthConfig {
  clientId: string;
  clientSecret: string;
}

function readOAuthConfig(): OAuthConfig {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new OAuthConfigMissingError(
      'Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET. See .env.local.example.',
    );
  }
  return { clientId, clientSecret };
}

/** PKCE verifier (43-128 chars of [A-Z a-z 0-9 - . _ ~]). */
export function generatePkce(): { verifier: string; challenge: string; method: 'S256' } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');
  return { verifier, challenge, method: 'S256' };
}

/**
 * Build the Google authorization URL (exported for test inspection).
 *
 * Always includes access_type=offline + prompt=consent so Google issues a
 * refresh_token (Pitfall 12 — without prompt=consent the user may have
 * pre-granted consent and Google returns no refresh_token).
 */
export function buildAuthorizationUrl(opts: {
  client: OAuth2Client;
  kind: GoogleTokenKind;
  state: string;
  challenge: string;
}): string {
  return opts.client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [...SCOPES[opts.kind]],
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: 'S256' as CodeChallengeMethod,
  });
}

/**
 * Listen on a loopback IP for the OAuth redirect. Resolves with the `code`
 * once received; rejects with OAuthStateMismatchError on state mismatch.
 *
 * The server binds 127.0.0.1:0 — kernel picks a free port. The caller MUST
 * pass that port into the redirectUri when constructing the OAuth2Client.
 */
export function awaitLoopbackCode(opts: {
  server: http.Server;
  expectedState: string;
}): Promise<{ code: string }> {
  return new Promise((resolve, reject) => {
    opts.server.on('request', (req, res) => {
      try {
        const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (requestUrl.pathname !== '/callback') {
          res.writeHead(404).end('Not found');
          return;
        }
        const code = requestUrl.searchParams.get('code');
        const state = requestUrl.searchParams.get('state');
        const error = requestUrl.searchParams.get('error');
        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<html><body><h1>OAuth error: ${error}</h1></body></html>`);
          reject(new Error(`OAuth error: ${error}`));
          return;
        }
        if (!state || state !== opts.expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>State mismatch</h1></body></html>');
          reject(new OAuthStateMismatchError('OAuth state parameter did not match expected value'));
          return;
        }
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Missing code</h1></body></html>');
          reject(new Error('OAuth redirect missing code parameter'));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          '<html><body><h1>Aria connected.</h1><p>You may close this window.</p></body></html>',
        );
        resolve({ code });
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * Dependencies for connectGoogle. Defaults bind to real Electron BrowserWindow
 * + http server; tests inject stubs. Allows the production path to use the
 * sandboxed BrowserWindow (T-02-01-03) without that being needed at unit-test time.
 */
export interface ConnectGoogleDeps {
  /** Create + open the OAuth consent window for the given URL. Must use a
   * sandboxed BrowserWindow (nodeIntegration:false, contextIsolation:true,
   * sandbox:true, no preload) in production. */
  openAuthWindow?: (url: string) => { close: () => void };
  /** Create + start the loopback HTTP listener. Returns the listening port. */
  createLoopback?: () => Promise<{ server: http.Server; port: number; close: () => void }>;
  /** Override the OAuth2Client constructor for tests. */
  createOAuthClient?: (opts: { clientId: string; clientSecret: string; redirectUri: string }) => OAuth2Client;
  /** Override the profile-resolution step (defaults to gmail.users.getProfile via googleapis). */
  resolveEmail?: (client: OAuth2Client) => Promise<string>;
}

/**
 * Default production deps: real Electron BrowserWindow with hardened webPreferences
 * (nodeIntegration: false, contextIsolation: true, sandbox: true) and no preload.
 * Configured per Pitfall 18 / threat T-02-01-03.
 */
function defaultDeps(kind: GoogleTokenKind): Required<Omit<ConnectGoogleDeps, 'createOAuthClient'>> & {
  createOAuthClient: NonNullable<ConnectGoogleDeps['createOAuthClient']>;
} {
  return {
    openAuthWindow: (url: string) => {
      // Lazy-require electron + googleapis so unit tests with mocked electron don't
      // pull the real Chromium runtime on import.
      const electron = require('electron') as typeof import('electron');
      const BrowserWindow = electron.BrowserWindow;
      const win = new BrowserWindow({
        width: 520,
        height: 720,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      void win.loadURL(url);
      return { close: () => win.destroy() };
    },
    createLoopback: async () => {
      const server = http.createServer();
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        throw new Error('loopback server failed to bind');
      }
      return {
        server,
        port: addr.port,
        close: () => server.close(),
      };
    },
    createOAuthClient: ({ clientId, clientSecret, redirectUri }) =>
      new OAuth2Client(clientId, clientSecret, redirectUri),
    resolveEmail: async (client) => {
      // Lazy-require googleapis. Branch by kind so we only call APIs whose
      // scopes we actually requested — using gmail.users.getProfile with a
      // calendar-only token returns 403 "Insufficient Permission" (UAT Test 4
      // Gap 5). For `calendar`, primary CalendarListEntry.id IS the user's
      // email by Google convention; data.summary is a belt-and-braces fallback.
      // Dynamic import so `vi.doMock('googleapis', ...)` can intercept in unit
      // tests (vitest reliably intercepts ESM dynamic-import but not CJS
      // `require` from a TS source under our build target).
      const { google } = (await import('googleapis')) as typeof import('googleapis');
      if (kind === 'calendar') {
        const calendar = google.calendar({ version: 'v3', auth: client });
        const res = await calendar.calendarList.get({ calendarId: 'primary' });
        const isEmail = (s: string | null | undefined): s is string =>
          typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
        const id = res.data.id;
        if (isEmail(id)) return id;
        const summary = res.data.summary;
        if (isEmail(summary)) return summary;
        throw new Error('calendarList.get returned no usable email/id');
      }
      const gmail = google.gmail({ version: 'v1', auth: client });
      const res = await gmail.users.getProfile({ userId: 'me' });
      const email = res.data.emailAddress;
      if (!email) throw new Error('users.getProfile returned no emailAddress');
      return email;
    },
  };
}

/**
 * Run the full OAuth loopback flow for the given Google integration kind. On
 * success persists the refresh_token via safeStorage.setGoogleTokens and
 * returns { ok:true, email }.
 *
 * SECURITY:
 *   - Sandboxed BrowserWindow (T-02-01-03)
 *   - CSRF defense via 32-byte random state (T-02-01-04)
 *   - PKCE S256 verifier/challenge (defense-in-depth)
 *   - access_type=offline + prompt=consent guarantee refresh_token issuance
 *   - Refresh token written ONLY to safeStorage; never SQLCipher (T-02-01-01)
 *   - Refresh token never logged (loopback URL is processed in-memory only)
 */
export async function connectGoogle(
  kind: GoogleTokenKind,
  depsOverride: ConnectGoogleDeps = {},
): Promise<{ ok: true; email: string }> {
  const { clientId, clientSecret } = readOAuthConfig();
  const deps = { ...defaultDeps(kind), ...depsOverride } as Required<ConnectGoogleDeps>;

  const { server, port, close: closeServer } = await deps.createLoopback();
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const client = deps.createOAuthClient({ clientId, clientSecret, redirectUri });

  const state = crypto.randomBytes(32).toString('hex');
  const { verifier, challenge } = generatePkce();
  const authUrl = buildAuthorizationUrl({ client, kind, state, challenge });

  const authWindow = deps.openAuthWindow(authUrl);

  try {
    const { code } = await awaitLoopbackCode({ server, expectedState: state });

    // exchange + verify refresh_token (Pitfall 12).
    // google-auth-library accepts codeVerifier on getToken via the request body.
    const tokenResult = await client.getToken({ code, codeVerifier: verifier });
    const tokens = tokenResult.tokens;
    if (!tokens.refresh_token) {
      throw new NoRefreshTokenError(
        'Google returned no refresh_token. Revoke prior consent at https://myaccount.google.com/permissions and re-connect.',
      );
    }

    // Set credentials so the email-resolve call carries the access_token.
    client.setCredentials(tokens);
    const email = await deps.resolveEmail(client);

    setGoogleTokens({ kind, refreshToken: tokens.refresh_token, email });

    return { ok: true, email };
  } finally {
    try { authWindow.close(); } catch { /* best effort */ }
    try { closeServer(); } catch { /* best effort */ }
  }
}

/**
 * Construct an OAuth2Client primed with the persisted refresh token for the
 * given kind. Returns null when no token exists.
 *
 * Registers a `tokens` listener so Google's (rare) refresh_token rotation is
 * persisted back to safeStorage without losing access.
 */
export function getOAuth2Client(kind: GoogleTokenKind): OAuth2Client | null {
  const persisted = getGoogleTokens(kind);
  if (!persisted) return null;
  const { clientId, clientSecret } = readOAuthConfig();
  const client = new OAuth2Client(clientId, clientSecret);
  client.setCredentials({ refresh_token: persisted.refreshToken });
  client.on('tokens', (tokens) => {
    // Google rarely rotates the refresh_token; when it does, re-persist.
    if (tokens.refresh_token && tokens.refresh_token !== persisted.refreshToken) {
      try {
        setGoogleTokens({ kind, refreshToken: tokens.refresh_token, email: persisted.email });
      } catch {
        /* best-effort rotation persist; next sync will surface auth errors anyway */
      }
    }
  });
  return client;
}
