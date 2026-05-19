import { BrowserWindow, type App } from 'electron';

export interface SingleInstanceDeps {
  app: Pick<App, 'requestSingleInstanceLock' | 'on' | 'quit'>;
  browserWindow?: Pick<typeof BrowserWindow, 'getAllWindows'>;
  exit?: (code?: number) => void;
}

export function acquireSingleInstanceLock(deps: SingleInstanceDeps): boolean {
  const gotLock = deps.app.requestSingleInstanceLock();
  if (!gotLock) {
    deps.app.quit();
    (deps.exit ?? process.exit)(0);
    return false;
  }

  const browserWindow = deps.browserWindow ?? BrowserWindow;
  deps.app.on('second-instance', () => {
    const win = browserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  return true;
}
