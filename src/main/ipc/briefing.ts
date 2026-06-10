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
import type Database from 'better-sqlite3-multiple-ciphers';
import {
  CHANNELS,
  type BriefingSettings,
  type BriefingSummary,
  type BriefingPayload,
  type WhatsAppGroupSummaryDto,
} from '../../shared/ipc-contract';
import type { DbHolder } from './onboarding';
import type { SchedulerHandle } from '../lifecycle/scheduler';
import type { WhatsAppDigestHandle } from '../whatsapp/digest-cron';
import { LLMRouter } from '../llm/router';
import { probeOllama } from '../llm/ollamaProbe';
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
import { readLatestInsights } from './insights';
import { weekStartYmdFor } from '../insights/aggregate';
import {
  getOAuth2Client,
} from '../integrations/google/auth';
import { createCalendarClient, type CalendarClient } from '../integrations/google/calendar';
import { BrowserWindow } from 'electron';
import { showBriefingReadyNotification } from '../tray/notify';
import { readBgPref } from '../background/prefs';

type Db = Database.Database;

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
  /**
   * Phase 21 — WhatsApp digest handle for fire-and-forget runNow() (D-07.3).
   * Injected by index.ts after startWhatsAppDigest() is called. Optional so
   * existing tests that do not pass it continue to work unchanged.
   */
  digestHandle?: WhatsAppDigestHandle | null;
  /**
   * Phase 21 Plan 21-06 — late-binding getter for the digest handle.
   * Preferred over digestHandle when wired from production index.ts, because
   * registerBriefingHandlers is called pre-unlock (digestHandle is null at
   * registration time). The getter is invoked at handler-fire time when
   * _digestHandle is already assigned. Falls back to digestHandle if absent.
   */
  getDigestHandle?: () => WhatsAppDigestHandle | null;
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

/**
 * Phase 21 — Read WhatsApp group digest data for today and map to the
 * BriefingPayload.whatsApp discriminated union (D-10 state matrix).
 *
 * read-only, no model (D-13)
 *
 * Returns { payload: undefined, shouldGenerate: false } when:
 *   - No provider_account row for 'whatsapp' (not linked — digest irrelevant)
 *   - No tracked groups (nothing to generate — digest irrelevant)
 * Returns { payload: undefined, shouldGenerate: true } when:
 *   - WhatsApp is linked + groups tracked + ALL groups have no digest row for
 *     today (no-activity). This is the "linked but no row yet today" case that
 *     should trigger the D-07.3 async fallback runNow().
 * Returns { payload: <value>, shouldGenerate: false } when:
 *   - At least one group has a row (summarized or failed) — generation already ran.
 *   - { state: 'unavailable', reason: 'model-offline' } when all rows are NULL.
 *   - { state: 'ready', groups: [...] } when at least one is summarized.
 */
