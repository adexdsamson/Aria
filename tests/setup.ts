import { vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';

/**
 * Shared Vitest setup (VALIDATION Wave 0).
 *
 * Provides:
 *   - createTempUserDataDir(): per-test isolated userData dir under os.tmpdir()
 *   - vi.mock('electron'): in-memory safeStorage + app surface
 *
 * Plan 02/03 tests can override the mock per-suite via vi.mock / vi.doMock.
 */

export function createTempUserDataDir(prefix = 'aria-test'): string {
  const id = crypto.randomBytes(8).toString('hex');
  const dir = path.join(os.tmpdir(), `${prefix}-${id}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Default userData dir for the suite; tests can replace via app.getPath override.
const DEFAULT_USER_DATA = createTempUserDataDir('aria-default');

/**
 * Plan 02-01: GmailClient fixture factory. Sync-gmail tests inject a fake
 * with these four methods (`listHistory`, `listMessages`, `getMessageMetadata`,
 * `getProfile`); per-case override behavior via `mockReturnValue` / `mockImplementation`.
 *
 * Calendar half is a no-op placeholder; Plan 02-02 will flesh it out.
 */
export interface GmailClientFake {
  listHistory: ReturnType<typeof vi.fn>;
  listMessages: ReturnType<typeof vi.fn>;
  getMessageMetadata: ReturnType<typeof vi.fn>;
  getProfile: ReturnType<typeof vi.fn>;
}

export interface CalendarClientFake {
  listEvents: ReturnType<typeof vi.fn>;
  listEventsWindow: ReturnType<typeof vi.fn>;
  getCalendarMetadata: ReturnType<typeof vi.fn>;
}

export function mockGoogleapis(): { gmail: GmailClientFake; calendar: CalendarClientFake } {
  return {
    gmail: {
      listHistory: vi.fn().mockResolvedValue({ history: [], historyId: '0' }),
      listMessages: vi.fn().mockResolvedValue({ messages: [], historyId: '0' }),
      getMessageMetadata: vi.fn().mockResolvedValue(null),
      getProfile: vi.fn().mockResolvedValue({ emailAddress: 'test@example.com', historyId: '0' }),
    },
    calendar: {
      listEvents: vi.fn().mockResolvedValue({ items: [], nextSyncToken: 'st-0' }),
      listEventsWindow: vi.fn().mockResolvedValue({ items: [] }),
      getCalendarMetadata: vi.fn().mockResolvedValue({ email: 'test@example.com' }),
    },
  };
}

/**
 * Plan 02-03: fetch-mocking helpers. Tests opt in by calling `mockFetch` /
 * `mockFetchSequence` and resetting via `restoreFetch`.
 */
export interface MockedResponse {
  ok?: boolean;
  status?: number;
  /** JSON body (will be returned from .json()). */
  json?: unknown;
  /** Plain-text body (will be returned from .text()). */
  text?: string;
  /** Throw instead of returning a response. */
  error?: Error;
}

function buildResponse(r: MockedResponse): Response {
  if (r.error) throw r.error;
  const status = r.status ?? (r.ok === false ? 500 : 200);
  const ok = r.ok ?? (status >= 200 && status < 300);
  return {
    ok,
    status,
    json: async () => r.json,
    text: async () => r.text ?? (r.json ? JSON.stringify(r.json) : ''),
  } as unknown as Response;
}

const originalFetch = globalThis.fetch;

export function mockFetch(handler: (url: string) => MockedResponse | Promise<MockedResponse>): void {
  (globalThis as { fetch: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const r = await handler(url);
    return buildResponse(r);
  }) as typeof fetch;
}

export function mockFetchSequence(responses: MockedResponse[]): { calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  (globalThis as { fetch: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    calls.push(url);
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return buildResponse(r);
  }) as typeof fetch;
  return { calls };
}

export function restoreFetch(): void {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
}

vi.mock('electron', () => {
  return {
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from(s, 'utf8'),
      decryptString: (b: Buffer) => b.toString('utf8'),
      getSelectedStorageBackend: () => 'keychain',
    },
    app: {
      isReady: () => true,
      whenReady: () => Promise.resolve(),
      getPath: (key: string) => {
        if (key === 'userData' || key === 'appData') return DEFAULT_USER_DATA;
        if (key === 'temp') return os.tmpdir();
        if (key === 'home') return os.homedir();
        return DEFAULT_USER_DATA;
      },
      getName: () => 'Aria',
      getVersion: () => '0.1.0-test',
    },
  };
});
