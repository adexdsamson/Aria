import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acquireSingleInstanceLock } from '../../../src/main/single-instance';

const electronMocks = vi.hoisted(() => ({
  getAllWindows: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: electronMocks.getAllWindows,
  },
}));

function makeApp(over: Partial<Parameters<typeof acquireSingleInstanceLock>[0]['app']> = {}) {
  return {
    requestSingleInstanceLock: vi.fn(() => true),
    quit: vi.fn(),
    on: vi.fn(),
    setAsDefaultProtocolClient: vi.fn(),
    ...over,
  };
}

describe('single-instance guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    electronMocks.getAllWindows.mockReset();
  });

  it('quits immediately when the lock is unavailable', () => {
    const exit = vi.fn();
    const app = makeApp({ requestSingleInstanceLock: vi.fn(() => false) });
    const ok = acquireSingleInstanceLock({ app, exit });

    expect(ok).toBe(false);
    expect(app.quit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(app.on).not.toHaveBeenCalled();
  });

  it('focuses the existing window when a second instance starts', () => {
    const restore = vi.fn();
    const focus = vi.fn();
    electronMocks.getAllWindows.mockReturnValue([
      { isMinimized: () => true, restore, focus },
    ]);
    const app = makeApp();
    const ok = acquireSingleInstanceLock({ app });

    expect(ok).toBe(true);
    expect(app.on).toHaveBeenCalledWith('second-instance', expect.any(Function));
    const secondInstance = app.on.mock.calls.find(
      (c) => c[0] === 'second-instance',
    );
    expect(secondInstance).toBeTruthy();
    const handler = secondInstance![1] as (e: unknown, argv: string[]) => void;
    handler({}, []);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(app.quit).not.toHaveBeenCalled();
  });

  it('registers aria as the default protocol client', () => {
    electronMocks.getAllWindows.mockReturnValue([]);
    const app = makeApp();
    acquireSingleInstanceLock({ app });
    expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith('aria');
  });

  it('routes aria:// URLs in second-instance argv to onAriaUrl', () => {
    electronMocks.getAllWindows.mockReturnValue([]);
    const app = makeApp();
    const onAriaUrl = vi.fn();
    acquireSingleInstanceLock({ app, onAriaUrl });
    const handler = app.on.mock.calls.find(
      (c) => c[0] === 'second-instance',
    )![1] as (e: unknown, argv: string[]) => void;
    handler({}, ['Aria.exe', '--some-flag', 'aria://activate?key=ARIA-Z']);
    expect(onAriaUrl).toHaveBeenCalledWith('aria://activate?key=ARIA-Z');
  });

  it('routes aria:// URLs from open-url (macOS) to onAriaUrl', () => {
    electronMocks.getAllWindows.mockReturnValue([]);
    const app = makeApp();
    const onAriaUrl = vi.fn();
    acquireSingleInstanceLock({ app, onAriaUrl });
    const openUrlReg = app.on.mock.calls.find((c) => c[0] === 'open-url');
    expect(openUrlReg).toBeTruthy();
    const handler = openUrlReg![1] as (
      e: { preventDefault?: () => void },
      url: string,
    ) => void;
    const prevent = vi.fn();
    handler({ preventDefault: prevent }, 'aria://activate?key=ARIA-MAC');
    expect(prevent).toHaveBeenCalled();
    expect(onAriaUrl).toHaveBeenCalledWith('aria://activate?key=ARIA-MAC');
  });

  it('ignores non-aria URLs in open-url', () => {
    electronMocks.getAllWindows.mockReturnValue([]);
    const app = makeApp();
    const onAriaUrl = vi.fn();
    acquireSingleInstanceLock({ app, onAriaUrl });
    const handler = app.on.mock.calls.find(
      (c) => c[0] === 'open-url',
    )![1] as (e: { preventDefault?: () => void }, url: string) => void;
    handler({}, 'https://other/x');
    expect(onAriaUrl).not.toHaveBeenCalled();
  });
});
