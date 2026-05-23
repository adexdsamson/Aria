/**
 * Phase 12 / Plan 12-03 Task 1 — Tests for src/main/tray/notify.ts
 *
 * Covers:
 *   - showBriefingReadyNotification: dedupe per dateKey, notificationsEnabled gate,
 *     Notification.isSupported() guard, click handler (show/restore/focus + navigate).
 *   - maybeShowFirstCloseToast: first call fires + flips flag, second call no-ops,
 *     NOT gated on notificationsEnabled (BG-07), Notification.isSupported()=false
 *     still writes flag, db=null no-op.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Electron mock — factory uses only vi.fn() (no top-level vars, hoisting safe)
// ---------------------------------------------------------------------------

vi.mock('electron', () => {
  const instances: { on: ReturnType<typeof vi.fn>; show: ReturnType<typeof vi.fn> }[] = [];
  let _isSupported = true;

  // Must be a proper class to support `new`
  class NotificationMock {
    static _instances = instances;
    static _setIsSupported(v: boolean) { _isSupported = v; }
    static isSupported() { return _isSupported; }

    on = vi.fn();
    show = vi.fn();

    constructor(_opts: unknown) {
      const inst = { on: this.on, show: this.show };
      instances.push(inst);
    }
  }
  // Wrap in vi.fn so we can track call count
  const MockCtor = vi.fn().mockImplementation(function(opts: unknown) {
    return new NotificationMock(opts);
  });
  // Copy statics onto the wrapper
  (MockCtor as unknown as typeof NotificationMock).isSupported = NotificationMock.isSupported;
  (MockCtor as unknown as typeof NotificationMock & { _instances: typeof instances })._instances = instances;
  (MockCtor as unknown as { _setIsSupported: (v: boolean) => void })._setIsSupported = NotificationMock._setIsSupported;

  return {
    Notification: MockCtor,
    BrowserWindow: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Helpers to introspect the mock after hoisting
// ---------------------------------------------------------------------------

import { Notification as ElectronNotification } from 'electron';

type MockNotifExtended = ReturnType<typeof vi.fn> & {
  _instances: { on: ReturnType<typeof vi.fn>; show: ReturnType<typeof vi.fn> }[];
  _setIsSupported: (v: boolean) => void;
};

const MockNotification = ElectronNotification as unknown as MockNotifExtended;

function getNotifInstances() {
  return MockNotification._instances;
}

function setIsSupported(v: boolean) {
  MockNotification._setIsSupported(v);
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function makeSettingsDb(kvStore: Record<string, string>) {
  return {
    prepare: (sql: string) => {
      void sql;
      return {
        get: (key: string) => {
          const v = kvStore[key];
          return v !== undefined ? { v } : undefined;
        },
        run: (key: string, value: string) => {
          kvStore[key] = value;
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Window mock
// ---------------------------------------------------------------------------

function makeWin() {
  return {
    isMinimized: vi.fn().mockReturnValue(false),
    isVisible: vi.fn().mockReturnValue(true),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: { send: vi.fn() },
  };
}

// ---------------------------------------------------------------------------
// Logger mock
// ---------------------------------------------------------------------------

const logger = { info: vi.fn(), warn: vi.fn() };

// ---------------------------------------------------------------------------
// SUT
// ---------------------------------------------------------------------------

import {
  showBriefingReadyNotification,
  maybeShowFirstCloseToast,
  _resetDedupeForTests,
} from '../../../../src/main/tray/notify';
import { CHANNELS } from '../../../../src/shared/ipc-contract';

// ---------------------------------------------------------------------------
// Reset state between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Clear mock state
  MockNotification.mockClear();
  // Drain instances array
  getNotifInstances().splice(0);
  // Reset isSupported to true
  setIsSupported(true);
  // Reset dedupe Set
  _resetDedupeForTests();
  logger.info.mockClear();
  logger.warn.mockClear();
});

// ---------------------------------------------------------------------------
// showBriefingReadyNotification tests
// ---------------------------------------------------------------------------

describe('showBriefingReadyNotification', () => {
  it('fires a Notification for a new dateKey when notificationsEnabled=true', () => {
    const win = makeWin();
    showBriefingReadyNotification(
      win as never,
      { emails: 3, events: 2, news: 1 },
      '2026-05-23',
      { notificationsEnabled: true, logger: logger as never },
    );
    expect(MockNotification).toHaveBeenCalledOnce();
    expect(getNotifInstances()[0]!.show).toHaveBeenCalledOnce();
  });

  it('dedupes: second call with the same dateKey is a no-op', () => {
    const win = makeWin();
    showBriefingReadyNotification(
      win as never,
      { emails: 3, events: 2, news: 1 },
      '2026-05-23',
      { notificationsEnabled: true, logger: logger as never },
    );
    showBriefingReadyNotification(
      win as never,
      { emails: 5, events: 3, news: 2 },
      '2026-05-23',
      { notificationsEnabled: true, logger: logger as never },
    );
    expect(MockNotification).toHaveBeenCalledOnce();
  });

  it('different dateKeys each fire a Notification', () => {
    const win = makeWin();
    showBriefingReadyNotification(
      win as never,
      { emails: 3, events: 2, news: 1 },
      '2026-05-23',
      { notificationsEnabled: true, logger: logger as never },
    );
    showBriefingReadyNotification(
      win as never,
      { emails: 1, events: 1, news: 0 },
      '2026-05-24',
      { notificationsEnabled: true, logger: logger as never },
    );
    expect(MockNotification).toHaveBeenCalledTimes(2);
  });

  it('returns without constructing Notification when notificationsEnabled=false', () => {
    const win = makeWin();
    showBriefingReadyNotification(
      win as never,
      { emails: 3, events: 2, news: 1 },
      '2026-05-23',
      { notificationsEnabled: false, logger: logger as never },
    );
    expect(MockNotification).not.toHaveBeenCalled();
  });

  it('returns without constructing Notification when Notification.isSupported()=false', () => {
    setIsSupported(false);
    const win = makeWin();
    showBriefingReadyNotification(
      win as never,
      { emails: 3, events: 2, news: 1 },
      '2026-05-23',
      { notificationsEnabled: true, logger: logger as never },
    );
    expect(MockNotification).not.toHaveBeenCalled();
  });

  it('click handler: restores minimized window, shows, focuses, sends navigate channel', () => {
    const win = makeWin();
    win.isMinimized.mockReturnValue(true);
    win.isVisible.mockReturnValue(false);
    showBriefingReadyNotification(
      win as never,
      { emails: 3, events: 2, news: 1 },
      '2026-05-23',
      { notificationsEnabled: true, logger: logger as never },
    );
    const instances = getNotifInstances();
    expect(instances).toHaveLength(1);
    const notifInstance = instances[0]!;
    const clickCall = notifInstance.on.mock.calls.find(
      (c: unknown[]) => c[0] === 'click',
    );
    expect(clickCall).toBeDefined();
    const clickHandler = clickCall![1] as () => void;
    clickHandler();
    expect(win.restore).toHaveBeenCalled();
    expect(win.show).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
    expect(win.webContents.send).toHaveBeenCalledWith(CHANNELS.NAVIGATE, '/briefing');
  });

  it('click handler: does not call restore when not minimized; shows if not visible', () => {
    const win = makeWin();
    win.isMinimized.mockReturnValue(false);
    win.isVisible.mockReturnValue(false);
    showBriefingReadyNotification(
      win as never,
      { emails: 3, events: 2, news: 1 },
      '2026-05-23',
      { notificationsEnabled: true, logger: logger as never },
    );
    const clickCall = getNotifInstances()[0]!.on.mock.calls.find(
      (c: unknown[]) => c[0] === 'click',
    );
    const clickHandler = clickCall![1] as () => void;
    clickHandler();
    expect(win.restore).not.toHaveBeenCalled();
    expect(win.show).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// maybeShowFirstCloseToast tests
// ---------------------------------------------------------------------------

describe('maybeShowFirstCloseToast', () => {
  it('fires Notification and writes firstCloseToastShown=true on first call', () => {
    const kvStore: Record<string, string> = {};
    const db = makeSettingsDb(kvStore) as never;
    const win = makeWin();
    maybeShowFirstCloseToast(win as never, db, logger as never);
    expect(MockNotification).toHaveBeenCalledOnce();
    expect(getNotifInstances()[0]!.show).toHaveBeenCalled();
    expect(kvStore['backgroundActivity.firstCloseToastShown']).toBe('1');
  });

  it('does NOT fire Notification on second call (firstCloseToastShown already true)', () => {
    const kvStore: Record<string, string> = { 'backgroundActivity.firstCloseToastShown': '1' };
    const db = makeSettingsDb(kvStore) as never;
    const win = makeWin();
    maybeShowFirstCloseToast(win as never, db, logger as never);
    expect(MockNotification).not.toHaveBeenCalled();
  });

  it('BG-07: fires Notification even when notificationsEnabled=false in DB', () => {
    // The first-X toast is NOT gated on notificationsEnabled.
    // notificationsEnabled=false is stored; firstCloseToastShown is absent (false).
    const kvStore: Record<string, string> = {
      'backgroundActivity.notificationsEnabled': '0',
    };
    const db = makeSettingsDb(kvStore) as never;
    const win = makeWin();
    maybeShowFirstCloseToast(win as never, db, logger as never);
    expect(MockNotification).toHaveBeenCalledOnce();
    expect(getNotifInstances()[0]!.show).toHaveBeenCalled();
    expect(kvStore['backgroundActivity.firstCloseToastShown']).toBe('1');
  });

  it('Notification.isSupported()=false: no Notification constructed BUT flag still written', () => {
    setIsSupported(false);
    const kvStore: Record<string, string> = {};
    const db = makeSettingsDb(kvStore) as never;
    const win = makeWin();
    maybeShowFirstCloseToast(win as never, db, logger as never);
    expect(MockNotification).not.toHaveBeenCalled();
    expect(kvStore['backgroundActivity.firstCloseToastShown']).toBe('1');
  });

  it('db=null: no-op (no Notification, no DB access)', () => {
    const win = makeWin();
    maybeShowFirstCloseToast(win as never, null, logger as never);
    expect(MockNotification).not.toHaveBeenCalled();
  });
});
