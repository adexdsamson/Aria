/**
 * Plan 08.1-02 Task 8 — Entitlement refresh cron (24h cadence).
 *
 * Mirrors `src/main/insights/schedule.ts` line-for-line per RESEARCH §pattern.
 * Singleton key in `cronRegistry`: 'entitlement-refresh'. Default expression:
 * `0 3 * * *` (03:00 local). Suspend/resume coalesced via lifecycle hooks.
 *
 * Refresh errors are caught + logged; the cron MUST NEVER throw or crash —
 * intermittent license-server failures must not take down Aria.
 */
import type { Logger } from 'pino';
import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import type { SchedulerHandle } from '../lifecycle/scheduler';
import { registerLifecycleCallbacks } from '../lifecycle/powerMonitor';
import type { EntitlementService } from './service';

const CRON_KEY = 'entitlement-refresh';
const DEFAULT_EXPR = '0 3 * * *';

let _unregisterLifecycle: (() => void) | null = null;

export interface ScheduleEntitlementDeps {
  scheduler: SchedulerHandle;
  logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
  expr?: string;
  /** Test seam — replace node-cron.schedule. */
  cronImpl?: { schedule: typeof cron.schedule };
}

/**
 * Schedule the 24h entitlement refresh. Idempotent: calling repeatedly
 * replaces (does NOT duplicate) the registered task.
 */
export function scheduleEntitlementRefresh(
  service: EntitlementService,
  deps: ScheduleEntitlementDeps,
): ScheduledTask {
  const { scheduler, logger } = deps;
  const expr = deps.expr ?? DEFAULT_EXPR;
  const cronImpl = deps.cronImpl ?? cron;

  const prior = scheduler.cronRegistry.get(CRON_KEY);
  if (prior) {
    try { prior.stop(); } catch { /* best-effort */ }
  }

  const task = cronImpl.schedule(expr, async () => {
    try {
      await service.refresh();
    } catch (err) {
      logger?.warn(
        { scope: 'entitlement', err: (err as Error).message },
        'entitlement refresh threw inside cron',
      );
    }
  });

  scheduler.cronRegistry.set(CRON_KEY, task);
  logger?.info({ scope: 'entitlement', cron: expr }, 'entitlement cron registered');

  if (_unregisterLifecycle) {
    try { _unregisterLifecycle(); } catch { /* best-effort */ }
    _unregisterLifecycle = null;
  }
  _unregisterLifecycle = registerLifecycleCallbacks({
    onSuspend: () => {
      const cur = scheduler.cronRegistry.get(CRON_KEY);
      if (cur) {
        cur.stop();
        logger?.info({ scope: 'entitlement', event: 'suspend' }, 'paused entitlement cron');
      }
    },
    onResume: () => {
      const cur = scheduler.cronRegistry.get(CRON_KEY);
      if (cur) {
        cur.start();
        logger?.info({ scope: 'entitlement', event: 'resume' }, 'resumed entitlement cron');
      }
    },
  });

  return task;
}

export function stopEntitlementRefresh(scheduler: SchedulerHandle): void {
  const task = scheduler.cronRegistry.get(CRON_KEY);
  if (task) {
    try { task.stop(); } catch { /* best-effort */ }
    scheduler.cronRegistry.delete(CRON_KEY);
  }
  if (_unregisterLifecycle) {
    try { _unregisterLifecycle(); } catch { /* best-effort */ }
    _unregisterLifecycle = null;
  }
}
