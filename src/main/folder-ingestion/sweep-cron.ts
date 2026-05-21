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

type Db = Database.Database;

export interface SweepCronDeps {
  db: Db;
  logger: Logger;
  /** Override cron expression for tests. Defaults to '0 3 * * *'. */
  cron?: string;
  /** Tombstone window in hours. Defaults to 24. */
  windowHours?: number;
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
    runSweep(db, windowHours, logger);
  });

  return {
    stop() {
      task.stop();
    },
    runNow() {
      return runSweep(db, windowHours, logger);
    },
  };
}
