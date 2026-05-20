/**
 * Plan 08.1-02 Task 8 — entitlement schedule tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  scheduleEntitlementRefresh,
  stopEntitlementRefresh,
} from './schedule';
import type { EntitlementService } from './service';
import type { SchedulerHandle } from '../lifecycle/scheduler';

function fakeScheduler(): SchedulerHandle {
  return {
    // unused in these tests
    queue: { add: vi.fn() } as unknown as SchedulerHandle['queue'],
    cronRegistry: new Map(),
  };
}

function fakeCron() {
  type Cb = () => Promise<void> | void;
  const tasks: Array<{ stop: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; cb: Cb }> = [];
  return {
    tasks,
    schedule: vi.fn((_expr: string, cb: Cb) => {
      const t = { stop: vi.fn(), start: vi.fn(), cb };
      tasks.push(t);
      return t as unknown as ReturnType<typeof import('node-cron').schedule>;
    }),
  };
}

function fakeService(): EntitlementService {
  return { refresh: vi.fn(async () => undefined) } as unknown as EntitlementService;
}

describe('scheduleEntitlementRefresh', () => {
  let scheduler: SchedulerHandle;

  beforeEach(() => {
    scheduler = fakeScheduler();
  });

  it('registers the cron under key entitlement-refresh', () => {
    const cronImpl = fakeCron();
    scheduleEntitlementRefresh(fakeService(), { scheduler, cronImpl });
    expect(scheduler.cronRegistry.has('entitlement-refresh')).toBe(true);
  });

  it('calling twice does not create two cron entries', () => {
    const cronImpl = fakeCron();
    scheduleEntitlementRefresh(fakeService(), { scheduler, cronImpl });
    scheduleEntitlementRefresh(fakeService(), { scheduler, cronImpl });
    expect(scheduler.cronRegistry.size).toBe(1);
    // node-cron.schedule may have been called twice, but the first task was stopped first
    expect(cronImpl.tasks[0].stop).toHaveBeenCalled();
  });

  it('a tick triggers service.refresh exactly once', async () => {
    const cronImpl = fakeCron();
    const svc = fakeService();
    scheduleEntitlementRefresh(svc, { scheduler, cronImpl });
    await cronImpl.tasks[0].cb();
    expect(svc.refresh).toHaveBeenCalledTimes(1);
  });

  it('a refresh throw is caught and logged (cron does not crash)', async () => {
    const cronImpl = fakeCron();
    const svc = {
      refresh: vi.fn(async () => {
        throw new Error('refresh-fail');
      }),
    } as unknown as EntitlementService;
    const warn = vi.fn();
    scheduleEntitlementRefresh(svc, {
      scheduler,
      cronImpl,
      logger: { info: vi.fn(), warn, error: vi.fn() },
    });
    await expect(cronImpl.tasks[0].cb()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('stopEntitlementRefresh removes the registry entry', () => {
    const cronImpl = fakeCron();
    scheduleEntitlementRefresh(fakeService(), { scheduler, cronImpl });
    stopEntitlementRefresh(scheduler);
    expect(scheduler.cronRegistry.has('entitlement-refresh')).toBe(false);
  });
});
