/**
 * scrypt-based DB-key derivation.
 *
 * `deriveDbKey(mnemonic, appSalt)` → 32-byte Buffer suitable for
 * `PRAGMA key="x'<hex>'"`. Parameters are pinned by threat-model
 * T-01-02-02 and locked by a test vector in `derive.spec.ts`.
 *   N = 2^15 (32768), r = 8, p = 1, maxmem = 64 MiB
 *
 * Mnemonic is normalized NFKD before hashing per BIP39 §"Wordlist".
 */
import * as crypto from 'node:crypto';

// scrypt cost factor N = 2^15. Keep literal `N: 1 << 15` visible for the
// plan's grep-based parameter-lock acceptance gate.
export const SCRYPT_N = 1 << 15;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const SCRYPT_MAXMEM = 64 * 1024 * 1024;
export const DB_KEY_BYTES = 32;

/**
 * Derive a 32-byte SQLCipher key from a mnemonic + appSalt.
 *
 * The result is deterministic for fixed inputs and is the single chokepoint
 * used by openDb during onboarding, unlock, and restore.
 */
export function deriveDbKey(mnemonic: string, appSalt: Buffer): Promise<Buffer> {
  if (typeof mnemonic !== 'string' || mnemonic.length === 0) {
    return Promise.reject(new Error('deriveDbKey: empty mnemonic'));
  }
  if (!Buffer.isBuffer(appSalt) || appSalt.length === 0) {
    return Promise.reject(new Error('deriveDbKey: appSalt must be a non-empty Buffer'));
  }
  const normalized = mnemonic.normalize('NFKD');
  return new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(
      normalized,
      appSalt,
      DB_KEY_BYTES,
      // T-01-02-02: scrypt parameters are pinned. Literal `N: 1 << 15`
      // here is the grep-locked source-of-truth; SCRYPT_N is an alias.
      { N: 1 << 15, r: 8, p: 1, maxmem: SCRYPT_MAXMEM },
      (err, key) => {
        if (err) reject(err);
        else resolve(key);
      },
    );
  });
}

/** Format a 32-byte key for `PRAGMA key="x'<hex>'"`. */
export function toPragmaKeyHex(key: Buffer): string {
  return key.toString('hex');
}
