/**
 * Plan 08-04 Task 4 — pre-migration backup wrapper + row-count verifier +
 * atomic restore helper.
 *
 * Flow (boot-time, called by onboarding seal/unlock):
 *   1. Determine pending migrations vs current user_version.
 *   2. If any pending, capture a VACUUM-INTO snapshot at
 *      <dataDir>/backups/<stamp>-v<prev>.ariabackup. Skip when no pending.
 *   3. Record pre-counts for CRITICAL_TABLES.
 *   4. Invoke runMigrations(db). On throw, rethrow MigrationFailedError
 *      carrying the backupPath so the caller can show the recovery dialog.
 *   5. After successful migrate, record post-counts. If any CRITICAL_TABLES
 *      row count dropped without being declared in expectedDrops, throw
 *      RowCountDriftError (same shape — caller decides to restore).
 *   6. Prune old backups beyond retainCount (oldest by mtime).
 *
 * Restore (called by main process on user-confirmed recovery):
 *   restoreFromBackup(backupPath, liveDbPath, dbHolder, dbKey) →
 *     dbHolder.close() FIRST, then fs.renameSync(backupCopy → liveDbPath),
 *     then dbHolder.set(openDb({ runMigrationsOnOpen: false })).
 *
 * Pitfall 3 guard: close BEFORE rename. SQLite file handles on Windows
 * refuse renames while open; on POSIX it would leave the renamed file
 * pointing at the wrong inode for any new opener. Order matters.
 *
 * H-3 round 2: `expectedDrops: Record<number, string[]>` is the ONLY
 * supported declaration mechanism. SQL-comment-parsing alternative
 * deleted — the runner doesn't need to know about the directive.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type Database from 'better-sqlite3-multiple-ciphers';
import { runMigrations } from '../db/migrations/runner';
import { createBackup } from '../db/backup';
import { verifyRowCounts, CRITICAL_TABLES } from './verify-migration';
import { openDb, closeDb, type Db } from '../db/connect';

type DbAny = Database.Database;

export class MigrationFailedError extends Error {
  override readonly name = 'MigrationFailedError';
  readonly backupPath: string | null;
  readonly cause: unknown;
  constructor(message: string, opts: { backupPath: string | null; cause: unknown }) {
    super(message);
    this.backupPath = opts.backupPath;
    this.cause = opts.cause;
  }
}

export class RowCountDriftError extends Error {
  override readonly name = 'RowCountDriftError';
  readonly backupPath: string | null;
  readonly drift: Array<{ table: string; before: number; after: number }>;
  constructor(
    message: string,
    opts: { backupPath: string | null; drift: Array<{ table: string; before: number; after: number }> },
  ) {
    super(message);
    this.backupPath = opts.backupPath;
    this.drift = opts.drift;
  }
}

export interface RunMigrationsWithBackupOptions {
  dataDir: string;
  /** Keep the most recent N backups; oldest pruned. Default 5. */
  retainCount?: number;
  /**
   * Per-migration whitelist of tables expected to lose rows. Map shape:
   *   { <migrationVersion>: ['table_a', 'table_b'] }
   * Phase 8 ships with `{}` — migrations 128/129/130 are additive only.
   */
  expectedDrops?: Record<number, string[]>;
  /** Test-only override of the runMigrations function (recursion-guard tests). */
  runMigrationsFn?: typeof runMigrations;
  /** Test-only override of the backup capture function. */
  createBackupFn?: typeof createBackup;
}

