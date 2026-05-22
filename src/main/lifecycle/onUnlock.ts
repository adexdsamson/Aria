/**
 * Phase 12 / Plan 12-02 Task 1 — onUnlock callback registry.
 *
 * Mirrors `registerLifecycleCallbacks` in `powerMonitor.ts` but for the
 * "DB unlocked" lifecycle event. Wired from `src/main/ipc/onboarding.ts`
 * immediately AFTER `holder.db = db` so callbacks observe the fresh DB
 * handle.
 *
 * Per-callback try/catch — never rethrows. A misbehaving subscriber must
 * not break the unlock flow.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type { Logger } from 'pino';

type Db = Database.Database;
type UnlockCallback = (db: Db) => void | Promise<void>;

const _callbacks: UnlockCallback[] = [];

/**
 * Register a callback to run on the next (and every subsequent) DB unlock.
 * Returns an unsubscribe function for clean teardown in tests.
 */
export function registerOnUnlock(cb: UnlockCallback): () => void {
  _callbacks.push(cb);
  return (): void => {
    const i = _callbacks.indexOf(cb);
    if (i >= 0) _callbacks.splice(i, 1);
  };
}

/**
 * Fire every registered callback in registration order. Per-callback errors
 * are caught + logged; never rethrown.
 */
export async function fireOnUnlock(
  db: Db,
  logger: Pick<Logger, 'warn'>,
): Promise<void> {
  // Snapshot to insulate against handlers that register/unregister inside
  // their own body (rare but defensible).
  const snapshot = _callbacks.slice();
  for (const cb of snapshot) {
    try {
      await cb(db);
    } catch (err) {
      logger.warn(
        { scope: 'onUnlock', err: (err as Error).message },
        'unlock callback threw',
      );
    }
  }
}

/** Test-only reset. */
export function _resetOnUnlockForTests(): void {
  _callbacks.length = 0;
}
