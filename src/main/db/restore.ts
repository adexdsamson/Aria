/**
 * Restore a `.ariabackup` file into `<dataDir>/aria.db`.
 *
 * Algorithm (D-04 mnemonic-only path):
 *   1. Read existing `<dataDir>/vault.json` to extract `appSalt`. The vault
 *      file itself is left untouched — same appSalt is reused so a future
 *      unlock with the supplied daily password still works on the original
 *      sealed mnemonic.
 *   2. Derive the SQLCipher key from `mnemonic + appSalt`.
 *   3. Copy the backup file to `<dataDir>/aria.db.restore.tmp`.
 *   4. Open the temp copy with the derived key; on failure throw
 *      RestoreInvalidError without writing to `<dataDir>/aria.db`.
 *   5. On success, close the temp DB and atomically rename it over
 *      `<dataDir>/aria.db`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { deriveDbKey } from '../vault/derive';
import { readVaultJson } from '../vault/storage';
import { openDb, closeDb, DbOpenError } from './connect';
import { getLogger } from '../log/pino';

export class RestoreInvalidError extends Error {
  override readonly name = 'RestoreInvalidError';
}

export interface RestoreBackupOptions {
  dataDir: string;
  backupPath: string;
  mnemonic: string;
  /**
   * Reserved for a future safety prompt (UI may require entering the daily
   * password before destructive restore). Currently unused except for log
   * context — the mnemonic-only path is sufficient for cryptographic correctness.
   */
  dailyPassword: string;
}

/** Apply a backup file as the new live DB. See file header for algorithm. */
export async function restoreBackup(opts: RestoreBackupOptions): Promise<{ ok: true }> {
  const { dataDir, backupPath, mnemonic } = opts;
  if (!fs.existsSync(backupPath)) {
    throw new RestoreInvalidError(`backup file not found: ${backupPath}`);
  }
  const vaultPath = path.join(dataDir, 'vault.json');
  const vault = readVaultJson(vaultPath); // throws VaultMissingError if absent
  const appSalt = Buffer.from(vault.appSalt, 'base64');
  const dbKey = await deriveDbKey(mnemonic, appSalt);

  const tmpName = `aria.db.restore.${process.pid}.tmp`;
  const tmpPath = path.join(dataDir, tmpName);
  // Clean up any stale temp from a prior aborted restore.
  if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  fs.copyFileSync(backupPath, tmpPath);

  let tmpDb;
  try {
    tmpDb = openDb({
      dataDir,
      dbKey,
      dbFileName: tmpName,
      runMigrationsOnOpen: false,
    });
  } catch (err) {
    // Bad mnemonic, bad backup, or wrong cipher — leave aria.db alone.
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    const name = (err as { name?: string } | null)?.name;
    if (err instanceof DbOpenError || name === 'DbOpenError') {
      throw new RestoreInvalidError(
        `backup could not be opened with derived key: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    throw err;
  }
  closeDb(tmpDb);

  const livePath = path.join(dataDir, 'aria.db');
  fs.renameSync(tmpPath, livePath);
  safeLogger().info({ event: 'db.restore.applied' });
  return { ok: true };
}

function safeLogger(): { info: (o: object, m?: string) => void } {
  try {
    return getLogger();
  } catch {
    return { info: () => undefined };
  }
}
