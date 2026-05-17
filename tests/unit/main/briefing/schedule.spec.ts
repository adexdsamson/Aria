/**
 * Plan 02-04 Task 2 — Briefing scheduler tests.
 *
 * Uses an injected `cronImpl` to capture the cron callback synchronously so we
 * can invoke it deterministically (and avoid waiting on the real clock).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ScheduledTask } from 'node-cron';
import type { SchedulerHandle } from '../../../../src/main/lifecycle/scheduler';
import {
  scheduleBriefing,
  stopBriefingSchedule,
  computeLocalYmd,
  _resetBriefingScheduleForTests,
} from '../../../../src/main/briefing/schedule';

// Stub out the powerMonitor registry so registerLifecycleCallbacks does not
// crash and we can observe its callbacks indirectly via task.stop / task.start.
vi.mock('../../../../src/main/lifecycle/powerMonitor', async () => {
  const onSuspendCbs: Array<() => void> = [];
  const onResumeCbs: Array<() => void> = [];
  return {
    registerLifecycleCallbacks(cbs: { onSuspend?: () => void; onResume?: () => void }) {
      if (cbs.onSuspend) onSuspendCbs.push(cbs.onSuspend);
      if (cbs.onResume) onResumeCbs.push(cbs.onResume);
      return () => {
        if (cbs.onSuspend) {
          const i = onSuspendCbs.indexOf(cbs.onSuspend);
          if (i >= 0) onSuspendCbs.splice(i, 1);
        }
        if (cbs.onResume) {
          const i = onResumeCbs.indexOf(cbs.onResume);
          if (i >= 0) onResumeCbs.splice(i, 1);
        }
      };
    },
    __getSuspendCbs: () => onSuspendCbs,
    __getResumeCbs: () => onResumeCbs,
  };
});

interface FakeCronTask {
  stop: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  // For tests:
  invoke: () => Promise<void>;
}

function buildFakeCronImpl(): {
  schedule: (expr: string, fn: () => void | Promise<void>, opts?: { timezone?: string }) => ScheduledTask;
  lastTask: FakeCronTask | null;
  lastExpr: string | null;
  lastTz: string | null;
} {
  const state: {
    schedule: (expr: string, fn: () => void | Promise<void>, opts?: { timezone?: string }) => ScheduledTask;
    lastTask: FakeCronTask | null;
    lastExpr: string | null;
    lastTz: string | null;
  } = {
    schedule: () => ({ stop: vi.fn(), start: vi.fn() } as unknown as ScheduledTask),
    lastTask: null,
    lastExpr: null,
    lastTz: null,
  };
  state.schedule = (expr, fn, opts) => {
    state.lastExpr = expr;
    state.lastTz = opts?.timezone ?? null;
    const task: FakeCronTask = {
      stop: vi.fn(),
      start: vi.fn(),
      invoke: async () => {
        await fn();
      },
    };
    state.lastTask = task;
    return task as unknown as ScheduledTask;
  };
  return state;
}

function makeScheduler(): SchedulerHandle {
  return {
    queue: { size: 0, pending: 0, add: vi.fn() } as unknown as SchedulerHandle['queue'],
    cronRegistry: new Map(),
  };
}

describe('scheduleBriefing', () => {
  let runFn: ReturnType<typeof vi.fn>;
  let scheduler: SchedulerHandle;
  let cronState: ReturnType<typeof buildFakeCronImpl>;

  beforeEach(() => {
    _resetBriefingScheduleForTests();
    scheduler = makeScheduler();
    runFn = vi.fn().mockResolvedValue(undefined);
    cronState = buildFakeCronImpl();
    // Seed gmail-sync + calendar-sync placeholder entries (L2 invariant).
    scheduler.cronRegistry.set('gmail-sync', { stop: vi.fn(), start: vi.fn() } as unknown as ScheduledTask);
    scheduler.cronRegistry.set('calendar-sync', { stop: vi.fn(), start: vi.fn() } as unknown as ScheduledTask);
  });

  afterEach(() => {
    stopBriefingSchedule(scheduler);
  });

  it('Case 1 — cron fires at configured time; invokes run with local YYYY-MM-DD', async () => {
    scheduleBriefing('0 7 * * *', 'UTC', runFn, {
      scheduler,
      cronImpl: cronState as never,
    });
    expect(cronState.lastExpr).toBe('0 7 * * *');
    expect(cronState.lastTz).toBe('UTC');
    await cronState.lastTask!.invoke();
    expect(runFn).toHaveBeenCalledTimes(1);
    expect(runFn.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('Case 2 — lastFiredDate guard prevents same-day double-fire', async () => {
    scheduleBriefing('0 7 * * *', 'UTC', runFn, {
      scheduler,
      cronImpl: cronState as never,
    });
    await cronState.lastTask!.invoke();
    await cronState.lastTask!.invoke();
    expect(runFn).toHaveBeenCalledTimes(1);
  });

  it('Case 3 — suspend stops the cron task', async () => {
    scheduleBriefing('0 7 * * *', 'UTC', runFn, {
      scheduler,
      cronImpl: cronState as never,
    });
    const pm = (await import('../../../../src/main/lifecycle/powerMonitor')) as unknown as {
      __getSuspendCbs: () => Array<() => void>;
    };
    const cbs = pm.__getSuspendCbs();
    cbs.forEach((cb) => cb());
    expect(cronState.lastTask!.stop).toHaveBeenCalled();
  });

  it('Case 4 — resume restarts cron WITHOUT back-firing', async () => {
    scheduleBriefing('0 7 * * *', 'UTC', runFn, {
      scheduler,
      cronImpl: cronState as never,
    });
    const pm = (await import('../../../../src/main/lifecycle/powerMonitor')) as unknown as {
      __getSuspendCbs: () => Array<() => void>;
      __getResumeCbs: () => Array<() => void>;
    };
    pm.__getSuspendCbs().forEach((cb) => cb());
    pm.__getResumeCbs().forEach((cb) => cb());
    expect(cronState.lastTask!.start).toHaveBeenCalled();
    expect(runFn).not.toHaveBeenCalled();
  });

  it('Case 5 — TZ correctness: scheduled with Africa/Lagos honors the IANA tz', () => {
    scheduleBriefing('0 7 * * *', 'Africa/Lagos', runFn, {
      scheduler,
      cronImpl: cronState as never,
    });
    expect(cronState.lastTz).toBe('Africa/Lagos');
    // computeLocalYmd shifts day boundary by Lagos offset (+01:00).
    const ymdUtcMidnight = computeLocalYmd('UTC', new Date('2026-05-20T23:00:00.000Z'));
    const ymdLagos = computeLocalYmd('Africa/Lagos', new Date('2026-05-20T23:00:00.000Z'));
    expect(ymdUtcMidnight).toBe('2026-05-20');
    expect(ymdLagos).toBe('2026-05-21');
  });

  it('Case 6 — stopBriefingSchedule removes the task and unregisters lifecycle callbacks', async () => {
    scheduleBriefing('0 7 * * *', 'UTC', runFn, {
      scheduler,
      cronImpl: cronState as never,
    });
    expect(scheduler.cronRegistry.has('briefing')).toBe(true);
    stopBriefingSchedule(scheduler);
    expect(scheduler.cronRegistry.has('briefing')).toBe(false);
    // After stop, suspend callback no longer references the (deleted) task.
    const pm = (await import('../../../../src/main/lifecycle/powerMonitor')) as unknown as {
      __getSuspendCbs: () => Array<() => void>;
    };
    // The unregister should have spliced the suspend handler off.
    expect(pm.__getSuspendCbs().length).toBe(0);
  });

  it('Case 7 — L2 cronRegistry size remains 3 across suspend/resume; run never called', async () => {
    scheduleBriefing('0 7 * * *', 'UTC', runFn, {
      scheduler,
      cronImpl: cronState as never,
    });
    expect(scheduler.cronRegistry.size).toBe(3);
    const pm = (await import('../../../../src/main/lifecycle/powerMonitor')) as unknown as {
      __getSuspendCbs: () => Array<() => void>;
      __getResumeCbs: () => Array<() => void>;
    };
    pm.__getSuspendCbs().forEach((cb) => cb());
    expect(scheduler.cronRegistry.size).toBe(3);
    pm.__getResumeCbs().forEach((cb) => cb());
    expect(scheduler.cronRegistry.size).toBe(3);
    expect(runFn).not.toHaveBeenCalled();
  });
});
