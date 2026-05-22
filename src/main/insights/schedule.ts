/**
 * Plan 08-01 Task 6 — Insights nightly scheduler.
 *
 * Mirrors `src/main/briefing/schedule.ts` line-for-line (research §Pattern 1:
 * "Copy it line-for-line; don't generalize prematurely"). Replaces CRON_KEY,
 * exports, and module-scoped dedupe variable.
 *
 * Default cron: 2am local (`0 2 * * *`). Suspend/resume coalescing per
 * Phase 1 XCUT-01 pattern.
 *
 * cronRegistry singleton key: 'insights-nightly'. The L2 invariant after this
 * plan ships is `cronRegistry.size === 4` (gmail-sync + calendar-sync +
 * briefing + insights-nightly).
 */
import type { Logger } from 'pino';
import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import type { SchedulerHandle } from '../lifecycle/scheduler';
import { registerLifecycleCallbacks } from '../lifecycle/powerMonitor';
import type { DbHolder } from '../ipc/onboarding';
import { pendingCatchup } from '../lifecycle/pendingCatchup';
import { trayBus } from '../tray/index';

const CRON_KEY = 'insights-nightly';

let _lastFiredYmd: string | null = null;
let _unregisterLifecycle: (() => void) | null = null;

export interface ScheduleInsightsDeps {
  scheduler: SchedulerHandle;
  logger?: Pick<Logger, 'info' | 'warn'>;
  /** Test seam — replace node-cron.schedule. */
  cronImpl?: { schedule: typeof cron.schedule };
  /** Phase 12 / Plan 12-02 — seal-guard hook (BG-04). */
  dbHolder?: Pick<DbHolder, 'db'>;
}

/**
 * Schedule the nightly insights aggregator. Idempotent — calling repeatedly
 * with different exprs swaps cleanly.
 */
export function scheduleInsights(
  expr: string,
  tz: string,
  run: (date: string) => Promise<void> | void,
  deps: ScheduleInsightsDeps,
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
      // Phase 12 / Plan 12-02 — sealed-DB guard (BG-04).
      const db = deps.dbHolder?.db;
      if (deps.dbHolder && !db) {
        pendingCatchup.add('insights');
        trayBus.setBadge();
        return;
      }
      const today = computeLocalYmd(tz, new Date());
      if (_lastFiredYmd === today) {
        logger?.info(
          { scope: 'insights', event: 'cron-dedup', date: today },
          'insights already fired today; skipping',
        );
        return;
      }
      _lastFiredYmd = today;
      try {
        await run(today);
      } catch (err) {
        logger?.warn(
          { scope: 'insights', err: (err as Error).message },
          'insights run threw inside cron',
        );
      }
    },
    { timezone: tz } as Parameters<typeof cron.schedule>[2],
  );

  scheduler.cronRegistry.set(CRON_KEY, task);
  logger?.info({ scope: 'insights', schedule: expr, tz }, 'insights cron registered');

  if (_unregisterLifecycle) {
    try { _unregisterLifecycle(); } catch { /* best-effort */ }
    _unregisterLifecycle = null;
  }
  _unregisterLifecycle = registerLifecycleCallbacks({
    onSuspend: () => {
      const cur = scheduler.cronRegistry.get(CRON_KEY);
      if (cur) {
        cur.stop();
        logger?.info({ scope: 'insights', event: 'suspend' }, 'paused insights cron on suspend');
      }
    },
    onResume: () => {
      const cur = scheduler.cronRegistry.get(CRON_KEY);
      if (cur) {
        cur.start();
        logger?.info({ scope: 'insights', event: 'resume' }, 'resumed insights cron on resume (no back-fire)');
      }
    },
  });

  return task;
}

/** Stop and DELETE the insights-nightly entry. Use on app shutdown only. */
export function stopInsightsSchedule(scheduler: SchedulerHandle): void {
  const task = scheduler.cronRegistry.get(CRON_KEY);
  if (task) {
    try { task.stop(); } catch { /* best-effort */ }
    scheduler.cronRegistry.delete(CRON_KEY);
  }
  if (_unregisterLifecycle) {
    try { _unregisterLifecycle(); } catch { /* best-effort */ }
    _unregisterLifecycle = null;
  }
  _lastFiredYmd = null;
}

function computeLocalYmd(tz: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Test-only: reset module-scoped state between specs. */
export function _resetInsightsScheduleForTests(): void {
  _lastFiredYmd = null;
  _unregisterLifecycle = null;
}
