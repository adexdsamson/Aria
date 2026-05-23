/**
 * PROFILE_GET / PROFILE_SET handlers (Quick 260523-eaf).
 *
 * Reads/writes `<dataDir>/profile.json` via the pure-function store module.
 * No DB dependency — runs pre-unlock so UnlockScreen can render the
 * personalized greeting before the vault is unsealed.
 */
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import { CHANNELS } from '../../shared/ipc-contract';
import { readProfile, writeProfileAtomic } from '../profile/store';

export interface ProfileDeps {
  logger: Logger;
  dataDir: string;
}

export function registerProfileHandlers(
  ipcMain: IpcMain,
  deps: ProfileDeps,
): void {
  const { logger, dataDir } = deps;

  ipcMain.handle(CHANNELS.PROFILE_GET, async () => {
    const profile = readProfile(dataDir);
    return { displayName: profile?.displayName ?? null };
  });

  ipcMain.handle(CHANNELS.PROFILE_SET, async (_e, req: unknown) => {
    const r = req as { displayName?: unknown };
    if (typeof r?.displayName !== 'string') {
      return { ok: false as const, error: 'INVALID_DISPLAY_NAME' };
    }
    const trimmed = r.displayName.trim();
    if (trimmed.length === 0) {
      return { ok: false as const, error: 'INVALID_DISPLAY_NAME' };
    }
    try {
      writeProfileAtomic(dataDir, { displayName: trimmed });
      logger.info({ event: 'profile.set' });
      return { ok: true as const };
    } catch (err) {
      logger.warn({
        event: 'profile.set.failed',
        error: err instanceof Error ? err.message : String(err),
      });
      return { ok: false as const, error: 'WRITE_FAILED' };
    }
  });
}
