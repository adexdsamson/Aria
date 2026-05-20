/**
 * Plan 08-04 Task 5 — UPDATER_* IPC handlers.
 *
 * UPDATER_CHECK     → autoUpdater.checkForUpdates() → updateInfo | null
 * UPDATER_DOWNLOAD  → autoUpdater.downloadUpdate()
 * UPDATER_RESTART   → autoUpdater.quitAndInstall()
 *
 * Push events (autoUpdater → renderer) are wired in src/main/release/updater.ts
 * via webContents.send('updater:available'|'updater:progress'|'updater:downloaded'|'updater:error').
 */
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import { CHANNELS } from '../../shared/ipc-contract';
import { getAutoUpdater, getUpdaterChannel } from '../release/updater';

export interface UpdaterIpcDeps {
  logger: Logger;
}

export function registerUpdaterHandlers(
  ipcMain: IpcMain,
  deps: UpdaterIpcDeps,
): void {
  const { logger } = deps;

  ipcMain.handle(CHANNELS.UPDATER_CHECK, async () => {
    const u = getAutoUpdater();
    if (!u) return { error: 'UPDATER_NOT_STARTED' };
    try {
      const info = await u.checkForUpdates();
      return { ok: true, info: info ?? null, channel: getUpdaterChannel() };
    } catch (err) {
      logger.warn(
        { scope: 'ipc.updater', err: (err as Error).message },
        'updater.check.fail',
      );
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle(CHANNELS.UPDATER_DOWNLOAD, async () => {
    const u = getAutoUpdater();
    if (!u) return { error: 'UPDATER_NOT_STARTED' };
    try {
      await u.downloadUpdate();
      return { ok: true };
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle(CHANNELS.UPDATER_RESTART, async () => {
    const u = getAutoUpdater();
    if (!u) return { error: 'UPDATER_NOT_STARTED' };
    try {
      u.quitAndInstall();
      return { ok: true };
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle(CHANNELS.UPDATER_CHANNEL, async () => {
    return { channel: getUpdaterChannel() ?? 'tester' };
  });
}
