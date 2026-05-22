/**
 * Plan 08-03 Task 4 — Nightly learning-preferences cron.
 *
 * Line-for-line clone of `src/main/insights/schedule.ts` / `briefing/schedule.ts`
 * (research §Pattern 1). Replaces CRON_KEY + dedupe variable.
 *
 * Default cron: 2:30am local (`30 2 * * *`) — 30 min after insights-nightly so
 * they don't contend for the same p-queue slot.
 *
 * cronRegistry singleton key: 'learning-nightly'. The cronRegistry.size
 * invariant after this plan ships is 6 (gmail-sync + calendar-sync + briefing
 * + insights-nightly + recap-monday + learning-nightly).
 *
 * The nightly callback shape (M-4 round-2 fix):
 *   await aggregatePreferences(db, { windowDays: 30 });
 *   if (readSetting(db, 'learning_signals_keep_forever') !== '1') {
 *     purgeOldSignals(db, { keepDays: 90 });
 *   }
 */
import type { Logger } from 'pino';
import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import type Database from 'better-sqlite3-multiple-ciphers';
import type { SchedulerHandle } from '../lifecycle/scheduler';
import { registerLifecycleCallbacks } from '../lifecycle/powerMonitor';
import { aggregatePreferences } from './aggregate';
import { purgeOldSignals } from './signal-log';
import { readSetting } from './prefs';
import type { DbHolder } from '../ipc/onboarding';
import { pendingCatchup } from '../lifecycle/pendingCatchup';
import { trayBus } from '../tray/index';

type Db = Database.Database;

const CRON_KEY = 'learning-nightly';

let _lastFiredYmd: string | null = null;
let _unregisterLifecycle: (() => void) | null = null;

export interface ScheduleLearningDeps {
  scheduler: SchedulerHandle;
  logger?: Pick<Logger, 'info' | 'warn'>;
  /** Test seam — replace node-cron.schedule. */
  cronImpl?: { schedule: typeof cron.schedule };
  /** Phase 12 / Plan 12-02 — seal-guard hook (BG-04). */
  dbHolder?: Pick<DbHolder, 'db'>;
}

export function scheduleLearning(
  expr: string,
  tz: string,
  run: (date: string) => Promise<void> | void,
  deps: ScheduleLearningDeps,
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
        pendingCatchup.add('learning');
        trayBus.setBadge();
        return;
      }
      const today = computeLocalYmd(tz, new Date());
      if (_lastFiredYmd === today) {
        logger?.info({ scope: 'learning', event: 'cron-dedup', date: today }, 'learning already fired today; skipping');
        return;
      }
      _lastFiredYmd = today;
      try {
        await run(today);
      } catch (err) {
        logger?.warn({ scope: 'learning', err: (err as Error).message }, 'learning run threw inside cron');
      }
    },
    { timezone: tz } as Parameters<typeof cron.schedule>[2],
  );

  scheduler.cronRegistry.set(CRON_KEY, task);
  logger?.info({ scope: 'learning', schedule: expr, tz }, 'learning cron registered');

  if (_unregisterLifecycle) {
    try { _unregisterLifecycle(); } catch { /* best-effort */ }
    _unregisterLifecycle = null;
  }
  _unregisterLifecycle = registerLifecycleCallbacks({
    onSuspend: () => {
      const cur = scheduler.cronRegistry.get(CRON_KEY);
      if (cur) { cur.stop(); logger?.info({ scope: 'learning', event: 'suspend' }, 'paused learning cron on suspend'); }
    },
    onResume: () => {
      const cur = scheduler.cronRegistry.get(CRON_KEY);
      if (cur) { cur.start(); logger?.info({ scope: 'learning', event: 'resume' }, 'resumed learning cron on resume (no back-fire)'); }
    },
  });

  return task;
}

export function stopLearningSchedule(scheduler: SchedulerHandle): void {
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

export function _resetLearningScheduleForTests(): void {
  _lastFiredYmd = null;
  _unregisterLifecycle = null;
}

/**
 * Nightly callback: aggregate preferences, then conditionally purge 90d+ old
 * signals (M-4 round-2 fix — closes the orphan purgeOldSignals export from
 * Task 2). Gated on the user's `learning_signals_keep_forever` setting.
 *
 * Default behavior (setting absent or != '1'): purge.
 */
export interface RunLearningNightlyDeps {
  /** Override window for tests. */
  windowDays?: number;
  /** Override purge keepDays for tests. */
  keepDays?: number;
  /** Test seam — replace aggregatePreferences. */
  aggregateImpl?: typeof aggregatePreferences;
  /** Test seam — replace purgeOldSignals. */
  purgeImpl?: typeof purgeOldSignals;
  logger?: Pick<Logger, 'info' | 'warn'>;
}

export async function runLearningNightly(db: Db, deps: RunLearningNightlyDeps = {}): Promise<{
  signalsCounted: number;
  purged: number;
  skippedPurge: boolean;
}> {
  const aggImpl = deps.aggregateImpl ?? aggregatePreferences;
  const purgeImpl = deps.purgeImpl ?? purgeOldSignals;
  const windowDays = deps.windowDays ?? 30;
  const keepDays = deps.keepDays ?? 90;

  const aggResult = aggImpl(db, { windowDays });
  const keepForever = readSetting(db, 'learning_signals_keep_forever') === '1';
  if (keepForever) {
    deps.logger?.info({ scope: 'learning', event: 'purge-skipped' }, 'keep_forever=1 — skipping purgeOldSignals');
    return { signalsCounted: aggResult.signalsCounted, purged: 0, skippedPurge: true };
  }
  const purged = purgeImpl(db, { keepDays });
  return { signalsCounted: aggResult.signalsCounted, purged, skippedPurge: false };
}
