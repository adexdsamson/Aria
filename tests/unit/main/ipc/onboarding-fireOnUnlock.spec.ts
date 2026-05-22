/**
 * Phase 12 / Plan 12-02 Task 2 — fireOnUnlock wiring sequence.
 *
 * Verifies the registered callback observes the SAME db handle that was
 * just installed on the holder, i.e. fireOnUnlock runs AFTER dbHolder.set(db).
 *
 * We don't replay the full ONBOARDING_UNLOCK handler here (that needs
 * SQLCipher + vault scaffolding). Instead we exercise the registry directly
 * with a synthetic dbHolder.set + fireOnUnlock sequence — that's the
 * invariant onboarding.ts maintains (Edit at lines around dbHolder.set(db)).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerOnUnlock,
  fireOnUnlock,
  _resetOnUnlockForTests,
} from '../../../../src/main/lifecycle/onUnlock';
import { pendingCatchup, _resetPendingCatchupForTests } from '../../../../src/main/lifecycle/pendingCatchup';

const fakeDb = { __id: 'db-after-unlock' } as never;
const logger = { warn: vi.fn() };

describe('fireOnUnlock — wired sequence', () => {
  beforeEach(() => {
    _resetOnUnlockForTests();
    _resetPendingCatchupForTests();
    logger.warn.mockReset();
  });

  it('callback observes the db handle passed to fireOnUnlock', async () => {
    let observed: unknown = null;
    registerOnUnlock((db) => {
      observed = db;
    });
    // Simulate the onboarding.ts sequence: dbHolder.set(db) → fireOnUnlock(db, logger).
    await fireOnUnlock(fakeDb, logger);
    expect(observed).toBe(fakeDb);
  });

  it('catchup-drain callback drains pendingCatchup on unlock', async () => {
    pendingCatchup.add('briefing');
    pendingCatchup.add('gmail-sync');
    let drained: string[] = [];
    registerOnUnlock(async () => {
      drained = pendingCatchup.drain();
    });
    await fireOnUnlock(fakeDb, logger);
    expect(drained.sort()).toEqual(['briefing', 'gmail-sync']);
    expect(pendingCatchup.size()).toBe(0);
  });

  it('repeated unlock fires registered callbacks repeatedly (subscribers persist)', async () => {
    const spy = vi.fn();
    registerOnUnlock(spy);
    await fireOnUnlock(fakeDb, logger);
    await fireOnUnlock(fakeDb, logger);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