function readWhatsAppDigests(
  db: Db,
  date: string,
  logger: Pick<Logger, 'warn'>,
): { payload: BriefingPayload['whatsApp']; shouldGenerate: boolean } {
  try {
    // Step 1: Check if WhatsApp is linked via provider_account
    const account = db
      .prepare(
        `SELECT status FROM provider_account WHERE provider_key = 'whatsapp' LIMIT 1`,
      )
      .get() as { status: string } | undefined;
    // Not linked — digest is not applicable for this user; do not trigger generation.
    if (!account) return { payload: undefined, shouldGenerate: false };

    // Step 2: Get tracked groups
    const trackedGroups = db
      .prepare(`SELECT jid, display_name FROM whatsapp_group WHERE tracked = 1`)
      .all() as Array<{ jid: string; display_name: string }>;
    // Zero tracked groups — digest is not applicable; do not trigger generation.
    if (trackedGroups.length === 0) return { payload: undefined, shouldGenerate: false };

    // Step 3: Get digest rows for today
    const digestRows = db
      .prepare(
        `SELECT jid, summary_text FROM whatsapp_group_digest WHERE date = ?`,
      )
      .all(date) as Array<{ jid: string; summary_text: string | null }>;
    const digestMap = new Map<string, string | null>(
      digestRows.map((r) => [r.jid, r.summary_text]),
    );

    // Step 4: Map tracked groups to WhatsAppGroupSummaryDto
    const groups: WhatsAppGroupSummaryDto[] = trackedGroups.map((g) => {
      if (!digestMap.has(g.jid)) {
        return { jid: g.jid, displayName: g.display_name, state: 'no-activity' };
      }
      const text = digestMap.get(g.jid) ?? null;
      if (text === null) {
        return { jid: g.jid, displayName: g.display_name, state: 'failed' };
      }
      return { jid: g.jid, displayName: g.display_name, state: 'summarized', summaryText: text };
    });

    // Step 5: Determine content/failed flags
    const hasAnyContent = groups.some((g) => g.state === 'summarized');
    const hasAnyFailed = groups.some((g) => g.state === 'failed');

    // Step 6: Build connection field from account status
    const connection: 'degraded' | 'needs-auth' | undefined =
      account.status === 'degraded' || account.status === 'needs-auth'
        ? (account.status as 'degraded' | 'needs-auth')
        : undefined;

    // Step 7: Return based on D-10 state matrix
    if (!hasAnyContent && !hasAnyFailed) {
      // All groups are no-activity (no digest rows for today yet) — omit section but
      // signal that generation should be triggered (D-07.3). This is specifically the
      // "linked + groups tracked + no row yet today" case, distinct from "not linked"
      // or "zero groups" which set shouldGenerate: false above (WR-01 fix).
      return { payload: undefined, shouldGenerate: true };
    }
    if (!hasAnyContent && hasAnyFailed) {
      // All digest attempts failed (Ollama was offline for all groups) — generation
      // already ran; do not re-trigger.
      return {
        payload: {
          state: 'unavailable',
          reason: 'model-offline',
          ...(connection ? { connection } : {}),
        },
        shouldGenerate: false,
      };
    }
    // At least one group has a summary — show the section; generation already ran.
    return {
      payload: {
        state: 'ready',
        groups,
        ...(connection ? { connection } : {}),
      },
      shouldGenerate: false,
    };
  } catch (err) {
    logger.warn(
      { scope: 'readWhatsAppDigests', err: (err as Error).message },
      'readWhatsAppDigests internal error',
    );
    throw err; // re-throw so the caller's try/catch can handle graceful degradation
  }
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
      ollamaReachableFn: async () => (await probeOllama()).reachable,
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
      let briefingPayload: import('../../shared/ipc-contract').BriefingPayload | null = null;
      await scheduler.queue.add(async () => {
        briefingPayload = await runBriefing({
          db,
          date,
          userTz: tz,
          calendarClient: buildCalendarClient(),
          router,
          logger,
        });
      });
      // Phase 12 / Plan 12-03 — notify on briefing completion (BG-06).
      // Fires at most once per dateKey (dedupe in notify.ts). Gated on
      // notificationsEnabled pref. Falls back to tray badge if permission denied.
      try {
        const win = BrowserWindow.getAllWindows()[0] ?? null;
        if (win && briefingPayload) {
          const p = briefingPayload as import('../../shared/ipc-contract').BriefingPayload;
          showBriefingReadyNotification(
            win,
            {
              emails: p.email?.length ?? 0,
              events: p.calendar?.length ?? 0,
              news: p.news?.length ?? 0,
            },
            date,
            {
              notificationsEnabled: readBgPref(db, 'notificationsEnabled', true),
              logger,
            },
          );
        }
      } catch (notifErr) {
        logger.warn(
          { scope: 'briefing-notify', err: (notifErr as Error).message },
          'showBriefingReadyNotification threw (non-fatal)',
        );
      }
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
      { scheduler, logger, dbHolder },
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
      if (!row) return { error: 'no-briefing', lastOkDate: lastOkDate(db) };
      // Plan 08-01 — enrich with "This week" insights.
      try {
        const weekYmd = weekStartYmdFor(new Date(), tz);
        const ins = readLatestInsights(db, weekYmd);
        if (ins.state === 'unlocked') {
          row.thisWeekInsights = {
            state: 'unlocked',
            rows: ins.rows.map((r) => ({ id: r.id, kind: r.kind, sentences: r.sentences })),
          };
        } else if (ins.state === 'locked') {
          row.thisWeekInsights = {
            state: 'locked',
            daysRemaining: ins.daysRemaining,
            blockedKinds: ins.blockedKinds,
          };
        } // 'empty-unlocked' → leave undefined (section omitted)
      } catch (err) {
        logger.warn(
          { scope: 'briefing-today-insights', err: (err as Error).message },
          'failed to enrich briefing with insights',
        );
      }
      // Phase 21 — enrich with WhatsApp group digests (D-11).
      // Enrichment is AFTER runBriefing returns — frontier never sees whatsApp content (D-11).
      // read-only, no model — readWhatsAppDigests annotated per D-13.
      try {
        const { payload: wa, shouldGenerate } = readWhatsAppDigests(db, date, logger);
        if (wa !== undefined) row.whatsApp = wa;
        // D-07.3 async fallback: only trigger runNow() when WhatsApp is linked, groups are
        // tracked, but no digest row exists for today yet (shouldGenerate=true).
        // Do NOT fire for unlinked users or users with zero tracked groups — those return
        // shouldGenerate=false so this call is a no-op for them (WR-01 fix).
        // fire-and-forget — NEVER await here; never propagate Ollama errors into briefing.
        // getDigestHandle() is late-binding (production path); digestHandle is the
        // direct field (test path). Both are checked so tests without getDigestHandle work.
        const _dh = deps.getDigestHandle?.() ?? deps.digestHandle;
        if (shouldGenerate && _dh) {
          void _dh.runNow();
        }
      } catch (err) {
        logger.warn(
          { scope: 'briefing-today-whatsapp', err: (err as Error).message },
          'failed to enrich briefing with whatsapp digests',
        );
      }
      return row;
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

  // ── BRIEFING_REGENERATE_TODAY ──────────────────────────────────────────────
  // UAT Gap 8 — escape hatch for the idempotent same-day cache. Deletes
  // today's `briefing` row (and clears any dismissed-news rows for the date so
  // the regenerated payload starts fresh) and calls runBriefing(today).
  // Returns the new BriefingPayload directly (not the {ok,date} envelope used
  // by GENERATE_NOW) so the renderer can swap state in one round-trip.
  ipcMain.handle(CHANNELS.BRIEFING_REGENERATE_TODAY, async () => {
    const db = dbHolder.db;
    if (!db) return { ok: false as const, error: 'db-locked' };
    const { tz } = readSettings();
    const today = computeLocalYmd(tz, new Date());
    try {
      await scheduler.queue.add(async () => {
        db.prepare('DELETE FROM briefing WHERE date = ?').run(today);
      });
      await scheduler.queue.add(async () => {
        await runBriefing({
          db,
          date: today,
          userTz: tz,
          calendarClient: buildCalendarClient(),
          router,
          logger,
        });
      });
      const fresh = readBriefing(db, today);
      if (!fresh) return { ok: false as const, error: 'regenerate-no-row' };
      // Phase 12 / Plan 12-03 — mirror the runOnce notification hook on the
      // regenerate path. The dedupe Set in notify.ts resets on app restart, so
      // this fires at most once per dateKey per session (same as GENERATE_NOW).
      try {
        const win = BrowserWindow.getAllWindows()[0] ?? null;
        if (win) {
          showBriefingReadyNotification(
            win,
            {
              emails: fresh.email?.length ?? 0,
              events: fresh.calendar?.length ?? 0,
              news: fresh.news?.length ?? 0,
            },
            today,
            { notificationsEnabled: readBgPref(db, 'notificationsEnabled', true), logger },
          );
        }
      } catch (notifErr) {
        logger.warn(
          { scope: 'briefing-notify', err: (notifErr as Error).message },
          'showBriefingReadyNotification threw on regenerate (non-fatal)',
        );
      }
      return fresh;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ scope: 'briefing-regenerate', err: msg }, 'regenerate failed');
      return { ok: false as const, error: msg };
    }
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

  // ── WHATSAPP_GENERATE_DIGEST_NOW ───────────────────────────────────────────
  // Phase 21 — SC4 retry affordance: renderer calls this when the local model
  // was offline and the user wants to re-run the digest. Calls the local-only
  // digest cron (no frontier LLM). Returns immediately; runNow() is async
  // fire-and-forget. Must NOT call briefingGenerateNow (different scope).
  ipcMain.handle(CHANNELS.WHATSAPP_GENERATE_DIGEST_NOW, async () => {
    const _dh2 = deps.getDigestHandle?.() ?? deps.digestHandle;
    if (!_dh2) {
      return { ok: false as const, error: 'digest handle not available' };
    }
    void _dh2.runNow();
    return { ok: true as const };
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
