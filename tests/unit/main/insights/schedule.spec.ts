/**
 * Plan 08-01 Task 6 — scheduleInsights tests. Mirrors briefing/schedule.spec.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ScheduledTask } from 'node-cron';
import type { SchedulerHandle } from '../../../../src/main/lifecycle/scheduler';
import {
  scheduleInsights,
  stopInsightsSchedule,
  _resetInsightsScheduleForTests,
} from '../../../../src/main/insights/schedule';

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
  invoke: () => Promise<void>;
}

function buildFakeCronImpl() {
  const state: {
    schedule: (expr: string, fn: () => void | Promise<void>, opts?: { timezone?: string }) => ScheduledTask;
    lastTask: FakeCronTask | null;
    lastExpr: string | null;
  } = {
    schedule: () => ({ stop: vi.fn(), start: vi.fn() } as unknown as ScheduledTask),
    lastTask: null,
    lastExpr: null,
  };
  state.schedule = (expr, fn) => {
    state.lastExpr = expr;
    const task: FakeCronTask = {
      stop: vi.fn(),
      start: vi.fn(),
      invoke: async () => { await fn(); },
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

describe('scheduleInsights', () => {
  let scheduler: SchedulerHandle;
  let cronState: ReturnType<typeof buildFakeCronImpl>;
  let runFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    _resetInsightsScheduleForTests();
    scheduler = makeScheduler();
    cronState = buildFakeCronImpl();
    runFn = vi.fn().mockResolvedValue(undefined);
    // Seed sibling registry entries.
    scheduler.cronRegistry.set('briefing', { stop: vi.fn(), start: vi.fn() } as unknown as ScheduledTask);
  });
  afterEach(() => { stopInsightsSchedule(scheduler); });

  it('registers insights-nightly; size grows by exactly 1; replace in place', () => {
    scheduleInsights('0 2 * * *', 'UTC', runFn, { scheduler, cronImpl: cronState as never });
    expect(scheduler.cronRegistry.has('insights-nightly')).toBe(true);
    expect(scheduler.cronRegistry.size).toBe(2);
    scheduleInsights('0 3 * * *', 'UTC', runFn, { scheduler, cronImpl: cronState as never });
    expect(scheduler.cronRegistry.size).toBe(2);
  });

  it('_lastFiredYmd dedupe: two same-day fires invoke run once', async () => {
    scheduleInsights('0 2 * * *', 'UTC', runFn, { scheduler, cronImpl: cronState as never });
    await cronState.lastTask!.invoke();
    await cronState.lastTask!.invoke();
    expect(runFn).toHaveBeenCalledTimes(1);
  });

  it('suspend stops the task; resume restarts WITHOUT back-firing', async () => {
    scheduleInsights('0 2 * * *', 'UTC', runFn, { scheduler, cronImpl: cronState as never });
    const pm = (await import('../../../../src/main/lifecycle/powerMonitor')) as unknown as {
      __getSuspendCbs: () => Array<() => void>;
      __getResumeCbs: () => Array<() => void>;
    };
    pm.__getSuspendCbs().forEach((cb) => cb());
    expect(cronState.lastTask!.stop).toHaveBeenCalled();
    pm.__getResumeCbs().forEach((cb) => cb());
    expect(cronState.lastTask!.start).toHaveBeenCalled();
    expect(runFn).not.toHaveBeenCalled();
  });

  it('stopInsightsSchedule removes the entry', () => {
    scheduleInsights('0 2 * * *', 'UTC', runFn, { scheduler, cronImpl: cronState as never });
    expect(scheduler.cronRegistry.has('insights-nightly')).toBe(true);
    stopInsightsSchedule(scheduler);
    expect(scheduler.cronRegistry.has('insights-nightly')).toBe(false);
  });
});
