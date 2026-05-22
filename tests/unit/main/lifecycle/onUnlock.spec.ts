/**
 * Phase 12 / Plan 12-02 Task 1 — onUnlock callback registry unit spec.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerOnUnlock,
  fireOnUnlock,
  _resetOnUnlockForTests,
} from '../../../../src/main/lifecycle/onUnlock';

const fakeDb = {} as Parameters<Parameters<typeof registerOnUnlock>[0]>[0];
const logger = { warn: vi.fn() };

describe('onUnlock', () => {
  beforeEach(() => {
    _resetOnUnlockForTests();
    logger.warn.mockReset();
  });

  it('fires callbacks in registration order with the db handle', async () => {
    const order: number[] = [];
    registerOnUnlock((db) => {
      expect(db).toBe(fakeDb);
      order.push(1);
    });
    registerOnUnlock(() => {
      order.push(2);
    });
    registerOnUnlock(async () => {
      await Promise.resolve();
      order.push(3);
    });
    await fireOnUnlock(fakeDb, logger);
    expect(order).toEqual([1, 2, 3]);
  });

  it('a throwing callback does not break siblings; warn is logged', async () => {
    const order: string[] = [];
    registerOnUnlock(() => {
      throw new Error('boom');
    });
    registerOnUnlock(() => {
      order.push('after');
    });
    await fireOnUnlock(fakeDb, logger);
    expect(order).toEqual(['after']);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn.mock.calls[0][0]).toMatchObject({ scope: 'onUnlock' });
  });

  it('unsubscribe removes the callback', async () => {
    const spy = vi.fn();
    const off = registerOnUnlock(spy);
    off();
    await fireOnUnlock(fakeDb, logger);
    expect(spy).not.toHaveBeenCalled();
  });

  it('no callbacks → no-op', async () => {
    await expect(fireOnUnlock(fakeDb, logger)).resolves.toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
