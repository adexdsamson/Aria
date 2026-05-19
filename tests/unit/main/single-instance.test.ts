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

describe('single-instance guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    electronMocks.getAllWindows.mockReset();
  });

  it('quits immediately when the lock is unavailable', () => {
    const quit = vi.fn();
    const exit = vi.fn();
    const on = vi.fn();
    const ok = acquireSingleInstanceLock({
      app: {
        requestSingleInstanceLock: vi.fn(() => false),
        quit,
        on,
      },
      exit,
    });

    expect(ok).toBe(false);
    expect(quit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(on).not.toHaveBeenCalled();
  });

  it('focuses the existing window when a second instance starts', () => {
    const quit = vi.fn();
    const on = vi.fn();
    const restore = vi.fn();
    const focus = vi.fn();
    electronMocks.getAllWindows.mockReturnValue([
      {
        isMinimized: () => true,
        restore,
        focus,
      },
    ]);

    const ok = acquireSingleInstanceLock({
      app: {
        requestSingleInstanceLock: vi.fn(() => true),
        quit,
        on,
      },
    });

    expect(ok).toBe(true);
    expect(on).toHaveBeenCalledWith('second-instance', expect.any(Function));
    const handler = on.mock.calls[0]?.[1] as () => void;
    handler();
    expect(restore).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(quit).not.toHaveBeenCalled();
  });
});
