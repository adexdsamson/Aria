import { BrowserWindow, type App } from 'electron';

/**
 * Plan 08.1-02 Task 9: deep-link routing for `aria://activate?key=...`.
 *
 * `second-instance` (Windows/Linux) receives the URL in argv when a user
 * clicks an `aria://` link while Aria is already running. `open-url` (macOS)
 * is the platform-native equivalent. We forward both to `onAriaUrl`, which
 * the main bootstrap wires to `handleActivateDeepLink`.
 */
export interface SingleInstanceDeps {
  app: Pick<
    App,
    | 'requestSingleInstanceLock'
    | 'on'
    | 'quit'
    | 'setAsDefaultProtocolClient'
  >;
  browserWindow?: Pick<typeof BrowserWindow, 'getAllWindows'>;
  exit?: (code?: number) => void;
  /** Forwarded any time we observe an aria:// URL (second-instance or open-url). */
  onAriaUrl?: (url: string) => void;
}

const ARIA_URL_RE = /^aria:\/\/[^\s]+/i;

function findAriaUrl(argv: readonly string[] | undefined): string | null {
  if (!argv) return null;
  for (const a of argv) {
    if (typeof a === 'string' && ARIA_URL_RE.test(a)) return a;
  }
  return null;
}

export function acquireSingleInstanceLock(deps: SingleInstanceDeps): boolean {
  const gotLock = deps.app.requestSingleInstanceLock();
  if (!gotLock) {
    deps.app.quit();
    (deps.exit ?? process.exit)(0);
    return false;
  }

  const browserWindow = deps.browserWindow ?? BrowserWindow;

  // Register Aria as the default protocol client (idempotent per Electron docs).
  try {
    deps.app.setAsDefaultProtocolClient('aria');
  } catch {
    /* setAsDefaultProtocolClient throws in some test environments; tolerate */
  }

  deps.app.on(
    'second-instance',
    (_event: unknown, argv: string[] | undefined) => {
      const win = browserWindow.getAllWindows()[0];
      if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
      }
      const url = findAriaUrl(argv);
      if (url && deps.onAriaUrl) {
        try {
          deps.onAriaUrl(url);
        } catch {
          /* deep-link handler must not crash second-instance */
        }
      }
    },
  );

  // macOS open-url. Electron emits this as `app.on('open-url', cb)`.
  deps.app.on(
    'open-url' as Parameters<App['on']>[0],
    (event: { preventDefault?: () => void }, url: string) => {
      try {
        event.preventDefault?.();
      } catch {
        /* noop */
      }
      if (typeof url === 'string' && ARIA_URL_RE.test(url) && deps.onAriaUrl) {
        try {
          deps.onAriaUrl(url);
        } catch {
          /* noop */
        }
      }
    },
  );

  return true;
}
