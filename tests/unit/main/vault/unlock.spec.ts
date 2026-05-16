import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
  sealVault,
  unlockVault,
  isVaultPresent,
  VaultUnlockError,
  VaultTamperedError,
  VaultMissingError,
} from '../../../../src/main/vault/unlock';
import { createTempUserDataDir } from '../../../setup';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'correct-horse-battery-staple';

describe('vault/unlock', () => {
  let dir: string;
  let vaultPath: string;
  let appSalt: Buffer;

  beforeEach(() => {
    dir = createTempUserDataDir('vault-unlock');
    vaultPath = path.join(dir, 'vault.json');
    appSalt = crypto.randomBytes(16);
  });

  it('isVaultPresent reflects on-disk state', () => {
    expect(isVaultPresent(vaultPath)).toBe(false);
    sealVault(PASSWORD, MNEMONIC, vaultPath, appSalt);
    expect(isVaultPresent(vaultPath)).toBe(true);
  });

  it('sealVault → unlockVault round-trips mnemonic AND appSalt', () => {
    sealVault(PASSWORD, MNEMONIC, vaultPath, appSalt);
    const unlocked = unlockVault(PASSWORD, vaultPath);
    expect(unlocked.mnemonic).toBe(MNEMONIC);
    expect(unlocked.appSalt.equals(appSalt)).toBe(true);
  });

  it('vault.json contains appSalt as a base64 string', () => {
    sealVault(PASSWORD, MNEMONIC, vaultPath, appSalt);
    const json = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
    expect(typeof json.appSalt).toBe('string');
    expect(Buffer.from(json.appSalt, 'base64').equals(appSalt)).toBe(true);
    expect(json.v).toBe(1);
    expect(json.kdf.algo).toBe('scrypt');
    expect(json.cipher.algo).toBe('aes-256-gcm');
  });

  it('wrong password throws VaultUnlockError', () => {
    sealVault(PASSWORD, MNEMONIC, vaultPath, appSalt);
    expect(() => unlockVault('wrong-password', vaultPath)).toThrow(VaultUnlockError);
  });

  it('flipping one byte of ciphertext throws VaultTamperedError', () => {
    sealVault(PASSWORD, MNEMONIC, vaultPath, appSalt);
    const json = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
    const ct = Buffer.from(json.cipher.ct, 'base64');
    ct[0] = ct[0] ^ 0xff;
    json.cipher.ct = ct.toString('base64');
    fs.writeFileSync(vaultPath, JSON.stringify(json));
    expect(() => unlockVault(PASSWORD, vaultPath)).toThrow(VaultTamperedError);
  });

  it('missing vault file throws VaultMissingError', () => {
    expect(() => unlockVault(PASSWORD, vaultPath)).toThrow(VaultMissingError);
  });
});
