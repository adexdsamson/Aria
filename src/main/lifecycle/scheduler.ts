/**
 * Scheduler scaffold. Phase 1 only validates that p-queue and node-cron load
 * cleanly inside Electron's main process. Phase 2 wires daily-briefing cron
 * jobs through this surface.
 */
import PQueueImport from 'p-queue';
import type { Logger } from 'pino';
import type { ScheduledTask } from 'node-cron';

// p-queue v9 is ESM-only; when bundled to CJS by electron-vite, the default
// export lands on `.default`. Normalize at module load.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PQueue: typeof PQueueImport = ((PQueueImport as any).default ?? PQueueImport) as typeof PQueueImport;

export interface SchedulerHandle {
  queue: InstanceType<typeof PQueueImport>;
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
