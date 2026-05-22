/**
 * Phase 12 / Plan 12-01 — Background-activity IPC handlers.
 *
 * Two channels:
 *   - BG_GET_PREFS: defaults-only read; safe pre-unlock.
 *   - BG_SET_PREFS: writes require unlocked DB. On `autoLaunch` change,
 *     delegates to `setAutoLaunch` which mirrors to `app.setLoginItemSettings`.
 *
 * Registered ONCE at bootstrap (no stub-then-real pattern per RESEARCH
 * Pitfall 5). Pre-unlock reads return BG_PREF_DEFAULTS.
 */
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import { z } from 'zod';
import { CHANNELS, type BackgroundPrefsDto } from '../../shared/ipc-contract';
import type { DbHolder } from './onboarding';
import {
  getBackgroundPrefs,
  setAutoLaunch,
  writeBgPref,
} from '../background/prefs';

/**
 * Closed Zod schema — strict() rejects any unknown keys, blocking
 * tampering-shaped payloads (T-12-01). All three fields optional and
 * boolean-typed; `firstCloseToastShown` is intentionally NOT writable
 * from the renderer.
 */
const BackgroundPrefsPatchSchema = z
  .object({
    autoLaunch: z.boolean().optional(),
    closeToTray: z.boolean().optional(),
    notificationsEnabled: z.boolean().optional(),
  })
  .strict();

export function registerBackgroundHandlers(
  ipcMain: IpcMain,
  dbHolder: DbHolder,
  logger: Logger,
): void {
  ipcMain.handle(CHANNELS.BG_GET_PREFS, (): BackgroundPrefsDto => {
    return getBackgroundPrefs(dbHolder.db);
  });

  ipcMain.handle(
    CHANNELS.BG_SET_PREFS,
    async (
      _event,
      payload: unknown,
    ): Promise<BackgroundPrefsDto | { error: string }> => {
      const db = dbHolder.db;
      if (!db) {
        return { error: 'db-locked' };
      }
      const parsed = BackgroundPrefsPatchSchema.safeParse(payload);
      if (!parsed.success) {
        logger.warn(
          { scope: 'background-prefs', op: 'set-prefs', err: parsed.error.message },
          'BG_SET_PREFS payload rejected',
        );
        return { error: 'invalid-payload' };
      }
      const patch = parsed.data;
      try {
        if (patch.autoLaunch !== undefined) {
          setAutoLaunch(db, patch.autoLaunch, logger);
        }
        if (patch.closeToTray !== undefined) {
          writeBgPref(db, 'closeToTray', patch.closeToTray);
        }
        if (patch.notificationsEnabled !== undefined) {
          writeBgPref(db, 'notificationsEnabled', patch.notificationsEnabled);
        }
      } catch (err) {
        logger.warn(
          {
            scope: 'background-prefs',
            op: 'set-prefs',
            err: (err as Error).message,
          },
          'BG_SET_PREFS write failed',
        );
        return { error: 'write-failed' };
      }
      return getBackgroundPrefs(db);
    },
  );
}
