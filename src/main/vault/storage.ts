/**
 * Atomic read/write helpers for `vault.json`.
 *
 * The JSON shape is locked by Plan 02 Task 1:
 *   {
 *     v: 1,
 *     kdf: { algo: 'scrypt', N, r, p, salt: <b64> },     // KDF for vault key
 *     cipher: { algo: 'aes-256-gcm', nonce: <b64>,
 *               ct: <b64>, tag: <b64> },                  // AES-GCM over mnemonic
 *     appSalt: <b64>                                      // 16-byte salt for DB key
 *   }
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export class VaultMissingError extends Error {
  override readonly name = 'VaultMissingError';
}

export interface VaultJson {
  v: 1;
  kdf: { algo: 'scrypt'; N: number; r: number; p: number; salt: string };
  cipher: { algo: 'aes-256-gcm'; nonce: string; ct: string; tag: string };
  appSalt: string;
  /**
   * HMAC-SHA256(vaultKey, "aria-vault-v1-check") truncated to 16 bytes,
   * base64. Lets unlock distinguish wrong-password (mismatch) from
   * ciphertext tamper (match + GCM auth fail). Not a secret.
   */
  kdfCheck: string;
}

/** Read vault.json synchronously. Throws VaultMissingError if absent. */
export function readVaultJson(vaultPath: string): VaultJson {
  let raw: string;
  try {
    raw = fs.readFileSync(vaultPath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new VaultMissingError(`vault.json not found at ${vaultPath}`);
    throw err;
  }
  return JSON.parse(raw) as VaultJson;
}

/**
 * Atomically write vault.json: serialize to a sibling `.tmp` file then rename
 * over the destination so a crash mid-write cannot corrupt the on-disk vault.
 */
export function writeVaultJsonAtomic(vaultPath: string, json: VaultJson): void {
  const dir = path.dirname(vaultPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${vaultPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(json), { encoding: 'utf8' });
  fs.renameSync(tmp, vaultPath);
}

/** Predicate: does the vault file exist on disk? */
export function vaultExists(vaultPath: string): boolean {
  try {
    fs.accessSync(vaultPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
