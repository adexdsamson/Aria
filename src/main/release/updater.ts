/**
 * Plan 08-04 Task 5 — electron-updater wiring.
 *
 * Boot-started from src/main/index.ts AFTER the main BrowserWindow exists
 * (download-progress / update-available / update-downloaded events forward
 * to the renderer via webContents.send). The renderer-side UpdatesSection
 * subscribes via a preload-exposed listener.
 *
 * Channel selection:
 *   - Default channel = process.env.ARIA_UPDATE_CHANNEL ?? 'tester'.
 *   - 'tester' tracks `*-tester.yml` feeds (electron-builder publishes
 *     pre-release tags to that channel); 'latest' tracks GA.
 *
 * Pino-shim logger adapter: electron-updater wants an object with
 * `info|warn|error|debug|transports` so we wrap our pino logger.
 *
 * NOTE: this file lazily imports electron-updater so that unit tests
 * which never call startAutoUpdater() don't pay the require cost (and
 * don't need the dep present at install time during the Phase-8 ABI
 * lock workaround).
 */
import type { BrowserWindow } from 'electron';
import type { Logger } from 'pino';

export interface StartAutoUpdaterOpts {
  logger: Logger;
  window: BrowserWindow;
  /** Override the channel ('tester' | 'latest' | 'beta'). */
  channel?: string;
  /** Override the autoUpdater import (tests). */
  autoUpdaterOverride?: AutoUpdaterShape;
}

/** Subset of electron-updater autoUpdater we touch — enough to mock in tests. */
export interface AutoUpdaterShape {
  logger: unknown;
  channel: string;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
}

function buildPinoShim(logger: Logger): {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug: (msg: string) => void;
  transports?: unknown;
} {
  return {
    info: (msg: string) => logger.info({ scope: 'updater' }, msg),
    warn: (msg: string) => logger.warn({ scope: 'updater' }, msg),
    error: (msg: string) => logger.error({ scope: 'updater' }, msg),
    debug: (msg: string) => logger.debug({ scope: 'updater' }, msg),
  };
}

let started: { autoUpdater: AutoUpdaterShape; channel: string } | null = null;

/**
 * Wire up electron-updater. Idempotent — repeat calls are no-ops.
 * Returns the autoUpdater instance for IPC handlers to invoke.
 */
export async function startAutoUpdater(
  opts: StartAutoUpdaterOpts,
): Promise<AutoUpdaterShape> {
  if (started) return started.autoUpdater;

  const channel =
    opts.channel ?? process.env['ARIA_UPDATE_CHANNEL'] ?? 'tester';

  let autoUpdater: AutoUpdaterShape;
  if (opts.autoUpdaterOverride) {
    autoUpdater = opts.autoUpdaterOverride;
  } else {
    // Lazy require so unit tests + the ABI-lock workaround skip the load.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('electron-updater') as {
      autoUpdater: AutoUpdaterShape;
    };
    autoUpdater = mod.autoUpdater;
  }

  autoUpdater.logger = buildPinoShim(opts.logger);
  autoUpdater.channel = channel;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // Event forwarding — renderer subscribes via preload.
  const send = (channelName: string, payload: unknown): void => {
    try {
      opts.window.webContents.send(channelName, payload);
    } catch (err) {
      opts.logger.warn(
        { scope: 'updater', err: (err as Error).message },
        'updater.event.send.fail',
      );
    }
  };

  autoUpdater.on('update-available', (info: unknown) => {
    opts.logger.info({ scope: 'updater', event: 'update-available' });
    send('updater:available', info);
  });
  autoUpdater.on('download-progress', (info: unknown) => {
    send('updater:progress', info);
  });
  autoUpdater.on('update-downloaded', (info: unknown) => {
    opts.logger.info({ scope: 'updater', event: 'update-downloaded' });
    send('updater:downloaded', info);
  });
  autoUpdater.on('error', (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    opts.logger.warn({ scope: 'updater', err: msg }, 'updater.error');
    send('updater:error', { message: msg });
  });

  started = { autoUpdater, channel };
  return autoUpdater;
}

/** Returns the wired autoUpdater (or null if startAutoUpdater never ran). */
export function getAutoUpdater(): AutoUpdaterShape | null {
  return started?.autoUpdater ?? null;
}

/** Returns the active channel name. */
export function getUpdaterChannel(): string | null {
  return started?.channel ?? null;
}

/** Test-only reset. */
export function _resetAutoUpdaterForTests(): void {
  started = null;
}
