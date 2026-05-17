/**
 * Plan 02-04 Task 3 — Briefing IPC handlers (10th handler-registration block).
 *
 * Channels:
 *   BRIEFING_TODAY              — read today's row (null → renderer shows GenerateNowAffordance)
 *   BRIEFING_GENERATE_NOW       — manual runBriefing(today)
 *   BRIEFING_DISMISS_NEWS_ITEM  — persist per-day dismissal
 *   BRIEFING_HISTORY            — last N briefing summaries
 *   BRIEFING_GET_SETTINGS       — read { time: 'HH:00', tz } from settings table
 *   BRIEFING_SET_SETTINGS       — validate whole-hour + IANA tz, re-invoke
 *                                 scheduleBriefing (M3 reinstantiation)
 *
 * On register: reads stored settings, calls scheduleBriefing(...) immediately
 * so the cron is live without waiting for a manual SET. Defaults to
 * { time: '07:00', tz: <process tz> }.
 *
 * Pitfall 16: all DB writes go through scheduler.queue.add(...) so cron-fired
 * briefing writes never collide with gmail-sync / calendar-sync writes.
 */
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import {
  CHANNELS,
  type BriefingSettings,
  type BriefingSummary,
} from '../../shared/ipc-contract';
import type { DbHolder } from './onboarding';
import type { SchedulerHandle } from '../lifecycle/scheduler';
import { LLMRouter } from '../llm/router';
import { getActiveProvider, hasFrontierKey } from '../secrets/safeStorage';
import { classifySensitivity } from '../llm/classifier';
import { runBriefing } from '../briefing/generate';
import {
  readBriefing,
  readBriefingHistory,
  dismissNewsItem,
  hashFromUrl,
} from '../briefing/persist';
import { scheduleBriefing, computeLocalYmd } from '../briefing/schedule';
import {
  getOAuth2Client,
} from '../integrations/google/auth';
import { createCalendarClient, type CalendarClient } from '../integrations/google/calendar';

export interface BriefingHandlerDeps {
  logger: Logger;
  dbHolder: DbHolder;
  scheduler: SchedulerHandle;
  /** Override the router instance (tests). */
  router?: LLMRouter;
  /** Override the calendar client factory (tests). */
  calendarClientFactory?: () => CalendarClient | null;
  /** Override timezone resolver (tests). */
  userTzFn?: () => string;
}

const DEFAULT_TIME = '07:00';
const SETTING_KEY_TIME = 'briefing.time';
const SETTING_KEY_TZ = 'briefing.tz';

const WHOLE_HOUR_RE = /^([01][0-9]|2[0-3]):00$/;

