/**
 * Plan 10-02 Task 3 — Tombstone sweep cron.
 *
 * Daily at 03:00 (local time) deletes knowledge_files rows that have been
 * tombstoned for more than 24 hours. FK ON DELETE CASCADE on rag_chunk.file_id
 * removes the associated chunk rows automatically.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type { Logger } from 'pino';
import nodeCron, { type ScheduledTask } from 'node-cron';
import type { SchedulerHandle } from '../lifecycle/scheduler';
import type { DbHolder } from '../ipc/onboarding';
import { pendingCatchup } from '../lifecycle/pendingCatchup';
import { trayBus } from '../tray/index';

type Db = Database.Database;

const CRON_KEY = 'knowledge-folder-sweep';

export interface SweepCronDeps {
  db: Db;
  logger: Logger;
  /** Override cron expression for tests. Defaults to '0 3 * * *'. */
  cron?: string;
  /** Tombstone window in hours. Defaults to 24. */
  windowHours?: number;
  /**
   * Phase 12 / Plan 12-02 — register the cron task with scheduler.cronRegistry
   * so it goes through the same lifecycle (no-bare-cron-schedule ratchet).
   * Optional for backwards compatibility with tests that construct without
   * a scheduler handle.
   */
  scheduler?: SchedulerHandle;
  /** Phase 12 / Plan 12-02 — seal-guard hook (BG-04). */
  dbHolder?: Pick<DbHolder, 'db'>;
}

export interface SweepHandle {
  stop(): void;
  /** Run the sweep immediately (useful for tests). */
  runNow(): number;
}

/**
 * Run one sweep and return the number of deleted knowledge_files rows.
 */
function runSweep(db: Db, windowHours: number, logger: Logger): number {
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const stmt = db.prepare(
    `DELETE FROM knowledge_files WHERE status='tombstoned' AND tombstoned_at < ?`,
  );
  const result = stmt.run(cutoff);
  logger.info({
    scope: 'sweep-cron',
    event: 'sweep',
    deleted: result.changes,
    cutoff,
  });
  return result.changes;
}

export function startTombstoneSweep(deps: SweepCronDeps): SweepHandle {
  const { db, logger } = deps;
  const cronExpr = deps.cron ?? '0 3 * * *';
  const windowHours = deps.windowHours ?? 24;

  const task: ScheduledTask = nodeCron.schedule(cronExpr, () => {
    // Phase 12 / Plan 12-02 — sealed-DB guard (BG-04). The startKnowledge-
    // FolderLifecycle path only runs post-unlock, but if the user re-locks
    // between starts the sweep would still tick. Guard with dbHolder.db.
    const dbRef = deps.dbHolder?.db;
    if (deps.dbHolder && !dbRef) {
      pendingCatchup.add('knowledge-folder-sweep');
      trayBus.setBadge();
      return;
    }
    runSweep(db, windowHours, logger);
  });

  // Register with scheduler.cronRegistry so the no-bare-cron-schedule ratchet
  // passes and powerMonitor suspend/resume can find it.
  if (deps.scheduler) {
    deps.scheduler.cronRegistry.set(CRON_KEY, task);
  }

  return {
    stop() {
      task.stop();
      if (deps.scheduler) deps.scheduler.cronRegistry.delete(CRON_KEY);
    },
    runNow() {
      return runSweep(db, windowHours, logger);
    },
  };
}
