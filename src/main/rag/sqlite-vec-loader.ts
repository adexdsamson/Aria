/**
 * Plan 07-02 Task 1 — sqlite-vec runtime load probe.
 *
 * Tries to load the sqlite-vec extension into an ALREADY-KEYED better-sqlite3
 * connection. Caller MUST have already run the SQLCipher PRAGMA key sequence
 * via `openDb()` before invoking — the extension load itself does not unlock
 * the database, it only registers the `vec0` virtual-table module.
 *
 * Pitfall 2 (RESEARCH): the native binaries live under
 * `node_modules/sqlite-vec/dist/native/**` and must be electron-builder
 * `asarUnpack`ed for packaged builds — handled in package.json `build`.
 *
 * On failure the probe NEVER rethrows; it returns a structured `{ok:false,reason}`
 * so the dual-impl VectorStore can fall back to BruteForceStore deterministically
 * and the reason string can be surfaced in RagIndexSection + tests annotations.
 */
import type Database from 'better-sqlite3-multiple-ciphers';

type Db = Database.Database;

export type LoadResult = { ok: true } | { ok: false; reason: string };

/**
 * Attempt to load sqlite-vec into the given DB. Returns a structured result.
 * Never throws.
 */
export function tryLoadSqliteVec(db: Db): LoadResult {
  try {
    // Lazy require so test envs without the native binary can still import
    // this module (the probe will return ok:false).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sqliteVec = require('sqlite-vec') as {
      load?: (db: Db) => void;
      loadable?: () => string;
    };
    if (typeof sqliteVec.load !== 'function') {
      return { ok: false, reason: 'sqlite-vec module loaded but .load() is missing' };
    }
    sqliteVec.load(db);
    // Smoke-test: try a trivial vec0 statement so binary-link failures surface here.
    db.prepare(`SELECT vec_version()`).get();
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { ok: false, reason: msg };
  }
}