function isIanaTz(tz: string): boolean {
  if (typeof tz !== 'string' || tz.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function defaultUserTz(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function cronExprForTime(time: string): string {
  const m = WHOLE_HOUR_RE.exec(time);
  if (!m) return '0 7 * * *';
  return `0 ${Number(m[1])} * * *`;
}

export function registerBriefingHandlers(ipcMain: IpcMain, deps: BriefingHandlerDeps): void {
  const { logger, dbHolder, scheduler } = deps;
  const userTzFn = deps.userTzFn ?? defaultUserTz;

  const router =
    deps.router ??
    new LLMRouter({
      getActiveProviderFn: getActiveProvider,
      hasFrontierKeyFn: hasFrontierKey,
      classifierFn: classifySensitivity,
    });

  function buildCalendarClient(): CalendarClient | null {
    if (deps.calendarClientFactory) return deps.calendarClientFactory();
    const oauth = getOAuth2Client('calendar');
    if (!oauth) return null;
    return createCalendarClient(oauth);
  }

  function readSettings(): BriefingSettings {
    const db = dbHolder.db;
    const tz = userTzFn();
    if (!db) return { time: DEFAULT_TIME, tz };
    try {
      const time = (db.prepare('SELECT v FROM settings WHERE k = ?').get(SETTING_KEY_TIME) as { v?: string } | undefined)?.v ?? DEFAULT_TIME;
      const storedTz = (db.prepare('SELECT v FROM settings WHERE k = ?').get(SETTING_KEY_TZ) as { v?: string } | undefined)?.v;
      return { time: WHOLE_HOUR_RE.test(time) ? time : DEFAULT_TIME, tz: storedTz && isIanaTz(storedTz) ? storedTz : tz };
    } catch {
      return { time: DEFAULT_TIME, tz };
    }
  }

  function writeSettings(s: BriefingSettings): void {
    const db = dbHolder.db;
    if (!db) return;
    const upsert = db.prepare(
      `INSERT INTO settings (k, v) VALUES (?, ?)
       ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
    );
    const tx = db.transaction(() => {
      upsert.run(SETTING_KEY_TIME, s.time);
      upsert.run(SETTING_KEY_TZ, s.tz);
    });
    tx();
  }

  async function runOnce(date: string): Promise<{ ok: boolean; date?: string; error?: string }> {
    const db = dbHolder.db;
    if (!db) return { ok: false, error: 'db-locked' };
    const { tz } = readSettings();
    try {
      await scheduler.queue.add(async () => {
        await runBriefing({
          db,
          date,
          userTz: tz,
          calendarClient: buildCalendarClient(),
          router,
          logger,
        });
      });
      return { ok: true, date };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ scope: 'briefing-run', err: msg }, 'runBriefing failed');
      return { ok: false, error: msg };
    }
  }

  function rescheduleFromSettings(): void {
    const s = readSettings();
    scheduleBriefing(
      cronExprForTime(s.time),
      s.tz,
      async (date) => {
        await runOnce(date);
      },
      { scheduler, logger },
    );
  }

  // Register cron immediately on startup (cron registry size will become 3
  // once gmail-sync + calendar-sync are also registered).
  try {
    rescheduleFromSettings();
  } catch (err) {
    logger.warn(
      { scope: 'briefing-bootstrap', err: (err as Error).message },
      'failed to register briefing cron on startup',
    );
  }

  // ── BRIEFING_TODAY ─────────────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.BRIEFING_TODAY, async (_e, payload?: { date?: string }) => {
    const db = dbHolder.db;
    if (!db) return { error: 'db-locked' };
    const tz = userTzFn();
    const date = payload?.date ?? computeLocalYmd(tz, new Date());
    try {
      const row = readBriefing(db, date);
      return row ?? { error: 'no-briefing', lastOkDate: lastOkDate(db) };
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  // ── BRIEFING_GENERATE_NOW ──────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.BRIEFING_GENERATE_NOW, async () => {
    const tz = readSettings().tz;
    const today = computeLocalYmd(tz, new Date());
    return await runOnce(today);
  });

  // ── BRIEFING_DISMISS_NEWS_ITEM ─────────────────────────────────────────────
  ipcMain.handle(
    CHANNELS.BRIEFING_DISMISS_NEWS_ITEM,
    async (_e, payload: { date: string; urlHash: string }) => {
      const db = dbHolder.db;
      if (!db) return { ok: false, error: 'db-locked' } as const;
      const date = payload?.date;
      const urlHash = payload?.urlHash;
      if (!date || !urlHash) return { ok: false, error: 'bad-args' } as const;
      try {
        await scheduler.queue.add(() => dismissNewsItem(db, { date, urlHash }));
        return { ok: true } as const;
      } catch (err) {
        logger.warn(
          { scope: 'briefing-dismiss', err: (err as Error).message },
          'dismiss failed',
        );
        return { ok: false, error: (err as Error).message } as const;
      }
    },
  );

  // ── BRIEFING_HISTORY ───────────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.BRIEFING_HISTORY, async (_e, payload?: { limit?: number }) => {
    const db = dbHolder.db;
    if (!db) return { entries: [] as BriefingSummary[] };
    try {
      const entries = readBriefingHistory(db, payload?.limit ?? 10);
      return { entries };
    } catch {
      return { entries: [] as BriefingSummary[] };
    }
  });

  // ── BRIEFING_GET_SETTINGS ──────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.BRIEFING_GET_SETTINGS, async () => readSettings());

  // ── BRIEFING_SET_SETTINGS ──────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.BRIEFING_SET_SETTINGS, async (_e, payload: BriefingSettings) => {
    const time = String(payload?.time ?? '');
    const tz = String(payload?.tz ?? '');
    if (!WHOLE_HOUR_RE.test(time)) return { error: 'invalid-time' };
    if (!isIanaTz(tz)) return { error: 'invalid-tz' };
    try {
      writeSettings({ time, tz });
      // M3 reinstantiation — re-register the cron with the new params.
      rescheduleFromSettings();
      return { ok: true } as const;
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  void hashFromUrl; // re-export keep-alive for IPC consumers that may need it
}

function lastOkDate(db: import('better-sqlite3-multiple-ciphers').Database): string | undefined {
  try {
    const row = db
      .prepare('SELECT date FROM briefing WHERE ok = 1 ORDER BY date DESC LIMIT 1')
      .get() as { date?: string } | undefined;
    return row?.date;
  } catch {
    return undefined;
  }
}
