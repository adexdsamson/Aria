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

async function freshModule(dataDir: string, backend = 'keychain') {
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
        getSelectedStorageBackend: () => backend,
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

  // ── ollamaModelId persistence (user-configurable local model) ────────────

  it('getOllamaModelId returns null when nothing is persisted', async () => {
    const m = await freshModule(dataDir);
    expect(m.getOllamaModelId()).toBeNull();
  });

  it('round-trips set → get → clear for ollamaModelId', async () => {
    const m = await freshModule(dataDir);
    m.setOllamaModelId('dolphin3:latest');
    expect(m.getOllamaModelId()).toBe('dolphin3:latest');
    m.setOllamaModelId(null);
    expect(m.getOllamaModelId()).toBeNull();
  });

  it('setOllamaModelId preserves providers/activeProvider in secrets.json', async () => {
    const m = await freshModule(dataDir);
    await m.setFrontierKey({ provider: 'anthropic', key: 'sk-ant-keep' });
    await m.setActiveProvider('anthropic');
    m.setOllamaModelId('qwen2.5:7b');
    const raw = fs.readFileSync(path.join(dataDir, 'secrets.json'), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.ollamaModelId).toBe('qwen2.5:7b');
    expect(parsed.activeProvider).toBe('anthropic');
    expect(typeof parsed.providers.anthropic).toBe('string');
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

  it('round-trips opaque provider token blobs via providerTokens', async () => {
    const m = await freshModule(dataDir);
    m.setProviderTokens('microsoft:acct-123', 'opaque-token-blob');
    expect(m.getProviderTokens('microsoft:acct-123')).toBe('opaque-token-blob');
    expect(m.listProviderTokenKeys()).toContain('microsoft:acct-123');
    const raw = fs.readFileSync(path.join(dataDir, 'secrets.json'), 'utf8');
    expect(raw).not.toContain('opaque-token-blob');
  });

  it('mirrors legacy Google provider keys into googleTokens when JSON-shaped', async () => {
    const m = await freshModule(dataDir);
    m.setProviderTokens(
      'google:gmail',
      JSON.stringify({ refreshToken: 'refresh-123', email: 'user@example.com' }),
    );
    expect(m.getProviderTokens('google:gmail')).toBe(
      JSON.stringify({ refreshToken: 'refresh-123', email: 'user@example.com' }),
    );
    expect(m.listProviderTokenKeys()).toContain('google:gmail');
    expect(m.getGoogleTokens('gmail')).toEqual({
      refreshToken: 'refresh-123',
      email: 'user@example.com',
    });
  });

  it('can write fresh Google provider tokens without re-populating googleTokens', async () => {
    const m = await freshModule(dataDir);
    m.setProviderTokens(
      'google:gmail',
      JSON.stringify({ refreshToken: 'fresh-refresh', email: 'fresh@example.com' }),
      { mirrorLegacyGoogle: false },
    );
    expect(m.getProviderTokens('google:gmail')).toBe(
      JSON.stringify({ refreshToken: 'fresh-refresh', email: 'fresh@example.com' }),
    );
    expect(m.getGoogleTokens('gmail')).toBeNull();
  });

  it('persists legacy googleTokens into providerTokens during migration', async () => {
    const m = await freshModule(dataDir);
    m.setGoogleTokens({ kind: 'calendar', refreshToken: 'legacy-refresh', email: 'legacy@example.com' });
    const result = m.migrateLegacyGoogleTokensToProviderTokens();
    expect(result.migrated).toEqual(['google:calendar']);
    expect(m.getProviderTokens('google:calendar')).toBe(
      JSON.stringify({ refreshToken: 'legacy-refresh', email: 'legacy@example.com' }),
    );

    const raw = fs.readFileSync(path.join(dataDir, 'secrets.json'), 'utf8');
    const parsed = JSON.parse(raw);
    expect(typeof parsed.providerTokens['google:calendar']).toBe('string');
    expect(raw).not.toContain('legacy-refresh');
  });

  it('drops verified legacy Google entries per account', async () => {
    const m = await freshModule(dataDir);
    const Database = (await import('better-sqlite3-multiple-ciphers')).default;
    const db = new Database(':memory:');
    db.exec(
      `CREATE TABLE provider_account (
        account_id TEXT NOT NULL,
        provider_key TEXT NOT NULL,
        display_email TEXT NOT NULL,
        status TEXT NOT NULL,
        capabilities_json TEXT NOT NULL,
        last_error TEXT,
        last_error_at TEXT
      )`,
    );
    db.prepare(
      `INSERT INTO provider_account (account_id, provider_key, display_email, status, capabilities_json)
       VALUES ('verified@example.com', 'google', 'verified@example.com', 'ok', '{"mail":true}')`,
    ).run();
    m.setGoogleTokens({ kind: 'gmail', refreshToken: 'legacy-refresh', email: 'verified@example.com' });
    m.setProviderTokens(
      'google:gmail',
      JSON.stringify({ refreshToken: 'new-refresh', email: 'verified@example.com' }),
      { mirrorLegacyGoogle: false },
    );

    const result = m.runDropLegacyGoogleKeyringPerAccount(db);

    expect(result.droppedCount).toBe(1);
    expect(m.getGoogleTokens('gmail')).toBeNull();
    db.close();
  });

  it('skips legacy Google drops on Linux basic_text backend', async () => {
    const m = await freshModule(dataDir, 'basic_text');
    const Database = (await import('better-sqlite3-multiple-ciphers')).default;
    const db = new Database(':memory:');
    db.exec(
      `CREATE TABLE provider_account (
        account_id TEXT NOT NULL,
        provider_key TEXT NOT NULL,
        display_email TEXT NOT NULL,
        status TEXT NOT NULL,
        capabilities_json TEXT NOT NULL
      )`,
    );
    db.prepare(
      `INSERT INTO provider_account (account_id, provider_key, display_email, status, capabilities_json)
       VALUES ('skip@example.com', 'google', 'skip@example.com', 'ok', '{"mail":true}')`,
    ).run();

    const result = m.runDropLegacyGoogleKeyringPerAccount(db);

    expect(result).toMatchObject({
      droppedCount: 0,
      skippedCount: 1,
      reason: 'basic_text-backend',
    });
    db.close();
  });
});
