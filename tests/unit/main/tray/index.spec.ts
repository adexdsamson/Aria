/**
 * Phase 12 / Plan 12-02 Task 1 — createTray + trayBus unit spec.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface FakeTray {
  setToolTip: ReturnType<typeof vi.fn>;
  setContextMenu: ReturnType<typeof vi.fn>;
  setImage: ReturnType<typeof vi.fn>;
  popUpContextMenu: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  __handlers: Record<string, Function>;
}

let lastTray: FakeTray | null = null;

vi.mock('electron', () => {
  class Tray {
    setToolTip = vi.fn();
    setContextMenu = vi.fn();
    setImage = vi.fn();
    popUpContextMenu = vi.fn();
    destroy = vi.fn();
    __handlers: Record<string, Function> = {};
    on = vi.fn((event: string, cb: Function) => {
      this.__handlers[event] = cb;
      return this;
    });
    constructor(_img: unknown) {
      lastTray = this as unknown as FakeTray;
    }
  }
  return {
    Tray,
    Menu: { buildFromTemplate: (t: any) => ({ __t: t }) },
    nativeImage: { createFromPath: (p: string) => ({ __path: p }) },
    app: { isPackaged: false },
  };
});

import {
  createTray,
  trayBus,
  _resetTrayForTests,
  _hasTrayForTests,
} from '../../../../src/main/tray/index';
import type { TrayDeps } from '../../../../src/main/tray/index';
import type { DbHolder } from '../../../../src/main/ipc/onboarding';

function makeDeps(platform: NodeJS.Platform): TrayDeps {
  const dbHolder = {
    db: {} as never,
    isOpen: true,
    set: () => undefined,
    close: () => undefined,
  } as DbHolder;
  const winShow = vi.fn();
  const win = {
    isMinimized: () => false,
    restore: () => undefined,
    show: winShow,
    focus: () => undefined,
  } as unknown as Electron.BrowserWindow;
  return {
    getMainWindow: () => win,
    dbHolder,
    connected: { gmail: true, calendar: true, todoist: true },
    invokeChannel: vi.fn(),
    navigate: vi.fn(),
    beginQuit: vi.fn(),
    quit: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn() },
    platform,
  };
}

describe('createTray', () => {
  beforeEach(() => {
    _resetTrayForTests();
    lastTray = null;
  });

  it('Windows click handler shows the main window', () => {
    const deps = makeDeps('win32');
    createTray(deps);
    expect(lastTray).not.toBeNull();
    const handler = lastTray!.__handlers['click'];
    expect(typeof handler).toBe('function');
    handler();
    // getMainWindow returns the same win each call; show was called.
    const win = deps.getMainWindow() as unknown as { show: ReturnType<typeof vi.fn> };
    expect(win.show).toHaveBeenCalled();
  });

  it('macOS click handler pops up the context menu', () => {
    const deps = makeDeps('darwin');
    createTray(deps);
    const handler = lastTray!.__handlers['click'];
    handler();
    expect(lastTray!.popUpContextMenu).toHaveBeenCalledOnce();
  });

  it('setBadge swaps the image to the badged variant', () => {
    const deps = makeDeps('win32');
    const tray = createTray(deps);
    tray.setBadge();
    expect(lastTray!.setImage).toHaveBeenCalledTimes(1);
    const arg = lastTray!.setImage.mock.calls[0][0] as { __path: string };
    expect(arg.__path).toMatch(/tray-icon-badged\.ico$/);
  });

  it('clearBadge swaps the image back to plain', () => {
    const deps = makeDeps('win32');
    const tray = createTray(deps);
    tray.clearBadge();
    const arg = lastTray!.setImage.mock.calls.at(-1)![0] as { __path: string };
    expect(arg.__path).toMatch(/tray-icon\.ico$/);
  });

  it('dispose destroys the tray and resets trayBus to no-ops', () => {
    const deps = makeDeps('win32');
    const tray = createTray(deps);
    expect(_hasTrayForTests()).toBe(true);
    tray.dispose();
    expect(lastTray!.destroy).toHaveBeenCalled();
    expect(_hasTrayForTests()).toBe(false);
    // After dispose, trayBus.setBadge is a no-op and does NOT call setImage.
    const callCountBefore = lastTray!.setImage.mock.calls.length;
    trayBus.setBadge();
    expect(lastTray!.setImage.mock.calls.length).toBe(callCountBefore);
  });

  it('rebuildMenu reinvokes setContextMenu', () => {
    const deps = makeDeps('win32');
    const tray = createTray(deps);
    const before = lastTray!.setContextMenu.mock.calls.length;
    tray.rebuildMenu();
    expect(lastTray!.setContextMenu.mock.calls.length).toBe(before + 1);
  });

  it('trayBus.setBadge BEFORE createTray is a safe no-op (T-12-06 mitigation)', () => {
    // Module is fresh after _resetTrayForTests. trayBus exports the defaults.
    expect(() => trayBus.setBadge()).not.toThrow();
    expect(() => trayBus.clearBadge()).not.toThrow();
  });
});
