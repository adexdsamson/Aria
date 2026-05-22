/**
 * Phase 12 / Plan 12-02 Task 1 — Tray context menu builder.
 *
 * Six items per Decision 3:
 *   1. Show Aria
 *   2. Generate briefing now      (db-gated)
 *   3. Sync now                    (submenu Gmail / Calendar / Todoist; each
 *                                   gated on dbOpen AND connected[provider])
 *   4. Open approvals              (always visible — navigates renderer)
 *   5. ──── separator ────
 *   6. Quit Aria
 *
 * Items that touch the DB are disabled when `dbHolder.db === null` so a tray
 * click during a sealed-vault session never fires DB writes (T-12-05).
 */
import { Menu, type MenuItemConstructorOptions, type BrowserWindow } from 'electron';
import type { Logger } from 'pino';
import type { DbHolder } from '../ipc/onboarding';

export interface TrayConnectedState {
  gmail: boolean;
  calendar: boolean;
  todoist: boolean;
}

export interface TrayMenuDeps {
  getMainWindow: () => BrowserWindow | null;
  dbHolder: DbHolder;
  connected: TrayConnectedState;
  /** Invoke an IPC channel by name (handler must be registered). */
  invokeChannel: (channel: string) => void | Promise<void>;
  /** Send a renderer-bound navigate event. */
  navigate: (path: string) => void;
  /** Mark "user requested quit" so the close handler does not intercept. */
  beginQuit: () => void;
  /** Quit the app (typically app.quit). */
  quit: () => void;
  logger?: Pick<Logger, 'info' | 'warn'>;
}

export function buildContextMenu(deps: TrayMenuDeps): Menu {
  const dbOpen = deps.dbHolder.db !== null;
  const sealedTip = dbOpen ? undefined : 'Unlock Aria first';

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Show Aria',
      click: () => {
        const win = deps.getMainWindow();
        if (!win) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      },
    },
    {
      label: 'Generate briefing now',
      enabled: dbOpen,
      toolTip: sealedTip,
      click: () => {
        void Promise.resolve(deps.invokeChannel('aria:briefing:generate-now')).catch(
          (err) =>
            deps.logger?.warn(
              { scope: 'tray', err: (err as Error).message },
              'generate-now invoke failed',
            ),
        );
      },
    },
    {
      label: 'Sync now',
      submenu: [
        {
          label: 'Gmail',
          enabled: dbOpen && deps.connected.gmail,
          toolTip: sealedTip,
          click: () => {
            void Promise.resolve(deps.invokeChannel('aria:gmail:force-sync')).catch(
              () => undefined,
            );
          },
        },
        {
          label: 'Calendar',
          enabled: dbOpen && deps.connected.calendar,
          toolTip: sealedTip,
          click: () => {
            void Promise.resolve(deps.invokeChannel('aria:calendar:force-sync')).catch(
              () => undefined,
            );
          },
        },
        {
          label: 'Todoist',
          enabled: dbOpen && deps.connected.todoist,
          toolTip: sealedTip,
          click: () => {
            void Promise.resolve(deps.invokeChannel('aria:todoist:force-sync')).catch(
              () => undefined,
            );
          },
        },
      ],
    },
    {
      label: 'Open approvals',
      click: () => {
        const win = deps.getMainWindow();
        if (win) {
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        }
        deps.navigate('/approvals');
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Aria',
      click: () => {
        deps.beginQuit();
        deps.quit();
      },
    },
  ];

  return Menu.buildFromTemplate(template);
}
