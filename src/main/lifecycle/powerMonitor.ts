/**
 * Power lifecycle hooks. Phase 1 only logs events; Phase 2 cron coalescing
 * binds to this same surface (suspend → pause cron; resume → fire missed jobs).
 */
import type { Logger } from 'pino';

export type PowerEvent = 'suspend' | 'resume' | 'lock-screen' | 'unlock-screen';

const EVENTS: PowerEvent[] = ['suspend', 'resume', 'lock-screen', 'unlock-screen'];

export function registerPowerHooks(logger: Logger): void {
  // Lazy require keeps unit tests (which mock 'electron' without powerMonitor)
  // from blowing up at import time.
  const { powerMonitor } = require('electron') as typeof import('electron');
  if (!powerMonitor || typeof powerMonitor.on !== 'function') {
    logger.warn({ scope: 'powerMonitor' }, 'powerMonitor unavailable; skipping hooks');
    return;
  }
  for (const ev of EVENTS) {
    powerMonitor.on(ev as Parameters<typeof powerMonitor.on>[0], () => {
      logger.info({ scope: 'powerMonitor', event: ev }, `power event: ${ev}`);
    });
  }
}
