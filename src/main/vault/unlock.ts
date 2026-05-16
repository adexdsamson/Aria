/**
 * Vault seal / unlock — AES-256-GCM over the mnemonic, plus a non-secret
 * `appSalt` for the DB-key KDF.
 *
 * Schema locked by Plan 02 Task 1 (see storage.ts). Task 2 only consumes
 * `appSalt`; it does not add fields.
 *
 * Logging policy (T-01-02-04): vault module logs only event names, never
 * payload. Mnemonic, password, key material never reach pino.
 */
import * as crypto from 'node:crypto';
import {
  readVaultJson,
  vaultExists,
  writeVaultJsonAtomic,
  VaultMissingError,
  type VaultJson,
} from './storage';

export { VaultMissingError };

export class VaultUnlockError extends Error {
  override readonly name = 'VaultUnlockError';
}

export class VaultTamperedError extends Error {
  override readonly name = 'VaultTamperedError';
}

const VAULT_KDF_N = 1 << 15;
const VAULT_KDF_R = 8;
const VAULT_KDF_P = 1;
const VAULT_KDF_MAXMEM = 64 * 1024 * 1024;
const VAULT_SALT_BYTES = 16;
const VAULT_NONCE_BYTES = 12;
const VAULT_KEY_BYTES = 32;
const KDF_CHECK_LABEL = 'aria-vault-v1-check';
const KDF_CHECK_BYTES = 16;

function computeKdfCheck(vaultKey: Buffer): string {
  return crypto
    .createHmac('sha256', vaultKey)
    .update(KDF_CHECK_LABEL)
    .digest()
    .subarray(0, KDF_CHECK_BYTES)
    .toString('base64');
}

function scryptSync(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, VAULT_KEY_BYTES, {
    N: VAULT_KDF_N,
    r: VAULT_KDF_R,
    p: VAULT_KDF_P,
    maxmem: VAULT_KDF_MAXMEM,
  }) as Buffer;
}

/**
 * Seal a vault: derive vault-key from `dailyPassword`, AES-256-GCM-encrypt
 * the mnemonic, and write vault.json. `appSalt` is supplied by the caller —
 * onboarding generates a fresh 16-byte value, restore reuses the existing
 * vault's appSalt.
 */
export function sealVault(
  dailyPassword: string,
  mnemonic: string,
  vaultPath: string,
  appSalt: Buffer,
): void {
  if (!Buffer.isBuffer(appSalt) || appSalt.length === 0) {
    throw new Error('sealVault: appSalt must be a non-empty Buffer');
  }
  const vaultSalt = crypto.randomBytes(VAULT_SALT_BYTES);
  const nonce = crypto.randomBytes(VAULT_NONCE_BYTES);
  const vaultKey = scryptSync(dailyPassword, vaultSalt);
  try {
    const cipher = crypto.createCipheriv('aes-256-gcm', vaultKey, nonce);
    const ct = Buffer.concat([
      cipher.update(Buffer.from(mnemonic.normalize('NFKD'), 'utf8')),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    const json: VaultJson = {
      v: 1,
      kdf: {
        algo: 'scrypt',
        N: VAULT_KDF_N,
        r: VAULT_KDF_R,
        p: VAULT_KDF_P,
        salt: vaultSalt.toString('base64'),
      },
      cipher: {
        algo: 'aes-256-gcm',
        nonce: nonce.toString('base64'),
        ct: ct.toString('base64'),
        tag: tag.toString('base64'),
      },
      appSalt: appSalt.toString('base64'),
      kdfCheck: computeKdfCheck(vaultKey),
    };
    writeVaultJsonAtomic(vaultPath, json);
  } finally {
    vaultKey.fill(0);
  }
}

export interface UnlockedVault {
  mnemonic: string;
  appSalt: Buffer;
}

/**
 * Unlock a vault: re-derive vault-key from `dailyPassword` + stored salt,
 * AES-GCM-decrypt the mnemonic, and return `{ mnemonic, appSalt }`.
 *
 * Throws:
 *   - VaultMissingError if vault.json does not exist
 *   - VaultUnlockError if password is wrong (GCM authentication fails)
 *   - VaultTamperedError if the ciphertext bytes were modified
 */
export function unlockVault(dailyPassword: string, vaultPath: string): UnlockedVault {
  const json = readVaultJson(vaultPath);
  if (json.v !== 1) throw new VaultUnlockError(`unsupported vault version ${json.v}`);
  if (json.kdf.algo !== 'scrypt') throw new VaultUnlockError('unsupported KDF algorithm');
  if (json.cipher.algo !== 'aes-256-gcm') throw new VaultUnlockError('unsupported cipher');

  const vaultSalt = Buffer.from(json.kdf.salt, 'base64');
  const nonce = Buffer.from(json.cipher.nonce, 'base64');
  const ct = Buffer.from(json.cipher.ct, 'base64');
  const tag = Buffer.from(json.cipher.tag, 'base64');
  const appSalt = Buffer.from(json.appSalt, 'base64');

  const vaultKey = scryptSync(dailyPassword, vaultSalt);
  try {
    // First disambiguate "wrong password" from "key right, ciphertext bad"
    // using the non-secret HMAC verifier. Constant-time compare.
    if (typeof json.kdfCheck !== 'string') {
      throw new VaultUnlockError('vault missing kdfCheck');
    }
    const expected = Buffer.from(json.kdfCheck, 'base64');
    const actual = Buffer.from(computeKdfCheck(vaultKey), 'base64');
    const keyMatches =
      expected.length === actual.length &&
      crypto.timingSafeEqual(expected, actual);
    if (!keyMatches) throw new VaultUnlockError('vault unlock failed');

    const decipher = crypto.createDecipheriv('aes-256-gcm', vaultKey, nonce);
    decipher.setAuthTag(tag);
    let plaintext: Buffer;
    try {
      plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
    } catch {
      // Vault key matched the verifier, so GCM auth failure means the
      // ciphertext or tag was tampered with after seal.
      throw new VaultTamperedError('vault tampered');
    }
    return { mnemonic: plaintext.toString('utf8').normalize('NFKD'), appSalt };
  } finally {
    vaultKey.fill(0);
  }
}

/** Predicate: does vault.json exist? Thin wrapper around storage.vaultExists. */
export function isVaultPresent(vaultPath: string): boolean {
  return vaultExists(vaultPath);
}
