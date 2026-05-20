/**
 * Plan 08.1-02 Task 2 — install-id tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createTempUserDataDir } from '../../../tests/setup';
import { getOrCreateInstallId } from './install-id';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface MockSafeStorage {
  isEncryptionAvailable: () => boolean;
  encryptString: ReturnType<typeof vi.fn>;
  decryptString: ReturnType<typeof vi.fn>;
}

function makeAvailable(): MockSafeStorage {
  return {
    isEncryptionAvailable: () => true,
    encryptString: vi.fn((s: string) => Buffer.from('enc:' + s, 'utf8')),
    decryptString: vi.fn((b: Buffer) => b.toString('utf8').replace(/^enc:/, '')),
  };
}

function makeUnavailable(): MockSafeStorage {
  return {
    isEncryptionAvailable: () => false,
    encryptString: vi.fn(() => {
      throw new Error('not-available');
    }),
    decryptString: vi.fn(() => {
      throw new Error('not-available');
    }),
  };
}

describe('getOrCreateInstallId', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = createTempUserDataDir('aria-install-id');
  });

  afterEach(() => {
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('returns a UUIDv4 on first call', async () => {
    const ss = makeAvailable();
    const id = await getOrCreateInstallId({ dataDir, safeStorageImpl: ss });
    expect(id).toMatch(UUID_RE);
  });

  it('returns the same UUID across sequential calls (persistence)', async () => {
    const ss = makeAvailable();
    const id1 = await getOrCreateInstallId({ dataDir, safeStorageImpl: ss });
    const id2 = await getOrCreateInstallId({ dataDir, safeStorageImpl: ss });
    expect(id1).toBe(id2);
  });

  it('uses safeStorage.encryptString on first write', async () => {
    const ss = makeAvailable();
    await getOrCreateInstallId({ dataDir, safeStorageImpl: ss });
    expect(ss.encryptString).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(dataDir, 'install-id.enc'))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, 'install-id.txt'))).toBe(false);
  });

  it('falls back to plaintext and warns when safeStorage unavailable (Linux basic_text)', async () => {
    const ss = makeUnavailable();
    const warn = vi.fn();
    const id = await getOrCreateInstallId({
      dataDir,
      safeStorageImpl: ss,
      logger: { info: vi.fn(), warn },
    });
    expect(id).toMatch(UUID_RE);
    expect(fs.existsSync(path.join(dataDir, 'install-id.txt'))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, 'install-id.enc'))).toBe(false);
    expect(warn).toHaveBeenCalled();
    const arg = warn.mock.calls[0][0];
    expect(JSON.stringify(arg)).toContain('plaintext-fallback');
  });

  it('plaintext fallback persists across calls', async () => {
    const ss = makeUnavailable();
    const id1 = await getOrCreateInstallId({
      dataDir,
      safeStorageImpl: ss,
      logger: { info: vi.fn(), warn: vi.fn() },
    });
    const id2 = await getOrCreateInstallId({
      dataDir,
      safeStorageImpl: ss,
      logger: { info: vi.fn(), warn: vi.fn() },
    });
    expect(id1).toBe(id2);
  });
});
