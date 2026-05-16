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
