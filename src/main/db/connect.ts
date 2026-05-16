/**
 * SQLCipher connection helper using better-sqlite3-multiple-ciphers.
 *
 * Open sequence (RESEARCH Pattern 2):
 *   1. new Database(path)
 *   2. PRAGMA cipher='chacha20'          ← MUST precede PRAGMA key
 *   3. PRAGMA key="x'<32-byte-hex>'"
 *   4. PRAGMA cipher_page_size=4096
 *   5. PRAGMA journal_mode=WAL
 *   6. PRAGMA foreign_keys=ON
 *   7. (optional) runMigrations(db)
 *
 * Any failure inside this sequence closes the handle and throws DbOpenError.
 * sqlite-vec is NOT loaded in Phase 1 (Pitfall 1).
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import Database from 'better-sqlite3-multiple-ciphers';
import { toPragmaKeyHex } from '../vault/derive';
import { runMigrations } from './migrations/runner';

export type Db = Database.Database;

export class DbOpenError extends Error {
  override readonly name = 'DbOpenError';
}

export interface OpenDbOptions {
  /** Directory containing aria.db. Created on demand. */
  dataDir: string;
  /** 32-byte SQLCipher key (output of deriveDbKey). */
  dbKey: Buffer;
  /** Override db filename (used by restore to open the temp file). */
  dbFileName?: string;
  /** Apply numbered migrations after open. Defaults to true. */
  runMigrationsOnOpen?: boolean;
}

const DEFAULT_DB_FILENAME = 'aria.db';

/**
 * Open (or create) the SQLCipher-encrypted DB.
 *
 * Throws DbOpenError if any PRAGMA in the open sequence fails. On wrong-key
 * open, the first query will throw SQLITE_NOTADB — the migration runner
 * surfaces that as a DbOpenError too.
 */
export function openDb(opts: OpenDbOptions): Db {
  const { dataDir, dbKey, dbFileName = DEFAULT_DB_FILENAME } = opts;
  const runMigrationsOnOpen = opts.runMigrationsOnOpen ?? true;
  if (!Buffer.isBuffer(dbKey) || dbKey.length !== 32) {
    throw new DbOpenError('openDb: dbKey must be a 32-byte Buffer');
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, dbFileName);
  const keyHex = toPragmaKeyHex(dbKey);

  const db = new Database(dbPath);
  try {
    db.pragma(`cipher='chacha20'`);
    db.pragma(`key="x'${keyHex}'"`);
    db.pragma(`cipher_page_size=4096`);
    db.pragma(`journal_mode=WAL`);
    db.pragma(`foreign_keys=ON`);
    // Touch the schema once so a wrong-key open fails fast (SQLITE_NOTADB).
    db.prepare('SELECT count(*) FROM sqlite_master').get();
    if (runMigrationsOnOpen) runMigrations(db);
    return db;
  } catch (err) {
    try {
      db.close();
    } catch {
      /* best effort */
    }
    throw new DbOpenError(
      `openDb failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Close a DB handle if open. Idempotent. */
export function closeDb(db: Db): void {
  if (db.open) db.close();
}
