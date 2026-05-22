/**
 * Plan 08-01 Task 7 — Insights IPC handlers.
 *
 * Channels:
 *   INSIGHTS_LATEST     — read current-week rows; report 'locked'/'unlocked'/'empty-unlocked'
 *   INSIGHTS_RECOMPUTE  — manual recompute (Settings → "Recompute now")
 *
 * Read path follows the B-4 single-source-of-truth rule:
 *   1) SELECT FROM insights WHERE week_ymd = current AND dismissed = 0 ORDER BY computed_at DESC
 *   2) if rows.length > 0  → return 'unlocked' rows; do NOT call checkInsightGate
 *   3) else                → call checkInsightGate ONCE; return 'locked' or 'empty-unlocked'
 */
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import type Database from 'better-sqlite3-multiple-ciphers';
import {
  CHANNELS,
  type InsightKindDto,
  type InsightRowDto,
  type InsightsLatestResult,
} from '../../shared/ipc-contract';
import type { DbHolder } from './onboarding';
import { LLMRouter } from '../llm/router';
import { probeOllama } from '../llm/ollamaProbe';
import { getActiveProvider, hasFrontierKey } from '../secrets/safeStorage';
import { classifySensitivity } from '../llm/classifier';
import { aggregate, weekStartYmdFor } from '../insights/aggregate';
import { checkInsightGate } from '../insights/gate';
import { scheduleInsights } from '../insights/schedule';
import type { SchedulerHandle } from '../lifecycle/scheduler';

type Db = Database.Database;

export interface InsightsHandlerDeps {
  logger: Logger;
  dbHolder: DbHolder;
  /** Override the router instance (tests). */
  router?: LLMRouter;
  /** Override tz resolver (tests). */
  userTzFn?: () => string;
  /** When provided, schedules the nightly insights cron on register. */
  scheduler?: SchedulerHandle;
}

function defaultUserTz(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

interface InsightDbRow {
  id: number;
  kind: InsightKindDto;
  week_ymd: string;
  computed_at: string;
  payload_json: string;
  dismissed: number;
}

function rowsForWeek(db: Db, weekYmd: string): InsightRowDto[] {
  let raw: InsightDbRow[] = [];
  try {
    raw = db
      .prepare(
        `SELECT id, kind, week_ymd, computed_at, payload_json, dismissed
           FROM insights
          WHERE week_ymd = ? AND dismissed = 0
          ORDER BY computed_at DESC`,
      )
      .all(weekYmd) as InsightDbRow[];
  } catch {
    return [];
  }
  return raw.map((r) => {
    let parsed: unknown = null;
    let sentences: string[] = [];
    try {
      parsed = JSON.parse(r.payload_json);
      if (
        parsed && typeof parsed === 'object'
        && Array.isArray((parsed as { sentences?: unknown }).sentences)
      ) {
        sentences = ((parsed as { sentences: unknown[] }).sentences)
          .filter((s): s is string => typeof s === 'string')
          .slice(0, 3);
      }
    } catch {
      parsed = null;
    }
    return {
      id: r.id,
      kind: r.kind,
      weekYmd: r.week_ymd,
      computedAt: r.computed_at,
      payload: parsed,
      sentences,
      dismissed: r.dismissed === 1,
    };
  });
}

/**
 * Read the latest insights for the current local week. Single source of truth
 * per B-4: query the table first; fall back to gate check only on empty.
 */
export function readLatestInsights(
  db: Db,
  weekYmd: string,
): InsightsLatestResult {
  const rows = rowsForWeek(db, weekYmd);
  if (rows.length > 0) {
    return { state: 'unlocked', weekYmd, rows: rows.slice(0, 3) };
  }
  const gate = checkInsightGate(db);
  if (!gate.unlocked) {
    return {
      state: 'locked',
      daysRemaining: gate.daysRemaining,
      blockedKinds: gate.blockedKinds as InsightKindDto[],
    };
  }
  return { state: 'empty-unlocked', weekYmd };
}

export function registerInsightsHandlers(
  ipcMain: IpcMain,
  deps: InsightsHandlerDeps,
): void {
  const { logger, dbHolder } = deps;
  const userTzFn = deps.userTzFn ?? defaultUserTz;

  const router =
    deps.router ??
    new LLMRouter({
      getActiveProviderFn: getActiveProvider,
      hasFrontierKeyFn: hasFrontierKey,
      classifierFn: classifySensitivity,
      ollamaReachableFn: async () => (await probeOllama()).reachable,
    });

  // ── Bootstrap nightly cron ─────────────────────────────────────────────────
  if (deps.scheduler) {
    try {
      const tz = userTzFn();
      scheduleInsights(
        '0 2 * * *',
        tz,
        async () => {
          const db = dbHolder.db;
          if (!db) return;
          const weekYmd = weekStartYmdFor(new Date(), tz);
          await aggregate(db, weekYmd, { router, logger });
        },
        { scheduler: deps.scheduler, logger, dbHolder },
      );
    } catch (err) {
      logger.warn(
        { scope: 'insights-bootstrap', err: (err as Error).message },
        'failed to register insights cron on startup',
      );
    }
  }

  // ── INSIGHTS_LATEST ────────────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.INSIGHTS_LATEST, async (): Promise<InsightsLatestResult | { error: string }> => {
    const db = dbHolder.db;
    if (!db) return { error: 'db-locked' };
    try {
      const tz = userTzFn();
      const weekYmd = weekStartYmdFor(new Date(), tz);
      return readLatestInsights(db, weekYmd);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ scope: 'insights-latest', err: msg }, 'insightsLatest failed');
      return { error: msg };
    }
  });

  // ── INSIGHTS_RECOMPUTE ─────────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.INSIGHTS_RECOMPUTE, async (): Promise<
    { ok: true; written: number; skipped: string[] } | { ok: false; error: string }
  > => {
    const db = dbHolder.db;
    if (!db) return { ok: false, error: 'db-locked' };
    try {
      const tz = userTzFn();
      const weekYmd = weekStartYmdFor(new Date(), tz);
      const res = await aggregate(db, weekYmd, { router, logger });
      return { ok: true, written: res.written, skipped: res.skipped };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ scope: 'insights-recompute', err: msg }, 'insightsRecompute failed');
      return { ok: false, error: msg };
    }
  });
}
