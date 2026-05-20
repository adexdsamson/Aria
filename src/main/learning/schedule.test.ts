import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb } from '../db/connect';
import { runMigrations } from '../db/migrations/runner';
import { createTempUserDataDir } from '../../../tests/setup';
import { scheduleLearning, stopLearningSchedule, _resetLearningScheduleForTests, runLearningNightly } from './schedule';
import { writeSetting } from './prefs';

const MIGRATIONS_DIR = path.resolve(__dirname, '../db/migrations');

function freshDb() {
  const dataDir = createTempUserDataDir('aria-learn-sched');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

function makeScheduler() {
  return { cronRegistry: new Map<string, { start: () => void; stop: () => void }>() } as never;
}

function fakeCron() {
  const calls: Array<{ expr: string }> = [];
  return {
    calls,
    schedule: ((expr: string, _cb: () => void, _opts: unknown) => {
      calls.push({ expr });
      return { start: vi.fn(), stop: vi.fn() } as never;
    }) as never,
  };
}

describe('learning schedule', () => {
  beforeEach(() => {
    _resetLearningScheduleForTests();
  });

  it('Test 9: scheduleLearning registers "learning-nightly" in cronRegistry; suspend/resume invariant', () => {
    const scheduler = makeScheduler();
    const cronImpl = fakeCron();
    expect(scheduler.cronRegistry.size).toBe(0);
    scheduleLearning('30 2 * * *', 'UTC', async () => {}, { scheduler, cronImpl });
    expect(scheduler.cronRegistry.size).toBe(1);
    expect(scheduler.cronRegistry.has('learning-nightly')).toBe(true);
    // Re-call replaces in place (size still 1)
    scheduleLearning('0 3 * * *', 'UTC', async () => {}, { scheduler, cronImpl });
    expect(scheduler.cronRegistry.size).toBe(1);
    stopLearningSchedule(scheduler);
    expect(scheduler.cronRegistry.size).toBe(0);
  });

  it('Test 10 (M-4 round-2): nightly callback invokes purgeOldSignals AFTER aggregatePreferences when keep-forever != 1', async () => {
    const db = freshDb();
    const aggregateSpy = vi.fn(() => ({ preferences: {} as never, signalsCounted: 0 }));
    const purgeSpy = vi.fn(() => 0);
    const callOrder: string[] = [];
    aggregateSpy.mockImplementation(() => {
      callOrder.push('aggregate');
      return { preferences: {} as never, signalsCounted: 0 };
    });
    purgeSpy.mockImplementation(() => {
      callOrder.push('purge');
      return 0;
    });

    const r = await runLearningNightly(db, {
      aggregateImpl: aggregateSpy as never,
      purgeImpl: purgeSpy as never,
    });
    expect(aggregateSpy).toHaveBeenCalledTimes(1);
    expect(purgeSpy).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['aggregate', 'purge']);
    expect(r.skippedPurge).toBe(false);
    closeDb(db);
  });

  it('Test 11 (M-4): purgeOldSignals NOT invoked when learning_signals_keep_forever=1', async () => {
    const db = freshDb();
    writeSetting(db, 'learning_signals_keep_forever', '1');
    const aggregateSpy = vi.fn(() => ({ preferences: {} as never, signalsCounted: 0 }));
    const purgeSpy = vi.fn(() => 0);
    const r = await runLearningNightly(db, {
      aggregateImpl: aggregateSpy as never,
      purgeImpl: purgeSpy as never,
    });
    expect(aggregateSpy).toHaveBeenCalledTimes(1);
    expect(purgeSpy).not.toHaveBeenCalled();
    expect(r.skippedPurge).toBe(true);
    closeDb(db);
  });
});
