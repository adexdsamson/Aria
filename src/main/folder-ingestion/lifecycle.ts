/**
 * Plan 10-02 Task 3 — Knowledge Folder lifecycle orchestration.
 *
 * startKnowledgeFolderLifecycle:
 *   1. Runs runBootReconciliation on app ready.
 *   2. Attaches a chokidar watcher for each active folder.
 *   3. Starts the tombstone sweep cron (03:00 daily).
 *   4. Subscribes to powerMonitor 'suspend' (close watcher + stop cron) and
 *      'resume' (re-run reconciler + re-attach watchers + restart cron).
 *
 * stopKnowledgeFolderLifecycle: idempotent shutdown for app quit.
 */
import type { Logger } from 'pino';
import type { FolderRegistry } from './folder-registry';
import type { FolderIngestionService } from './ingestion-service';
import { createFolderWatcher } from './folder-watcher';
import type { FolderWatcher } from './folder-watcher';
import { startTombstoneSweep } from './sweep-cron';
import type { SweepHandle } from './sweep-cron';
import { runBootReconciliation } from './boot-reconciler';
import { registerLifecycleCallbacks } from '../lifecycle/powerMonitor';
import type Database from 'better-sqlite3-multiple-ciphers';
import type { SchedulerHandle } from '../lifecycle/scheduler';
import type { DbHolder } from '../ipc/onboarding';

type Db = Database.Database;

export interface LifecycleDeps {
  db: Db;
  registry: FolderRegistry;
  ingestionService: FolderIngestionService;
  logger: Logger;
  /** Phase 12 / Plan 12-02 — wire scheduler so sweep-cron registers with
   *  cronRegistry (no-bare-cron-schedule ratchet) and dbHolder so the
   *  seal-guard knows when the vault is sealed. */
  scheduler?: SchedulerHandle;
  dbHolder?: Pick<DbHolder, 'db'>;
}

let currentWatcher: FolderWatcher | null = null;
let currentSweep: SweepHandle | null = null;
let unregisterPower: (() => void) | null = null;
let started = false;

async function startWatchersAndSweep(deps: LifecycleDeps): Promise<void> {
  const { db, registry, ingestionService, logger } = deps;

  // Run boot reconciliation first to catch missed events
  await runBootReconciliation({ registry, ingestionService, logger });

  // Create watcher and attach active folders
  const watcher = createFolderWatcher({ registry, ingestionService, logger });
  const activeFolders = registry.listFolders().filter((f) => f.status === 'active');
  for (const folder of activeFolders) {
    watcher.addFolder(folder.id, folder.path);
  }
  currentWatcher = watcher;

  // Start tombstone sweep cron — pass scheduler + dbHolder so the cron
  // task registers with cronRegistry AND carries the sealed-DB guard.
  currentSweep = startTombstoneSweep({
    db,
    logger,
    scheduler: deps.scheduler,
    dbHolder: deps.dbHolder,
  });

  logger.info({
    scope: 'knowledge-lifecycle',
    event: 'started',
    activeFolders: activeFolders.length,
  });
}

async function stopWatchersAndSweep(logger: Logger): Promise<void> {
  if (currentWatcher) {
    await currentWatcher.close();
    currentWatcher = null;
  }
  if (currentSweep) {
    currentSweep.stop();
    currentSweep = null;
  }
  logger.info({ scope: 'knowledge-lifecycle', event: 'stopped' });
}

export async function startKnowledgeFolderLifecycle(deps: LifecycleDeps): Promise<void> {
  if (started) return;
  started = true;

  const { logger } = deps;

  await startWatchersAndSweep(deps);

  // Register powerMonitor suspend/resume hooks
  unregisterPower = registerLifecycleCallbacks({
    onSuspend: () => {
      logger.info({ scope: 'knowledge-lifecycle', event: 'suspend' });
      void stopWatchersAndSweep(logger);
    },
    onResume: () => {
      logger.info({ scope: 'knowledge-lifecycle', event: 'resume' });
      void startWatchersAndSweep(deps);
    },
  });
}

export async function stopKnowledgeFolderLifecycle(logger: Logger): Promise<void> {
  if (!started) return;
  started = false;
  if (unregisterPower) {
    unregisterPower();
    unregisterPower = null;
  }
  await stopWatchersAndSweep(logger);
}
