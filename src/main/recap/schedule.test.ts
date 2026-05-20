/**
 * Plan 08-02 Task 4 — recap scheduler tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ScheduledTask } from 'node-cron';
import { scheduleWeeklyRecap, stopWeeklyRecapSchedule, computeIsoWeek, _resetWeeklyRecapScheduleForTests } from './schedule';

interface FakeTask extends ScheduledTask {
  _running: boolean;
  _fire: () => Promise<void>;
}

function makeFakeCronImpl() {
  const tasks: FakeTask[] = [];
  let lastCb: (() => Promise<void>) | null = null;
  const schedule = ((_expr: string, cb: () => Promise<void>) => {
    lastCb = cb;
    const task: FakeTask = {
      _running: true,
      start: () => { task._running = true; },
      stop: () => { task._running = false; },
      _fire: async () => { if (task._running) await cb(); },
    } as unknown as FakeTask;
    tasks.push(task);
    return task as unknown as ScheduledTask;
  }) as unknown as typeof import('node-cron').schedule;
  return { schedule, tasks, getLastCb: () => lastCb };
}

function makeSchedulerHandle() {
  return {
    queue: undefined as never,
    cronRegistry: new Map<string, ScheduledTask>(),
  };
}

describe('scheduleWeeklyRecap', () => {
  beforeEach(() => { _resetWeeklyRecapScheduleForTests(); });
  afterEach(() => { _resetWeeklyRecapScheduleForTests(); });

  it('Test 1: registers recap-monday in cronRegistry', () => {
    const sched = makeSchedulerHandle();
    const fake = makeFakeCronImpl();
    scheduleWeeklyRecap('0 8 * * 1', 'UTC', async () => undefined, {
      scheduler: sched as never,
      cronImpl: fake,
    });
    expect(sched.cronRegistry.has('recap-monday')).toBe(true);
    expect(sched.cronRegistry.size).toBe(1);
  });

  it('Test 2: _lastFiredIsoWeek dedupe — two fires same week run once', async () => {
    const sched = makeSchedulerHandle();
    const fake = makeFakeCronImpl();
    let runs = 0;
    scheduleWeeklyRecap('0 8 * * 1', 'UTC', async () => { runs++; }, {
      scheduler: sched as never,
      cronImpl: fake,
    });
    await fake.getLastCb()!();
    await fake.getLastCb()!();
    expect(runs).toBe(1);
  });

  it('Test 5: stopWeeklyRecapSchedule removes the entry', () => {
    const sched = makeSchedulerHandle();
    const fake = makeFakeCronImpl();
    scheduleWeeklyRecap('0 8 * * 1', 'UTC', async () => undefined, {
      scheduler: sched as never,
      cronImpl: fake,
    });
    stopWeeklyRecapSchedule(sched as never);
    expect(sched.cronRegistry.has('recap-monday')).toBe(false);
  });
});

describe('computeIsoWeek', () => {
  it('returns an ISO-week-style label', () => {
    const out = computeIsoWeek('UTC', new Date('2026-05-12T10:00:00Z')); // Tuesday of week 20
    expect(out).toBe('2026-W20');
  });

  it('week-boundary handling — Monday vs Sunday in same ISO week', () => {
    const mon = computeIsoWeek('UTC', new Date('2026-05-11T01:00:00Z'));
    const sun = computeIsoWeek('UTC', new Date('2026-05-17T23:00:00Z'));
    expect(mon).toBe(sun);
  });
});
