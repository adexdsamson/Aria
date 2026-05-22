/**
 * Phase 12 / Plan 12-02 Task 3 — Unit smoke for the sealed-DB skip path.
 *
 * When dbHolder.db === null and a cron tick fires:
 *   - the `run` callback supplied by the caller MUST NOT be invoked
 *   - pendingCatchup.has('briefing') flips to true
 *   - trayBus.setBadge() is called
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the tray bus BEFORE importing the scheduler so the import-time
// reference resolves to our spy. Use vi.hoisted so the spies exist before
// the hoisted vi.mock factory runs.
const { setBadgeSpy, clearBadgeSpy } = vi.hoisted(() => ({
  setBadgeSpy: vi.fn(),
  clearBadgeSpy: vi.fn(),
}));
vi.mock('../../../../src/main/tray/index', () => ({
  trayBus: {
    setBadge: setBadgeSpy,
    clearBadge: clearBadgeSpy,
  },
}));

import {
  scheduleBriefing,
  _resetBriefingScheduleForTests,
} from '../../../../src/main/briefing/schedule';
import {
  pendingCatchup,
  _resetPendingCatchupForTests,
} from '../../../../src/main/lifecycle/pendingCatchup';

interface FakeTask {
  start: () => void;
  stop: () => void;
  callback: () => Promise<void> | void;
}

let lastTask: FakeTask | null = null;
function fakeSchedule(_expr: string, cb: () => Promise<void> | void): FakeTask {
  const task: FakeTask = {
    callback: cb,
    start: () => undefined,
    stop: () => undefined,
  };
  lastTask = task;
  return task;
}

describe('briefing/schedule — sealed-DB skip path', () => {
  beforeEach(() => {
    _resetBriefingScheduleForTests();
    _resetPendingCatchupForTests();
    setBadgeSpy.mockReset();
    clearBadgeSpy.mockReset();
    lastTask = null;
  });

  it('cron callback skips run() when dbHolder.db is null — registers catchup + badges tray', async () => {
    const run = vi.fn();
    const scheduler = {
      cronRegistry: new Map<string, unknown>(),
    } as never;
    const dbHolder = { db: null };
    scheduleBriefing('0 7 * * *', 'UTC', run, {
      scheduler,
      cronImpl: { schedule: fakeSchedule as never },
      dbHolder,
    });
    expect(lastTask).not.toBeNull();
    await lastTask!.callback();
    expect(run).not.toHaveBeenCalled();
    expect(pendingCatchup.has('briefing')).toBe(true);
    expect(setBadgeSpy).toHaveBeenCalledOnce();
  });

  it('cron callback runs normally when dbHolder.db is non-null', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const scheduler = { cronRegistry: new Map<string, unknown>() } as never;
    const dbHolder = { db: {} as never };
    scheduleBriefing('0 7 * * *', 'UTC', run, {
      scheduler,
      cronImpl: { schedule: fakeSchedule as never },
      dbHolder,
    });
    await lastTask!.callback();
    expect(run).toHaveBeenCalledOnce();
    expect(pendingCatchup.has('briefing')).toBe(false);
    expect(setBadgeSpy).not.toHaveBeenCalled();
  });
});
