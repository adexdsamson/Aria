/**
 * Phase 12 / Plan 12-01 — Background-activity preferences.
 *
 * Source-of-truth pref layer for close-to-tray, auto-launch, and notification
 * gating. Stored in the existing `settings(k, v)` KV table from migration 001
 * (no new migration per CONTEXT.md 2026-05-22 ADDENDUM — `user_prefs` does
 * not exist and `learned_preferences` is the wrong shape).
 *
 * Boolean values serialised as '1' / '0' per the briefing.ts precedent.
 *
 * OS-mirror rules for `app.setLoginItemSettings` (Electron 41):
 *   - win32: pass `{ openAtLogin, args: ['--was-auto-launched'] }`. The args
 *     flag is how the main process detects an autolaunch boot vs. a manual
 *     launch (used by future 12-02 work).
 *   - darwin: pass `{ openAtLogin }` ONLY. `openAsHidden` is deprecated /
 *     no-op on macOS 13+ (RESEARCH §3, D-06 ADDENDUM). Phase 12 dock policy
 *     (D-05) keeps the dock visible so the macOS auto-launched window comes
 *     up normally — consistent with Slack/Notion/Linear chief-of-staff apps.
 *
 * The bans ratchet (tests/static/phase12-bans.spec.ts) enforces that
 * `openAsHidden` and `app.dock.hide` never appear under src/main or src/preload.
 */
import { app } from 'electron';
import type { Database as BSqlite3 } from 'better-sqlite3';
import type { Logger } from 'pino';

type Db = BSqlite3;

/** Keys are prefixed `backgroundActivity.` so they cohabit cleanly with the
 *  existing settings rows (briefing.time, briefing.tz, etc.). */
const KEY_PREFIX = 'backgroundActivity.';

export type BgPrefKey =
  | 'autoLaunch'
  | 'closeToTray'
  | 'notificationsEnabled'
  | 'firstCloseToastShown';

export interface BackgroundPrefs {
  autoLaunch: boolean;
  closeToTray: boolean;
  notificationsEnabled: boolean;
  firstCloseToastShown: boolean;
}

/** Conservative defaults — D-02 / D-04 (CONTEXT.md). The `closeToTray=true`
 *  default means a pre-unlock X-click hides the window (conservative: no data
 *  leak, user can re-show after unlock once 12-02 ships the tray icon). */
export const BG_PREF_DEFAULTS: BackgroundPrefs = {
  autoLaunch: false,
  closeToTray: true,
  notificationsEnabled: true,
  firstCloseToastShown: false,
};

function fullKey(key: BgPrefKey): string {
  return KEY_PREFIX + key;
}

function serialise(value: boolean): string {
  return value ? '1' : '0';
}

function deserialise(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  return raw === '1';
}

/**
 * Read a single background-activity pref.
 *
 * Returns `fallback` when:
 *   - `db` is null (pre-unlock; defaults-only path per RESEARCH Pitfall 5)
 *   - the row does not exist
 *   - the underlying query throws
 */
export function readBgPref(
  db: Db | null,
  key: BgPrefKey,
  fallback: boolean,
): boolean {
  if (!db) return fallback;
  try {
    const row = db
      .prepare('SELECT v FROM settings WHERE k = ?')
      .get(fullKey(key)) as { v?: string } | undefined;
    return deserialise(row?.v, fallback);
  } catch {
    return fallback;
  }
}

/**
 * Write a single background-activity pref. Throws if `db` is null — writes
 * require the vault to be unlocked. Callers (BG_SET_PREFS) gate on
 * `dbHolder.db !== null` before invoking.
 */
