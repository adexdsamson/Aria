/**
 * Create a `.ariabackup` file by issuing `VACUUM INTO '<outPath>'` against the
 * live DB handle. Per RESEARCH Pattern 7, VACUUM INTO preserves the same
 * SQLCipher key — the backup is a same-cipher, same-key copy of the source.
 *
 * Frontier API keys and OAuth tokens are NOT in the DB (D-04); they live in
 * OS keychain via Electron safeStorage and are therefore excluded from the
 * backup by construction.
 */
import * as fs from 'node:fs';
import type Database from 'better-sqlite3-multiple-ciphers';
import { getLogger } from '../log/pino';

type Db = Database.Database;

export class BackupOverwriteError extends Error {
  override readonly name = 'BackupOverwriteError';
}

export interface CreateBackupOptions {
  outPath: string;
  overwrite?: boolean;
}

/** Issue `VACUUM INTO` against the live DB. Refuses to clobber existing files unless `overwrite`. */
export function createBackup(db: Db, opts: CreateBackupOptions): { path: string } {
  const { outPath, overwrite = false } = opts;
  if (!overwrite && fs.existsSync(outPath)) {
    throw new BackupOverwriteError(`backup file already exists: ${outPath}`);
  }
  if (overwrite && fs.existsSync(outPath)) fs.unlinkSync(outPath);
  // Escape single quotes per SQL string-literal rules. VACUUM INTO does not
  // bind parameters — the path is interpolated.
  const escaped = outPath.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escaped}'`);
  safeLogger().info({ event: 'db.backup.created' });
  return { path: outPath };
}

function safeLogger(): { info: (o: object, m?: string) => void } {
  try {
    return getLogger();
  } catch {
    return { info: () => undefined };
  }
}
