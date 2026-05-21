/**
 * Backup + restore IPC handlers (Plan 02 Task 3b).
 *
 * BACKUP_CREATE: showSaveDialog → createBackup(dbHolder.db, { outPath })
 * BACKUP_RESTORE: restoreBackup → close + reopen dbHolder → { ok: true, restartRequired: true }
 *
 * Plan 03 (wave 4) wires `registerBackupHandlers` into `registerHandlers`.
 * In this worktree wave we wire it from main/index.ts alongside onboarding
 * (see Plan 02 SUMMARY deviation note).
 */
import { dialog, type IpcMain } from 'electron';
import type { Logger } from 'pino';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { CHANNELS } from '../../shared/ipc-contract';
import { createBackup, BackupOverwriteError } from '../db/backup';
import { restoreBackup, RestoreInvalidError } from '../db/restore';
import { deriveDbKey } from '../vault/derive';
import { readVaultJson } from '../vault/storage';
import { openDb } from '../db/connect';
import type { DbHolder } from './onboarding';

export interface BackupDeps {
  logger: Logger;
  dataDir: string;
  dbHolder: DbHolder;
}

function isoStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function registerBackupHandlers(ipcMain: IpcMain, deps: BackupDeps): void {
  const { logger, dataDir, dbHolder } = deps;

  ipcMain.handle(CHANNELS.BACKUP_STATS, async () => {
    const dbPath = path.join(dataDir, 'aria.db');
    let dbSizeBytes = 0;
    try { dbSizeBytes = fs.statSync(dbPath).size; } catch { /* no db yet */ }

    const backupsDir = path.join(dataDir, 'backups');
    let lastBackupName: string | null = null;
    let lastBackupAt: string | null = null;
    try {
      const candidates = [dataDir, backupsDir]
        .flatMap(dir => {
          try { return fs.readdirSync(dir).map(f => ({ dir, f })); } catch { return []; }
        })
        .filter(({ f }) => f.endsWith('.ariabackup') || f.endsWith('.db'))
        .map(({ dir, f }) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      if (candidates[0]) {
        lastBackupName = candidates[0].f;
        lastBackupAt = new Date(candidates[0].mtime).toISOString();
      }
    } catch { /* ignore */ }

    const schemaVersion = dbHolder.db
      ? (() => { try { return (dbHolder.db!.prepare('PRAGMA user_version').get() as { user_version: number }).user_version; } catch { return null; } })()
      : null;

    return { dbSizeBytes, lastBackupName, lastBackupAt, schemaVersion };
  });

  ipcMain.handle(CHANNELS.BACKUP_CREATE, async (_e, req?: unknown) => {
    const r = (req as { destination?: string } | undefined) ?? {};
    if (!dbHolder.db) return { error: 'DB_NOT_OPEN' };
    let outPath = r.destination;
    if (!outPath) {
      const defaultPath = path.join(dataDir, `aria-${isoStamp()}.ariabackup`);
      const res = await dialog.showSaveDialog({
        title: 'Save Aria backup',
        defaultPath,
        filters: [{ name: 'Aria backup', extensions: ['ariabackup'] }],
      });
      if (res.canceled || !res.filePath) return { error: 'CANCELLED' };
      outPath = res.filePath;
    }
    try {
      createBackup(dbHolder.db, { outPath, overwrite: true });
      logger.info({ event: 'backup.created' });
      return { path: outPath };
    } catch (err) {
      if (err instanceof BackupOverwriteError) {
        return { error: 'OVERWRITE_REFUSED' };
      }
      logger.warn({ event: 'backup.failed' });
      return { error: 'BACKUP_FAILED' };
    }
  });

  ipcMain.handle(CHANNELS.BACKUP_RESTORE, async (_e, req: unknown) => {
    const r = (req as {
      source?: string;
      backupPath?: string;
      mnemonic?: string;
      passphrase?: string;
      dailyPassword?: string;
    }) ?? {};
    const backupPath = r.backupPath ?? r.source;
    const mnemonic = r.mnemonic ?? '';
    const dailyPassword = r.dailyPassword ?? r.passphrase ?? '';
    if (!backupPath || !mnemonic) return { error: 'MISSING_ARGS' };
    try {
      await restoreBackup({ dataDir, backupPath, mnemonic, dailyPassword });
      // Reopen the DB with the same key under the (now-replaced) aria.db.
      const vault = readVaultJson(path.join(dataDir, 'vault.json'));
      const appSalt = Buffer.from(vault.appSalt, 'base64');
      const dbKey = await deriveDbKey(mnemonic, appSalt);
      try {
        dbHolder.close();
        // Plan 08-04 Task 4a — restored snapshots are at the prior schema
        // version. Re-migrating here would replay whatever migration just
        // failed and defeat the restore. Open WITHOUT migrating; the next
        // unlock cycle will go through runMigrationsWithBackup explicitly.
        dbHolder.set(
          openDb({ dataDir, dbKey, runMigrationsOnOpen: false }),
        );
      } finally {
        dbKey.fill(0);
      }
      logger.info({ event: 'backup.restored' });
      return { ok: true, restartRequired: true };
    } catch (err) {
      if (err instanceof RestoreInvalidError) {
        logger.warn({ event: 'backup.restore.invalid' });
        return { error: 'RESTORE_INVALID' };
      }
      logger.warn({ event: 'backup.restore.failed' });
      return { error: 'RESTORE_FAILED' };
    }
  });
}
