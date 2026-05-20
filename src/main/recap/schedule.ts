/**
 * Plan 08-02 Task 4 — Weekly recap scheduler (Monday 08:00 local TZ).
 *
 * Line-for-line copy of `briefing/schedule.ts` / `insights/schedule.ts`
 * (research §Pattern 1 — don't generalize prematurely). Replaces CRON_KEY,
 * dedupe variable name, and uses ISO-week-scoped dedupe (NOT YMD-scoped,
 * since cadence is weekly).
 *
 * cronRegistry key: 'recap-monday'. After this plan ships the expected
 * cronRegistry size invariant is 5 (gmail-sync + calendar-sync + briefing +
 * insights-nightly + recap-monday).
 */
import type { Logger } from 'pino';
import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import type { SchedulerHandle } from '../lifecycle/scheduler';
import { registerLifecycleCallbacks } from '../lifecycle/powerMonitor';

const CRON_KEY = 'recap-monday';

let _lastFiredIsoWeek: string | null = null;
let _unregisterLifecycle: (() => void) | null = null;

export interface ScheduleWeeklyRecapDeps {
  scheduler: SchedulerHandle;
  logger?: Pick<Logger, 'info' | 'warn'>;
  /** Test seam — replace node-cron.schedule. */
  cronImpl?: { schedule: typeof cron.schedule };
}

/**
 * Schedule the weekly recap. Idempotent — calling repeatedly with different
 * exprs swaps cleanly.
 */
export function scheduleWeeklyRecap(
  expr: string,
  tz: string,
  run: (isoWeek: string) => Promise<void> | void,
  deps: ScheduleWeeklyRecapDeps,
): ScheduledTask {
  const { scheduler, logger } = deps;
  const cronImpl = deps.cronImpl ?? cron;

  const prior = scheduler.cronRegistry.get(CRON_KEY);
  if (prior) {
    try { prior.stop(); } catch { /* best-effort */ }
  }

  const task = cronImpl.schedule(
    expr,
    async () => {
      const isoWeek = computeIsoWeek(tz, new Date());
      if (_lastFiredIsoWeek === isoWeek) {
        logger?.info(
          { scope: 'recap', event: 'cron-dedup', isoWeek },
          'recap already fired this week; skipping',
        );
        return;
      }
      _lastFiredIsoWeek = isoWeek;
      try {
        await run(isoWeek);
      } catch (err) {
        logger?.warn(
          { scope: 'recap', err: (err as Error).message },
          'recap run threw inside cron',
        );
      }
    },
    { timezone: tz } as Parameters<typeof cron.schedule>[2],
  );

  scheduler.cronRegistry.set(CRON_KEY, task);
  logger?.info({ scope: 'recap', schedule: expr, tz }, 'recap cron registered');

  if (_unregisterLifecycle) {
    try { _unregisterLifecycle(); } catch { /* best-effort */ }
    _unregisterLifecycle = null;
  }
  _unregisterLifecycle = registerLifecycleCallbacks({
    onSuspend: () => {
      const cur = scheduler.cronRegistry.get(CRON_KEY);
      if (cur) { cur.stop(); logger?.info({ scope: 'recap', event: 'suspend' }, 'paused recap cron on suspend'); }
    },
    onResume: () => {
      const cur = scheduler.cronRegistry.get(CRON_KEY);
      if (cur) { cur.start(); logger?.info({ scope: 'recap', event: 'resume' }, 'resumed recap cron on resume (no back-fire)'); }
    },
  });

  return task;
}

export function stopWeeklyRecapSchedule(scheduler: SchedulerHandle): void {
  const task = scheduler.cronRegistry.get(CRON_KEY);
  if (task) {
    try { task.stop(); } catch { /* best-effort */ }
    scheduler.cronRegistry.delete(CRON_KEY);
  }
  if (_unregisterLifecycle) {
    try { _unregisterLifecycle(); } catch { /* best-effort */ }
    _unregisterLifecycle = null;
  }
  _lastFiredIsoWeek = null;
}

/**
 * Compute the ISO-8601 week label (e.g. "2026-W20") for `now` as observed in tz.
 * Uses the ISO calendar (Mon-anchored, week containing first Thursday is week 1).
 */
export function computeIsoWeek(tz: string, now: Date): string {
  // Resolve the local Y-M-D + weekday in the user's tz, then run ISO-week
  // arithmetic against a UTC midnight of that date so DST doesn't shift us.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year')?.value ?? '1970');
  const m = Number(parts.find((p) => p.type === 'month')?.value ?? '01');
  const d = Number(parts.find((p) => p.type === 'day')?.value ?? '01');
  const localUtc = new Date(Date.UTC(y, m - 1, d));
  // ISO weekday: Mon=1..Sun=7
  const dayNr = (localUtc.getUTCDay() + 6) % 7;
  // Move to Thursday of this ISO week (always in the right ISO year).
  const thursday = new Date(localUtc);
  thursday.setUTCDate(localUtc.getUTCDate() - dayNr + 3);
  const isoYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstThuDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThuDayNr + 3);
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/** Test-only: reset module-scoped state between specs. */
export function _resetWeeklyRecapScheduleForTests(): void {
  _lastFiredIsoWeek = null;
  _unregisterLifecycle = null;
}
