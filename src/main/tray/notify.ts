/**
 * Phase 12 / Plan 12-03 — Native notification helpers.
 *
 * Exports:
 *   - showBriefingReadyNotification: fires a native OS notification when the
 *     briefing completes. Gated on notificationsEnabled + per-dateKey dedupe +
 *     Notification.isSupported(). On click, focuses the window and routes to
 *     /briefing via the aria:navigate IPC channel.
 *
 *   - maybeShowFirstCloseToast: fires the one-time "Aria is still running in
 *     the tray" notification on the first close-to-tray event on Windows.
 *     See BG-07 rationale comment below.
 */
import { Notification, type BrowserWindow } from 'electron';
import type { Logger } from 'pino';
import type { Database as BSqlite3 } from 'better-sqlite3';
import { CHANNELS } from '../../shared/ipc-contract';
import { readBgPref, writeBgPref } from '../background/prefs';

type Db = BSqlite3;

// ---------------------------------------------------------------------------
// Module-level dedupe Set — prevents firing more than one briefing notification
// per briefingDateKey (T-12-12: DoS guard).
// ---------------------------------------------------------------------------

const _briefingNotificationDedupe = new Set<string>();

/** Test-only: reset the dedupe Set between specs. */
export function _resetDedupeForTests(): void {
  _briefingNotificationDedupe.clear();
}

// ---------------------------------------------------------------------------
// Notification summary type
// ---------------------------------------------------------------------------

export interface BriefingSummary {
  emails: number;
  events: number;
  news: number;
}

export interface ShowBriefingNotificationOpts {
  notificationsEnabled: boolean;
  logger?: Pick<Logger, 'info' | 'warn'>;
}

// ---------------------------------------------------------------------------
// showBriefingReadyNotification
// ---------------------------------------------------------------------------

/**
 * Fire a native notification when the daily briefing completes.
 *
 * Guards (in order):
 *   1. notificationsEnabled=false  → return (CONTEXT Decision 4 / BG-06)
 *   2. dateKey already in dedupe   → return (one per day throttle, T-12-12)
 *   3. !Notification.isSupported() → log + return (macOS silent no-op fallback)
 *
 * On click: restore/show/focus window + webContents.send(CHANNELS.NAVIGATE, '/briefing').
 * On macOS permission denial, show() is a silent no-op — tray badge is the fallback.
 */
export function showBriefingReadyNotification(
  win: BrowserWindow,
  summary: BriefingSummary,
  dateKey: string,
  opts: ShowBriefingNotificationOpts,
): void {
  if (!opts.notificationsEnabled) {
    return;
  }
  if (_briefingNotificationDedupe.has(dateKey)) {
    return;
  }
  if (!(Notification as unknown as { isSupported: () => boolean }).isSupported()) {
    opts.logger?.info(
      { scope: 'notify', dateKey },
      'notifications unsupported, skipping briefing notification',
    );
    return;
  }

  const notif = new Notification({
    title: 'Your morning briefing is ready',
    body: `${summary.emails} emails, ${summary.events} events, ${summary.news} news`,
    silent: false,
  });

  notif.on('click', () => {
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
    win.webContents.send(CHANNELS.NAVIGATE, '/briefing');
  });

  notif.show();
  _briefingNotificationDedupe.add(dateKey);
}

// ---------------------------------------------------------------------------
// maybeShowFirstCloseToast
// ---------------------------------------------------------------------------

/**
 * Fire the one-time "Aria is still running" discoverability toast on the first
 * close-to-tray event.
 *
 * IMPORTANT — BG-07 intent preserved:
 *
 * // BG-07: This toast is intentionally NOT gated on notificationsEnabled.
 * // It is a one-time discoverability affordance, not a normal notification.
 * // CONTEXT Decision 2 gates BRIEFING notifications on notificationsEnabled;
 * // the first-X toast is the only way a user with notificationsEnabled=false
 * // discovers that closing the X hides Aria to the system tray.
 *
 * Guards (in order):
 *   1. db === null → return (pre-unlock; can't read/write firstCloseToastShown)
 *   2. firstCloseToastShown=true → return (one-time guard)
 *
 * Regardless of Notification.isSupported(), ALWAYS writes firstCloseToastShown=true
 * so the toast never re-fires even on systems with notification support unavailable.
 *
 * Called from the BrowserWindow close handler when action='hide' AND non-darwin.
 */
export function maybeShowFirstCloseToast(
  _win: BrowserWindow,
  db: Db | null,
  logger?: Pick<Logger, 'info' | 'warn'>,
): void {
  // Defensive: pre-unlock path cannot read/write settings.
  if (db === null) {
    return;
  }

  // Read the one-time guard flag.
  const alreadyShown = readBgPref(db, 'firstCloseToastShown', false);
  if (alreadyShown) {
    return;
  }

  // BG-07: NOT gated on notificationsEnabled — intentional, see above.
  if ((Notification as unknown as { isSupported: () => boolean }).isSupported()) {
    const notif = new Notification({
      title: 'Aria is still running',
      body: 'Right-click the tray icon to quit.',
      silent: true,
    });
    notif.show();
  } else {
    logger?.info(
      { scope: 'notify' },
      'notifications unsupported; skipping first-close toast (flag still written)',
    );
  }

  // Always write the flag regardless of Notification.isSupported() path,
  // so future close events don't retry.
  try {
    writeBgPref(db, 'firstCloseToastShown', true);
  } catch (err) {
    logger?.warn(
      { scope: 'notify', err: (err as Error).message },
      'failed to write firstCloseToastShown',
    );
  }
}
