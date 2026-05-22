/**
 * Phase 12 / Plan 12-02 Task 1 — pendingCatchup unit spec.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  pendingCatchup,
  _resetPendingCatchupForTests,
  type CatchupChannel,
} from '../../../../src/main/lifecycle/pendingCatchup';

describe('pendingCatchup', () => {
  beforeEach(() => _resetPendingCatchupForTests());

  it('add is idempotent — adding the same channel twice keeps size at 1', () => {
    pendingCatchup.add('briefing');
    pendingCatchup.add('briefing');
    expect(pendingCatchup.size()).toBe(1);
    expect(pendingCatchup.has('briefing')).toBe(true);
  });

  it('has returns false for unadded channels', () => {
    expect(pendingCatchup.has('insights')).toBe(false);
  });

  it('drain returns all pending channels and empties the set', () => {
    const channels: CatchupChannel[] = ['briefing', 'insights', 'gmail-sync'];
    for (const c of channels) pendingCatchup.add(c);
    const drained = pendingCatchup.drain();
    expect(drained.sort()).toEqual(channels.slice().sort());
    expect(pendingCatchup.size()).toBe(0);
  });

  it('drain after empty returns []', () => {
    expect(pendingCatchup.drain()).toEqual([]);
  });

  it('clear empties without returning', () => {
    pendingCatchup.add('recap');
    pendingCatchup.clear();
    expect(pendingCatchup.size()).toBe(0);
  });

  it('a second add after drain re-arms the set', () => {
    pendingCatchup.add('learning');
    pendingCatchup.drain();
    pendingCatchup.add('learning');
    expect(pendingCatchup.has('learning')).toBe(true);
  });
});
