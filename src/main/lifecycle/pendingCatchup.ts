/**
 * Phase 12 / Plan 12-02 Task 1 — Pending-catchup channel set.
 *
 * Tracks which cron channels were skipped while the DB was sealed so
 * `fireOnUnlock` can run a single-shot catchup pass per channel (Decision 1:
 * NOT replay-all-missed-ticks, just one run per channel that had at least
 * one skipped tick).
 *
 * Module-level singleton — every cron callsite adds to the same set, the
 * onUnlock callback drains it once.
 */
export type CatchupChannel =
  | 'briefing'
  | 'insights'
  | 'recap'
  | 'learning'
  | 'entitlement'
  | 'gmail-sync'
  | 'calendar-sync'
  | 'knowledge-folder-sweep'
  | 'whatsapp-retention-sweep'
  | 'whatsapp-digest';  // Phase 21 (D-07): digest-cron.ts seal-guard catch-up channel

const _pending = new Set<CatchupChannel>();

export const pendingCatchup = {
  add(channel: CatchupChannel): void {
    _pending.add(channel);
  },
  has(channel: CatchupChannel): boolean {
    return _pending.has(channel);
  },
  size(): number {
    return _pending.size;
  },
  /**
   * Single-shot drain. Returns the channels that were pending and clears the
   * set in one atomic call so re-entry from a still-firing cron doesn't
   * double-trigger the same channel.
   */
  drain(): CatchupChannel[] {
    const out = Array.from(_pending);
    _pending.clear();
    return out;
  },
  clear(): void {
    _pending.clear();
  },
};

/** Test-only reset. */
export function _resetPendingCatchupForTests(): void {
  _pending.clear();
}