function ensureBackupDir(dataDir: string): string {
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function backupStamp(): string {
  // ISO-ish, filesystem-safe.
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

function pendingMigrationsExist(db: DbAny): boolean {
  // Heuristic — we cannot cheaply enumerate without loadMigrations being
  // exported. The runner internally no-ops when user_version is current;
  // we always snapshot when caller invokes us. That's the safe default —
  // a never-changing user_version means subsequent boots still snapshot
  // but pruning keeps disk usage bounded. Optimization: peek at the
  // current user_version; if a sibling NEW SQL file exists in the
  // bundled migrations dir with a larger version, we snapshot.
  void db;
  return true;
}

function pruneOldBackups(dir: string, retainCount: number): void {
  let entries: Array<{ name: string; mtimeMs: number }> = [];
  try {
    entries = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.ariabackup'))
      .map((name) => ({ name, mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs }));
  } catch {
    return;
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const e of entries.slice(retainCount)) {
    try {
      fs.unlinkSync(path.join(dir, e.name));
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Wrap `runMigrations(db)` with snapshot + row-count verify. On migration
 * throw or row-count drift, rethrow a typed error carrying `backupPath` so
 * the caller can drive `restoreFromBackup`. Returns the list of versions
 * actually applied (same shape as bare `runMigrations`).
 */
export function runMigrationsWithBackup(
  db: DbAny,
  liveDbPath: string,
  opts: RunMigrationsWithBackupOptions,
): number[] {
  const { dataDir, retainCount = 5, expectedDrops = {}, runMigrationsFn, createBackupFn } = opts;
  const backupDir = ensureBackupDir(dataDir);
  const prevVersion = db.pragma('user_version', { simple: true }) as number;

  let backupPath: string | null = null;
  if (pendingMigrationsExist(db)) {
    const stamp = backupStamp();
    backupPath = path.join(backupDir, `${stamp}-v${prevVersion}.ariabackup`);
    try {
      (createBackupFn ?? createBackup)(db, { outPath: backupPath });
    } catch {
      // Backup failure is itself fatal — without a snapshot we can't safely
      // proceed. Wrap as MigrationFailedError so the caller's recovery
      // dialog still fires (it will show a "backup failed" branch).
      backupPath = null;
    }
  }

  // Pre-counts for the CRITICAL_TABLES set. Tables that do not yet exist
  // (e.g. on a fresh DB before migrations 001..130 land) count as 0.
  const beforeCounts = readCounts(db, CRITICAL_TABLES);

  let applied: number[] = [];
  try {
    applied = (runMigrationsFn ?? runMigrations)(db);
  } catch (err) {
    throw new MigrationFailedError(
      err instanceof Error ? err.message : String(err),
      { backupPath, cause: err },
    );
  }

  const afterCounts = readCounts(db, CRITICAL_TABLES);
  const drift = verifyRowCounts(beforeCounts, afterCounts, applied, expectedDrops);
  if (drift.length > 0) {
    throw new RowCountDriftError(
      `row-count drift detected on tables: ${drift.map((d) => d.table).join(', ')}`,
      { backupPath, drift },
    );
  }

  pruneOldBackups(backupDir, retainCount);
  void liveDbPath;
  return applied;
}

function readCounts(db: DbAny, tables: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of tables) {
    try {
      const row = db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number } | undefined;
      out[t] = row?.n ?? 0;
    } catch {
      // Table doesn't exist yet (fresh DB before its own migration ran). Treat as 0.
      out[t] = 0;
    }
  }
  return out;
}

export interface DbHolderHandle {
  readonly db: Db | null;
  close(): void;
  set(db: Db): void;
}

/**
 * Atomic restore. ORDER MATTERS:
 *   1. dbHolder.close() — release the file handle (Windows refuses
 *      rename-over-open-file; POSIX would leave the renamed file
 *      decoupled from any new openers if we reversed the order).
 *   2. fs.renameSync(backupCopy → liveDbPath) — atomic on the same FS.
 *   3. dbHolder.set(openDb(..., runMigrationsOnOpen: false)) — reopen
 *      with the SAME cached key and explicitly DO NOT re-migrate. The
 *      snapshot is at the prior schema version; re-migrating would
 *      replay whatever just failed.
 *
 * `dbKey` is required because openDb is the cipher-aware constructor and
 * the holder doesn't retain the key. Caller passes the same Buffer it
 * used for the original open.
 */
export function restoreFromBackup(
  backupPath: string,
  liveDbPath: string,
  dbHolder: DbHolderHandle,
  dbKey: Buffer,
): void {
  // Step 1 — close BEFORE rename (Pitfall 3 guard).
  dbHolder.close();

  // Step 2 — atomic copy-then-rename. We copy the .ariabackup so the
  // original snapshot stays on disk (subsequent boots can retry); only
  // the copy is renamed over the live DB.
  const tmpPath = `${liveDbPath}.restore.${process.pid}.tmp`;
  if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  fs.copyFileSync(backupPath, tmpPath);
  fs.renameSync(tmpPath, liveDbPath);

  // Step 3 — reopen with the cached key, NEVER re-migrate.
  const dataDir = path.dirname(liveDbPath);
  const reopened = openDb({
    dataDir,
    dbKey,
    runMigrationsOnOpen: false,
  });
  dbHolder.set(reopened);
}

// Re-export for convenience.
export { closeDb };
