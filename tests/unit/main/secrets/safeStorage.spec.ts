/**
 * Unit tests for the safeStorage-backed frontier-key secrets module.
 *
 * Uses the global `electron` mock from tests/setup.ts. Each test gets its own
 * userData dir via createTempUserDataDir to keep secrets.json isolated.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createTempUserDataDir } from '../../../setup';

async function freshModule(dataDir: string) {
  vi.resetModules();
  // Override app.getPath to point at the per-test dir.
  vi.doMock('electron', async () => {
    const real = await vi.importActual<typeof import('electron')>('electron');
    return {
      ...real,
      app: {
        ...((real as any).app ?? {}),
        isReady: () => true,
        whenReady: () => Promise.resolve(),
        getPath: (key: string) => (key === 'userData' ? dataDir : dataDir),
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
  return await import('../../../../src/main/secrets/safeStorage');
}

describe('safeStorage frontier-key module', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = createTempUserDataDir('aria-secrets-test');
  });

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('electron');
  });

  it('round-trips set → has → get → clear for a single provider', async () => {
    const m = await freshModule(dataDir);
    await m.setFrontierKey({ provider: 'anthropic', key: 'sk-ant-test-12345' });
    expect(await m.hasFrontierKey({ provider: 'anthropic' })).toBe(true);
    expect(await m.getFrontierKey({ provider: 'anthropic' })).toBe('sk-ant-test-12345');
    await m.clearFrontierKey({ provider: 'anthropic' });
    expect(await m.hasFrontierKey({ provider: 'anthropic' })).toBe(false);
  });

  it('writes only the encrypted blob to secrets.json (no plaintext key)', async () => {
    const m = await freshModule(dataDir);
    await m.setFrontierKey({ provider: 'openai', key: 'sk-proj-PLAIN-12345' });
    const raw = fs.readFileSync(path.join(dataDir, 'secrets.json'), 'utf8');
    expect(raw).not.toContain('sk-proj-PLAIN-12345');
    const parsed = JSON.parse(raw);
    expect(parsed.v).toBe(1);
    expect(typeof parsed.providers.openai).toBe('string');
  });

  it('clearing the active provider resets activeProvider to null', async () => {
    const m = await freshModule(dataDir);
    await m.setFrontierKey({ provider: 'anthropic', key: 'k1' });
    await m.setActiveProvider('anthropic');
    expect(await m.getActiveProvider()).toBe('anthropic');
    await m.clearFrontierKey({ provider: 'anthropic' });
    expect(await m.getActiveProvider()).toBeNull();
  });

  it('setActiveProvider throws when no key stored for that provider', async () => {
    const m = await freshModule(dataDir);
    await expect(m.setActiveProvider('google')).rejects.toThrow(/no-key-for-provider/);
  });

  it('throws SafeStorageUnavailableError when app is not ready', async () => {
    vi.resetModules();
    vi.doMock('electron', async () => ({
      app: {
        isReady: () => false,
        whenReady: () => Promise.resolve(),
        getPath: () => dataDir,
      },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s: string) => Buffer.from(s, 'utf8'),
        decryptString: (b: Buffer) => b.toString('utf8'),
        getSelectedStorageBackend: () => 'keychain',
      },
    }));
    const m = await import('../../../../src/main/secrets/safeStorage');
    await expect(m.setFrontierKey({ provider: 'anthropic', key: 'x' })).rejects.toMatchObject({
      reason: 'not-ready',
    });
  });

  it('refuses to store on Linux basic_text fallback', async () => {
    vi.resetModules();
    vi.doMock('electron', async () => ({
      app: {
        isReady: () => true,
        whenReady: () => Promise.resolve(),
        getPath: () => dataDir,
      },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s: string) => Buffer.from(s, 'utf8'),
        decryptString: (b: Buffer) => b.toString('utf8'),
        getSelectedStorageBackend: () => 'basic_text',
      },
    }));
    const m = await import('../../../../src/main/secrets/safeStorage');
    await expect(m.setFrontierKey({ provider: 'anthropic', key: 'x' })).rejects.toMatchObject({
      reason: 'basic_text',
    });
  });

  it('throws SafeStorageUnavailableError when isEncryptionAvailable is false', async () => {
    vi.resetModules();
    vi.doMock('electron', async () => ({
      app: {
        isReady: () => true,
        whenReady: () => Promise.resolve(),
        getPath: () => dataDir,
      },
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: (s: string) => Buffer.from(s, 'utf8'),
        decryptString: (b: Buffer) => b.toString('utf8'),
        getSelectedStorageBackend: () => 'keychain',
      },
    }));
    const m = await import('../../../../src/main/secrets/safeStorage');
    await expect(m.setFrontierKey({ provider: 'anthropic', key: 'x' })).rejects.toMatchObject({
      reason: 'not-available',
    });
  });
});
