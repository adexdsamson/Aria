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
  // Filled in by Plan 02-02.
  noop: ReturnType<typeof vi.fn>;
}

export function mockGoogleapis(): { gmail: GmailClientFake; calendar: CalendarClientFake } {
  return {
    gmail: {
      listHistory: vi.fn().mockResolvedValue({ history: [], historyId: '0' }),
      listMessages: vi.fn().mockResolvedValue({ messages: [], historyId: '0' }),
      getMessageMetadata: vi.fn().mockResolvedValue(null),
      getProfile: vi.fn().mockResolvedValue({ emailAddress: 'test@example.com', historyId: '0' }),
    },
    calendar: { noop: vi.fn() },
  };
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
