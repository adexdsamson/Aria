/**
 * Scheduler scaffold. Phase 1 only validates that p-queue and node-cron load
 * cleanly inside Electron's main process. Phase 2 wires daily-briefing cron
 * jobs through this surface.
 */
import PQueue from 'p-queue';
import type { Logger } from 'pino';
import type { ScheduledTask } from 'node-cron';

export interface SchedulerHandle {
  queue: PQueue;
  cronRegistry: Map<string, ScheduledTask>;
}

export function registerScheduler(logger: Logger): SchedulerHandle {
  // Concurrency 1 = serialize LLM calls for rate-limit + cost predictability
  // (CLAUDE.md "Background Scheduling" guidance, RESEARCH §p-queue).
  const queue = new PQueue({ concurrency: 1 });
  const cronRegistry = new Map<string, ScheduledTask>();
  logger.info({ scope: 'scheduler' }, 'scheduler initialized (idle; Phase 2 will register jobs)');
  return { queue, cronRegistry };
}
