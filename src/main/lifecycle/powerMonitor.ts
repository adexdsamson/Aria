/**
 * Power lifecycle hooks.
 *
 * Phase 1: only logs suspend/resume/lock/unlock events.
 *
 * Plan 02-01 extension: `registerLifecycleCallbacks({ onSuspend?, onResume? })`
 * lets downstream subsystems (Plan 02-01 gmail-sync cron, Plan 02-02 calendar
 * cron, Plan 02-04 briefing cron) register suspend/resume hooks. The existing
 * Phase-1 logger behavior is preserved; callbacks are invoked AFTER the log line.
 *
 * Returns an unregister function (splices the callbacks out).
 */
import type { Logger } from 'pino';

export type PowerEvent = 'suspend' | 'resume' | 'lock-screen' | 'unlock-screen';

const EVENTS: PowerEvent[] = ['suspend', 'resume', 'lock-screen', 'unlock-screen'];

const onSuspendCallbacks: Array<() => void> = [];
const onResumeCallbacks: Array<() => void> = [];

export interface LifecycleCallbacks {
  onSuspend?: () => void;
  onResume?: () => void;
}

/**
 * Register suspend/resume callbacks. Returns an unregister function that
 * splices the supplied callbacks out of the lifecycle arrays. Multiple calls
 * register additional callbacks (no replacement semantics).
 */
export function registerLifecycleCallbacks(cbs: LifecycleCallbacks): () => void {
  if (cbs.onSuspend) onSuspendCallbacks.push(cbs.onSuspend);
  if (cbs.onResume) onResumeCallbacks.push(cbs.onResume);
  return () => {
    if (cbs.onSuspend) {
      const i = onSuspendCallbacks.indexOf(cbs.onSuspend);
      if (i >= 0) onSuspendCallbacks.splice(i, 1);
    }
    if (cbs.onResume) {
      const i = onResumeCallbacks.indexOf(cbs.onResume);
      if (i >= 0) onResumeCallbacks.splice(i, 1);
    }
  };
}

export function registerPowerHooks(logger: Logger): void {
  // Lazy require keeps unit tests (which mock 'electron' without powerMonitor)
  // from blowing up at import time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { powerMonitor } = require('electron') as typeof import('electron');
  if (!powerMonitor || typeof powerMonitor.on !== 'function') {
    logger.warn({ scope: 'powerMonitor' }, 'powerMonitor unavailable; skipping hooks');
    return;
  }
  for (const ev of EVENTS) {
    powerMonitor.on(ev as Parameters<typeof powerMonitor.on>[0], () => {
      logger.info({ scope: 'powerMonitor', event: ev }, `power event: ${ev}`);
      // Plan 02-01: fan out to registered subsystem callbacks after the log line.
      if (ev === 'suspend') {
        for (const cb of onSuspendCallbacks) {
          try { cb(); } catch (err) {
            logger.warn({ scope: 'powerMonitor', event: ev, err: (err as Error).message }, 'suspend callback threw');
          }
        }
      } else if (ev === 'resume') {
        for (const cb of onResumeCallbacks) {
          try { cb(); } catch (err) {
            logger.warn({ scope: 'powerMonitor', event: ev, err: (err as Error).message }, 'resume callback threw');
          }
        }
      }
    });
  }
}
