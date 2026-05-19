import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTempUserDataDir } from '../../../../setup';

describe('microsoft cache', () => {
  let dataDir: string;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    dataDir = createTempUserDataDir('aria-microsoft-cache');
    vi.doMock('electron', async () => {
      const real = await vi.importActual<typeof import('electron')>('electron');
      return {
        ...real,
        app: {
          ...((real as any).app ?? {}),
          isReady: () => true,
          whenReady: () => Promise.resolve(),
          getPath: () => dataDir,
        },
        safeStorage: {
          isEncryptionAvailable: () => true,
          encryptString: (s: string) => Buffer.from('enc:' + s, 'utf8'),
          decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
          getSelectedStorageBackend: () => 'keychain',
        },
      };
    });
  });

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('electron');
    vi.doUnmock('../../../../src/main/integrations/microsoft/cache');
  });

  it('round-trips cache blobs through safeStorage and the cache plugin', async () => {
    const m = await import('../../../../../src/main/integrations/microsoft/cache');

    m.writeMicrosoftCache('acct-1', 'serialized-cache');
    expect(m.readMicrosoftCache('acct-1')).toBe('serialized-cache');

    const plugin = m.createSafeStorageCachePlugin('acct-1');
    const tokenCache = {
      deserialize: vi.fn(),
      serialize: vi.fn(() => 'updated-cache'),
    };

    await plugin.beforeCacheAccess({ tokenCache } as any);
    expect(tokenCache.deserialize).toHaveBeenCalledWith('serialized-cache');

    await plugin.afterCacheAccess({ cacheHasChanged: true, tokenCache } as any);
    expect(m.readMicrosoftCache('acct-1')).toBe('updated-cache');
  });
});