export function writeBgPref(
  db: Db | null,
  key: BgPrefKey,
  value: boolean,
): void {
  if (!db) {
    throw new Error('writeBgPref: db is null (vault sealed)');
  }
  db.prepare(
    `INSERT INTO settings (k, v) VALUES (?, ?)
     ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
  ).run(fullKey(key), serialise(value));
}

/** Read all 4 background-activity prefs in one shot. Returns defaults for
 *  any keys missing OR when `db` is null. */
export function getBackgroundPrefs(db: Db | null): BackgroundPrefs {
  return {
    autoLaunch: readBgPref(db, 'autoLaunch', BG_PREF_DEFAULTS.autoLaunch),
    closeToTray: readBgPref(db, 'closeToTray', BG_PREF_DEFAULTS.closeToTray),
    notificationsEnabled: readBgPref(
      db,
      'notificationsEnabled',
      BG_PREF_DEFAULTS.notificationsEnabled,
    ),
    firstCloseToastShown: readBgPref(
      db,
      'firstCloseToastShown',
      BG_PREF_DEFAULTS.firstCloseToastShown,
    ),
  };
}

/**
 * Build the OS-mirror options object for `app.setLoginItemSettings`.
 *
 * Exposed for the prefs unit test. NEVER includes `openAsHidden` — that is
 * banned phase-wide by tests/static/phase12-bans.spec.ts (D-06 ADDENDUM).
 */
export function buildLoginItemSettings(
  value: boolean,
  platform: NodeJS.Platform = process.platform,
): { openAtLogin: boolean; args?: string[] } {
  if (platform === 'win32') {
    return { openAtLogin: value, args: ['--was-auto-launched'] };
  }
  // darwin (+ linux fallback): openAtLogin only.
  return { openAtLogin: value };
}

/**
 * Toggle the autoLaunch pref AND mirror to the OS. DB is source-of-truth;
 * the OS state is downstream.
 *
 * Logs `{ scope: 'background-prefs', op: 'setAutoLaunch', value }`. Errors
 * from the OS call are logged and re-thrown so the IPC handler can return a
 * structured failure to the renderer.
 */
export function setAutoLaunch(
  db: Db | null,
  value: boolean,
  logger: Logger,
): void {
  writeBgPref(db, 'autoLaunch', value);
  const opts = buildLoginItemSettings(value);
  try {
    app.setLoginItemSettings(opts);
    logger.info(
      { scope: 'background-prefs', op: 'setAutoLaunch', value },
      'autoLaunch mirrored to OS',
    );
  } catch (err) {
    logger.warn(
      {
        scope: 'background-prefs',
        op: 'setAutoLaunch',
        value,
        err: (err as Error).message,
      },
      'setLoginItemSettings failed',
    );
    throw err;
  }
}

/**
 * Boot-time reconciler: DB wins on any disagreement with the OS.
 *
 * Called from `bootstrap()` once `dbHolder.db !== null` (skipped silently
 * pre-unlock — the post-unlock hook in 12-02 will own the fire-on-unlock
 * trigger). If DB pref and OS state disagree, calls `setAutoLaunch` with
 * the DB value to converge them. If they already agree, no OS call.
 */
export function reconcileAutoLaunchOnBoot(
  db: Db | null,
  logger: Logger,
): void {
  if (!db) {
    // Defaults-only path — skip silently; 12-02 fires on first unlock.
    return;
  }
  const dbValue = readBgPref(db, 'autoLaunch', BG_PREF_DEFAULTS.autoLaunch);
  let osValue = false;
  try {
    osValue = app.getLoginItemSettings().openAtLogin;
  } catch (err) {
    logger.warn(
      {
        scope: 'background-prefs',
        op: 'reconcileAutoLaunchOnBoot',
        err: (err as Error).message,
      },
      'getLoginItemSettings failed',
    );
    return;
  }
  if (dbValue === osValue) {
    return;
  }
  logger.info(
    {
      scope: 'background-prefs',
      op: 'reconcileAutoLaunchOnBoot',
      dbValue,
      osValue,
    },
    'autoLaunch DB/OS divergence — DB wins',
  );
  setAutoLaunch(db, dbValue, logger);
}
