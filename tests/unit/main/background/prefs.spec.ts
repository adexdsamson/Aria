/**
 * Phase 12 / Plan 12-01 Task 1 — background prefs unit tests.
 *
 * Cases (per PLAN.md <behavior>):
 *   (a) readBgPref returns fallback when db null
 *   (b) readBgPref returns persisted value when row present
 *   (c) setAutoLaunch writes pref AND calls app.setLoginItemSettings with
 *       win32-shaped args / no openAsHidden on darwin
 *   (d) reconcileAutoLaunchOnBoot — db/os divergence triggers setAutoLaunch;
 *       agreement is a no-op
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import type { Logger } from 'pino';

// Override the global tests/setup.ts electron mock with one that adds
// login-item APIs. vi.hoisted is required because vi.mock factories run
// before module-level `const`s.
const { setLoginItemSettings, getLoginItemSettings } = vi.hoisted(() => ({
  setLoginItemSettings: vi.fn(),
  getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
}));

vi.mock('electron', () => ({
  app: {
    setLoginItemSettings,
    getLoginItemSettings,
  },
}));

import {
  BG_PREF_DEFAULTS,
  buildLoginItemSettings,
  getBackgroundPrefs,
  readBgPref,
  reconcileAutoLaunchOnBoot,
  setAutoLaunch,
  writeBgPref,
} from '../../../../src/main/background/prefs';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  // Mirror migration 001's settings table.
  db.exec(`CREATE TABLE settings(k TEXT PRIMARY KEY, v TEXT NOT NULL);`);
  return db;
}

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  } as unknown as Logger;
}

beforeEach(() => {
  setLoginItemSettings.mockReset();
  getLoginItemSettings.mockReset();
  getLoginItemSettings.mockReturnValue({ openAtLogin: false });
});

describe('Phase 12 background prefs', () => {
  describe('(a) readBgPref defaults-only path', () => {
    it('returns fallback when db is null', () => {
      expect(readBgPref(null, 'closeToTray', true)).toBe(true);
      expect(readBgPref(null, 'autoLaunch', false)).toBe(false);
      expect(readBgPref(null, 'notificationsEnabled', true)).toBe(true);
    });

    it('returns fallback when row missing on a live db', () => {
      const db = makeDb();
      expect(readBgPref(db, 'closeToTray', true)).toBe(true);
      expect(readBgPref(db, 'autoLaunch', false)).toBe(false);
    });

    it('getBackgroundPrefs returns BG_PREF_DEFAULTS when db null', () => {
      expect(getBackgroundPrefs(null)).toEqual(BG_PREF_DEFAULTS);
    });
  });

  describe('(b) writeBgPref + readBgPref round-trip', () => {
    it('reads persisted value after write', () => {
      const db = makeDb();
      writeBgPref(db, 'closeToTray', false);
      expect(readBgPref(db, 'closeToTray', true)).toBe(false);
      writeBgPref(db, 'closeToTray', true);
      expect(readBgPref(db, 'closeToTray', false)).toBe(true);
    });

    it('writeBgPref throws when db is null', () => {
      expect(() => writeBgPref(null, 'closeToTray', false)).toThrow();
    });

    it('getBackgroundPrefs returns the full persisted set', () => {
      const db = makeDb();
      writeBgPref(db, 'autoLaunch', true);
      writeBgPref(db, 'closeToTray', false);
      writeBgPref(db, 'notificationsEnabled', false);
      writeBgPref(db, 'firstCloseToastShown', true);
      expect(getBackgroundPrefs(db)).toEqual({
        autoLaunch: true,
        closeToTray: false,
        notificationsEnabled: false,
        firstCloseToastShown: true,
      });
    });
  });

  describe('(c) setAutoLaunch OS mirror', () => {
    it('writes pref AND calls app.setLoginItemSettings', () => {
      const db = makeDb();
      const logger = makeLogger();
      setAutoLaunch(db, true, logger);
      expect(readBgPref(db, 'autoLaunch', false)).toBe(true);
      expect(setLoginItemSettings).toHaveBeenCalledTimes(1);
    });

    it('buildLoginItemSettings(win32) includes args=["--was-auto-launched"] and NO openAsHidden', () => {
      const opts = buildLoginItemSettings(true, 'win32');
      expect(opts).toEqual({ openAtLogin: true, args: ['--was-auto-launched'] });
      // Hard ban: openAsHidden must never be present (D-06 ADDENDUM).
      expect(opts).not.toHaveProperty('openAsHidden');
    });

    it('buildLoginItemSettings(darwin) includes openAtLogin ONLY (no openAsHidden, no args)', () => {
      const opts = buildLoginItemSettings(true, 'darwin');
      expect(opts).toEqual({ openAtLogin: true });
      expect(opts).not.toHaveProperty('openAsHidden');
      expect(opts).not.toHaveProperty('args');
    });

    it('buildLoginItemSettings(false) on win32 still includes args', () => {
      // win32 always passes args so the renderer can detect autolaunch boot.
      expect(buildLoginItemSettings(false, 'win32')).toEqual({
        openAtLogin: false,
        args: ['--was-auto-launched'],
      });
    });
  });

  describe('(d) reconcileAutoLaunchOnBoot — DB wins', () => {
    it('db=true, os=false → calls setLoginItemSettings(true)', () => {
      const db = makeDb();
      writeBgPref(db, 'autoLaunch', true);
      getLoginItemSettings.mockReturnValue({ openAtLogin: false });
      reconcileAutoLaunchOnBoot(db, makeLogger());
      expect(setLoginItemSettings).toHaveBeenCalledTimes(1);
      const arg = setLoginItemSettings.mock.calls[0]?.[0] as { openAtLogin: boolean };
      expect(arg.openAtLogin).toBe(true);
    });

    it('db=false, os=true → calls setLoginItemSettings(false)', () => {
      const db = makeDb();
      writeBgPref(db, 'autoLaunch', false);
      getLoginItemSettings.mockReturnValue({ openAtLogin: true });
      reconcileAutoLaunchOnBoot(db, makeLogger());
      expect(setLoginItemSettings).toHaveBeenCalledTimes(1);
      const arg = setLoginItemSettings.mock.calls[0]?.[0] as { openAtLogin: boolean };
      expect(arg.openAtLogin).toBe(false);
    });

    it('db === os → no OS call', () => {
      const db = makeDb();
      writeBgPref(db, 'autoLaunch', false);
      getLoginItemSettings.mockReturnValue({ openAtLogin: false });
      reconcileAutoLaunchOnBoot(db, makeLogger());
      expect(setLoginItemSettings).not.toHaveBeenCalled();
    });

    it('db null → silent skip (no OS call)', () => {
      reconcileAutoLaunchOnBoot(null, makeLogger());
      expect(setLoginItemSettings).not.toHaveBeenCalled();
      expect(getLoginItemSettings).not.toHaveBeenCalled();
    });
  });
});
