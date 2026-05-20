/**
 * Plan 08-04 Task 5 — updater unit tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  startAutoUpdater,
  getUpdaterChannel,
  _resetAutoUpdaterForTests,
  type AutoUpdaterShape,
} from './updater';

function makeFakeUpdater(): AutoUpdaterShape & {
  __listeners: Map<string, Array<(...args: unknown[]) => void>>;
  emit: (event: string, payload: unknown) => void;
} {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const u = {
    logger: null,
    channel: '',
    autoDownload: true,
    autoInstallOnAppQuit: false,
    checkForUpdates: vi.fn(async () => ({ version: '1.0.1' })),
    downloadUpdate: vi.fn(async () => ({ ok: true })),
    quitAndInstall: vi.fn(() => undefined),
    on(event: string, listener: (...args: unknown[]) => void) {
      const arr = listeners.get(event) ?? [];
      arr.push(listener);
      listeners.set(event, arr);
    },
    __listeners: listeners,
    emit(event: string, payload: unknown) {
      const arr = listeners.get(event) ?? [];
      for (const l of arr) l(payload);
    },
  } as ReturnType<typeof makeFakeUpdater>;
  return u;
}

function makeFakeWindow(): {
  webContents: { send: ReturnType<typeof vi.fn> };
} {
  return { webContents: { send: vi.fn() } };
}

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child() {
    return fakeLogger;
  },
  level: 'info',
} as never;

describe('startAutoUpdater', () => {
  beforeEach(() => _resetAutoUpdaterForTests());

  it('Test 1 — installs a pino-shim logger', async () => {
    const u = makeFakeUpdater();
    const w = makeFakeWindow();
    await startAutoUpdater({
      logger: fakeLogger,
      window: w as never,
      autoUpdaterOverride: u,
    });
    expect(u.logger).not.toBeNull();
    const shim = u.logger as {
      info: (msg: string) => void;
    };
    expect(typeof shim.info).toBe('function');
  });

  it('Test 2 — sets autoDownload=false, autoInstallOnAppQuit=true', async () => {
    const u = makeFakeUpdater();
    await startAutoUpdater({
      logger: fakeLogger,
      window: makeFakeWindow() as never,
      autoUpdaterOverride: u,
    });
    expect(u.autoDownload).toBe(false);
    expect(u.autoInstallOnAppQuit).toBe(true);
  });

  it('Test 3 — channel defaults to ARIA_UPDATE_CHANNEL ?? tester', async () => {
    delete process.env['ARIA_UPDATE_CHANNEL'];
    const u = makeFakeUpdater();
    await startAutoUpdater({
      logger: fakeLogger,
      window: makeFakeWindow() as never,
      autoUpdaterOverride: u,
    });
    expect(u.channel).toBe('tester');
    expect(getUpdaterChannel()).toBe('tester');
  });

  it('Test 3b — channel honors env var', async () => {
    process.env['ARIA_UPDATE_CHANNEL'] = 'beta';
    _resetAutoUpdaterForTests();
    const u = makeFakeUpdater();
    await startAutoUpdater({
      logger: fakeLogger,
      window: makeFakeWindow() as never,
      autoUpdaterOverride: u,
    });
    expect(u.channel).toBe('beta');
    delete process.env['ARIA_UPDATE_CHANNEL'];
  });

  it('Test 4 — update-available / progress / downloaded events forwarded to renderer', async () => {
    const u = makeFakeUpdater();
    const w = makeFakeWindow();
    await startAutoUpdater({
      logger: fakeLogger,
      window: w as never,
      autoUpdaterOverride: u,
    });
    u.emit('update-available', { version: '1.0.1' });
    u.emit('download-progress', { percent: 42 });
    u.emit('update-downloaded', { version: '1.0.1' });
    const sent = w.webContents.send.mock.calls.map((c) => (c as unknown[])[0]);
    expect(sent).toContain('updater:available');
    expect(sent).toContain('updater:progress');
    expect(sent).toContain('updater:downloaded');
  });

  it('Test 11 — updater error does NOT throw; renderer notified', async () => {
    const u = makeFakeUpdater();
    const w = makeFakeWindow();
    await startAutoUpdater({
      logger: fakeLogger,
      window: w as never,
      autoUpdaterOverride: u,
    });
    expect(() => u.emit('error', new Error('boom'))).not.toThrow();
    const sent = w.webContents.send.mock.calls.map((c) => (c as unknown[])[0]);
    expect(sent).toContain('updater:error');
  });

  it('is idempotent — second startAutoUpdater returns the same instance', async () => {
    const u = makeFakeUpdater();
    const a = await startAutoUpdater({
      logger: fakeLogger,
      window: makeFakeWindow() as never,
      autoUpdaterOverride: u,
    });
    const b = await startAutoUpdater({
      logger: fakeLogger,
      window: makeFakeWindow() as never,
      autoUpdaterOverride: makeFakeUpdater(),
    });
    expect(a).toBe(b);
  });
});
