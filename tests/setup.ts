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
