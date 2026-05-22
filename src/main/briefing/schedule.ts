/**
 * Plan 02-04 Task 2 — Briefing scheduler.
 *
 * `scheduleBriefing(expr, tz, run)` registers (or replaces) the singleton
 * `briefing` entry in scheduler.cronRegistry. The cron callback computes the
 * user's local YYYY-MM-DD via Intl in `tz` and dedupes against `lastFiredDate`
 * so a single day cannot trigger more than one briefing — even if the OS
 * fires the cron callback twice (clock jumps on suspend/resume etc).
 *
 * Suspend/resume coalescing (XCUT-01): we register lifecycle callbacks that
 * STOP the task on suspend and START it on resume. NodeCron's `task.start()`
 * does NOT back-fire missed intervals — it just resumes future ticks. Combined
 * with the lastFiredDate guard, missed briefings are not auto-fired on wake;
 * the renderer's GenerateNowAffordance owns the "generate now" path instead.
 *
 * L2 invariant: scheduler.cronRegistry.size remains 3 (`gmail-sync` from
 * 02-01 + `calendar-sync` from 02-02 + `briefing` from this plan) across
 * suspend/resume cycles; we never .delete() the entry from the registry on
 * suspend, only call task.stop().
 */
import type { Logger } from 'pino';
import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import type { SchedulerHandle } from '../lifecycle/scheduler';
import { registerLifecycleCallbacks } from '../lifecycle/powerMonitor';
import type { DbHolder } from '../ipc/onboarding';
import { pendingCatchup } from '../lifecycle/pendingCatchup';
import { trayBus } from '../tray/index';

const CRON_KEY = 'briefing';

let _lastFiredDate: string | null = null;
let _unregisterLifecycle: (() => void) | null = null;

export interface ScheduleBriefingDeps {
  scheduler: SchedulerHandle;
  logger?: Pick<Logger, 'info' | 'warn'>;
  /** Test seam — replace node-cron.schedule (default is the real cron). */
  cronImpl?: { schedule: typeof cron.schedule };
  /**
   * Phase 12 / Plan 12-02 — seal-guard hook. When provided, the cron
   * callback inspects dbHolder.db and silently skips (registering a
   * catchup ticket + tray badge) when the DB is sealed.
   */
  dbHolder?: Pick<DbHolder, 'db'>;
}

/**
 * Schedule the daily briefing. Replaces any prior `briefing` task in the
 * shared cronRegistry. Idempotent — calling repeatedly with different exprs
 * swaps the schedule cleanly (no leaked tasks, no duplicate suspend handlers).
 */
export function scheduleBriefing(
  expr: string,
  tz: string,
  run: (date: string) => Promise<void> | void,
  deps: ScheduleBriefingDeps,
): ScheduledTask {
  const { scheduler, logger } = deps;
  const cronImpl = deps.cronImpl ?? cron;

  // Stop any prior briefing task — does NOT remove the key (kept in registry
  // so cronRegistry.size stays at 3 across reschedules; the entry is replaced
  // in-place below).
  const prior = scheduler.cronRegistry.get(CRON_KEY);
  if (prior) {
    try {
      prior.stop();
    } catch {
      /* best-effort */
    }
  }

  const task = cronImpl.schedule(
    expr,
    async () => {
      // Phase 12 / Plan 12-02 — sealed-DB guard (BG-04). Runs BEFORE any
      // DB access. Silent-skip + register catchup ticket + tray badge.
      const db = deps.dbHolder?.db;
      if (deps.dbHolder && !db) {
        pendingCatchup.add('briefing');
        trayBus.setBadge();
        return;
      }
      const today = computeLocalYmd(tz, new Date());
      if (_lastFiredDate === today) {
        logger?.info(
          { scope: 'briefing', event: 'cron-dedup', date: today },
          'briefing already fired today; skipping',
        );
        return;
      }
      _lastFiredDate = today;
      try {
        await run(today);
      } catch (err) {
        logger?.warn(
          { scope: 'briefing', err: (err as Error).message },
          'briefing run threw inside cron',
        );
      }
    },
    { timezone: tz } as Parameters<typeof cron.schedule>[2],
  );

  scheduler.cronRegistry.set(CRON_KEY, task);
  logger?.info(
    { scope: 'briefing', schedule: expr, tz },
    'briefing cron registered',
  );

  // Replace any prior lifecycle registration so we don't leak handlers across
  // re-schedules.
  if (_unregisterLifecycle) {
    try {
      _unregisterLifecycle();
    } catch {
      /* best-effort */
    }
    _unregisterLifecycle = null;
  }
  _unregisterLifecycle = registerLifecycleCallbacks({
    onSuspend: () => {
      const cur = scheduler.cronRegistry.get(CRON_KEY);
      if (cur) {
        cur.stop();
        logger?.info(
          { scope: 'briefing', event: 'suspend' },
          'paused briefing cron on suspend',
        );
      }
    },
    onResume: () => {
      const cur = scheduler.cronRegistry.get(CRON_KEY);
      if (cur) {
        cur.start();
        logger?.info(
          { scope: 'briefing', event: 'resume' },
          'resumed briefing cron on resume (no back-fire)',
        );
      }
    },
  });

  return task;
}

/**
 * Stop and DELETE the briefing entry. Use on app shutdown only — re-registering
 * via scheduleBriefing afterwards still leaves the registry at the expected
 * size for the active subsystems.
 */
export function stopBriefingSchedule(scheduler: SchedulerHandle): void {
  const task = scheduler.cronRegistry.get(CRON_KEY);
  if (task) {
    try {
      task.stop();
    } catch {
      /* best-effort */
    }
    scheduler.cronRegistry.delete(CRON_KEY);
  }
  if (_unregisterLifecycle) {
    try {
      _unregisterLifecycle();
    } catch {
      /* best-effort */
    }
    _unregisterLifecycle = null;
  }
  _lastFiredDate = null;
}

/**
 * Compute the YYYY-MM-DD of `now` as observed in `tz`. Uses Intl.DateTimeFormat
 * with the 'en-CA' locale which renders YYYY-MM-DD natively.
 */
export function computeLocalYmd(tz: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Test-only: reset module-scoped lastFiredDate between specs. */
export function _resetBriefingScheduleForTests(): void {
  _lastFiredDate = null;
  _unregisterLifecycle = null;
}
