/**
 * Phase 12 / Plan 12-02 Task 1 — Tray creation + lifecycle.
 *
 * Module-level `_tray` ref pins the Tray instance against GC (Electron
 * historical bug #33040 — convention remains). Platform-specific click
 * binding:
 *   - win32/linux: left-click → show window; right-click → context menu
 *     (default Electron behavior on setContextMenu).
 *   - darwin:      click → popUpContextMenu (Apple status-item convention).
 *
 * trayBus is exported as a module-level mutable slot for setBadge/clearBadge
 * so cron callsites can call it BEFORE createTray runs (the slot's defaults
 * are no-ops, so pre-bootstrap calls are safe — see T-12-06 mitigation).
 * createTray installs real implementations on construction.
 */
import { Tray, type BrowserWindow } from 'electron';
import type { Logger } from 'pino';
import type { DbHolder } from '../ipc/onboarding';
import { loadTrayIcon } from './icons';
import {
  buildContextMenu,
  type TrayConnectedState,
  type TrayMenuDeps,
} from './menu';

/**
 * Module-level Tray ref. Hold a strong reference until app.quit so the
 * icon never disappears in packaged builds.
 *   Phase 12 / Plan 12-02 — GC pinning (Electron #33040 convention).
 */
let _tray: Tray | null = null;

/**
 * Pre-construction-safe badge slots. Cron callsites call trayBus.setBadge()
 * during sealed-DB skip; if the tray hasn't been built yet (e.g. cron
 * registered pre-bootstrap or a race) the call is a no-op.
 * createTray rebinds these to the real Tray methods.
 */
export const trayBus: {
  setBadge: () => void;
  clearBadge: () => void;
} = {
  setBadge: (): void => undefined,
  clearBadge: (): void => undefined,
};

export interface TrayDeps {
  getMainWindow: () => BrowserWindow | null;
  dbHolder: DbHolder;
  connected: TrayConnectedState;
  invokeChannel: (channel: string) => void | Promise<void>;
  navigate: (path: string) => void;
  beginQuit: () => void;
  quit: () => void;
  logger: Pick<Logger, 'info' | 'warn'>;
  /** Override for tests — defaults to process.platform. */
  platform?: NodeJS.Platform;
}

export interface TrayHandle {
  setBadge(): void;
  clearBadge(): void;
  rebuildMenu(): void;
  dispose(): void;
}

/**
 * Construct the tray. Returns a handle for the bootstrap to drive
 * badge / menu / dispose lifecycle. Call ONCE per process — guarded by
 * acquireSingleInstanceLock at the bootstrap level (single-instance-tray
 * spec enforces createTray-at-most-once invariant).
 */
export function createTray(deps: TrayDeps): TrayHandle {
  const platform = deps.platform ?? process.platform;
  const plainIcon = loadTrayIcon('plain', platform);
  _tray = new Tray(plainIcon);
  _tray.setToolTip('Aria — chief of staff');

  const menuDeps: TrayMenuDeps = {
    getMainWindow: deps.getMainWindow,
    dbHolder: deps.dbHolder,
    connected: deps.connected,
    invokeChannel: deps.invokeChannel,
    navigate: deps.navigate,
    beginQuit: deps.beginQuit,
    quit: deps.quit,
    logger: deps.logger,
  };

  _tray.setContextMenu(buildContextMenu(menuDeps));

  if (platform === 'darwin') {
    _tray.on('click', () => {
      _tray?.popUpContextMenu();
    });
  } else {
    _tray.on('click', () => {
      const win = deps.getMainWindow();
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    });
  }

  // Install real badge implementations on the bus.
  trayBus.setBadge = (): void => {
    try {
      _tray?.setImage(loadTrayIcon('badged', platform));
    } catch (err) {
      deps.logger.warn(
        { scope: 'tray', err: (err as Error).message },
        'setBadge failed',
      );
    }
  };
  trayBus.clearBadge = (): void => {
    try {
      _tray?.setImage(loadTrayIcon('plain', platform));
    } catch (err) {
      deps.logger.warn(
        { scope: 'tray', err: (err as Error).message },
        'clearBadge failed',
      );
    }
  };

  return {
    setBadge: () => trayBus.setBadge(),
    clearBadge: () => trayBus.clearBadge(),
    rebuildMenu: () => {
      _tray?.setContextMenu(buildContextMenu(menuDeps));
    },
    dispose: () => {
      try {
        _tray?.destroy();
      } catch {
        /* best-effort */
      }
      _tray = null;
      trayBus.setBadge = (): void => undefined;
      trayBus.clearBadge = (): void => undefined;
    },
  };
}

/** Test-only: expose _tray presence (without leaking the Tray). */
export function _hasTrayForTests(): boolean {
  return _tray !== null;
}

/** Test-only: reset module-level state between specs. */
export function _resetTrayForTests(): void {
  try {
    _tray?.destroy();
  } catch {
    /* best-effort */
  }
  _tray = null;
  trayBus.setBadge = (): void => undefined;
  trayBus.clearBadge = (): void => undefined;
}
