/**
 * Phase 12 / Plan 12-01 — pure decision helpers for the BrowserWindow
 * close handler and the window-all-closed app handler.
 *
 * Extracted from src/main/index.ts so they can be unit-tested without
 * loading the full Electron bootstrap (which calls
 * acquireSingleInstanceLock at module top-level).
 */

/**
 * Returns 'hide' iff the window should be hidden into the tray (the close
 * handler must then call `e.preventDefault(); win.hide()`). Returns
 * 'destroy' iff the close should proceed normally (which on non-darwin
 * fires window-all-closed and quits the app).
 *
 * Logic per CONTEXT.md Decision 1 + D-05 (macOS dock always visible):
 *   - darwin: red-button-X always hides unless appIsQuitting is true.
 *   - non-darwin: hide iff closeToTray pref is true (default) AND we're
 *     not in a quit sequence. Toggling closeToTray=false yields the legacy
 *     behavior (X quits the app).
 */
export function decideCloseAction(input: {
  platform: NodeJS.Platform;
  closeToTray: boolean;
  appIsQuitting: boolean;
}): 'hide' | 'destroy' {
  if (input.appIsQuitting) return 'destroy';
  if (input.platform === 'darwin') return 'hide';
  return input.closeToTray ? 'hide' : 'destroy';
}

/**
 * Returns 'stay' iff the app process should keep running after the last
 * window closes (the handler must `return` early — no app.quit() call).
 * Returns 'quit' iff the handler should call `app.quit()`.
 *
 * macOS always stays (Electron convention). Non-darwin stays only when
 * closeToTray is true (the window is hidden, not destroyed — see
 * decideCloseAction).
 */
export function decideWindowAllClosed(input: {
  platform: NodeJS.Platform;
  closeToTray: boolean;
}): 'quit' | 'stay' {
  if (input.platform === 'darwin') return 'stay';
  return input.closeToTray ? 'stay' : 'quit';
}
