/**
 * Plan 08-01 Task 5 — Aggregate orchestrator.
 *
 * Iterates the 4 insight kinds, applies the gate per kind, computes, generates
 * prose, and upserts into `insights` table. All LLM calls (recurring-themes
 * label-gen + insight prose) share a single `p-queue({ concurrency: 1 })` so
 * we never run concurrent LLM calls for predictability + rate-limit safety
 * (research §p-queue Standard Stack).
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type { Logger } from 'pino';
import PQueueImport from 'p-queue';
import type { LLMRouter } from '../llm/router';
import {
  computeCalendarLoadDelta,
  computeResponseTimeTrend,
  computeRecurringThemes,
  computeApprovalEditPattern,
} from './compute';
import { checkInsightGate } from './gate';
import { insightProse } from './prose';
import {
  INSIGHT_KINDS,
  type InsightKind,
  type InsightPayload,
} from './schema';

type Db = Database.Database;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PQueue: typeof PQueueImport = ((PQueueImport as any).default ?? PQueueImport) as typeof PQueueImport;

export interface AggregateDeps {
  router: LLMRouter;
  logger: Pick<Logger, 'info' | 'warn'>;
  /** Inject a shared queue (e.g. scheduler.queue) for cross-subsystem fairness; else a private one. */
  llmQueue?: InstanceType<typeof PQueueImport>;
  /** Test seam — override now. */
  now?: Date;
}

export interface AggregateResult {
  written: number;
  skipped: InsightKind[];
}

/**
 * Compute insights for the week containing `weekStartYmd` (local Monday YMD).
 * Returns the count of rows written + the list of skipped kinds.
 */
export async function aggregate(
  db: Db,
  weekStartYmd: string,
  deps: AggregateDeps,
): Promise<AggregateResult> {
  const { router, logger } = deps;
  const queue = deps.llmQueue ?? new PQueue({ concurrency: 1 });
  const now = deps.now ?? new Date();

  const gate = checkInsightGate(db, { now });
  if (gate.unlocked === false && gate.blockedKinds.length === INSIGHT_KINDS.length) {
    logger.info(
      { scope: 'insights-aggregate', daysRemaining: gate.daysRemaining },
      'all kinds blocked — skipping aggregate',
    );
    return { written: 0, skipped: [...INSIGHT_KINDS] };
  }

  const skipped: InsightKind[] = [];
  let written = 0;
  const computedAt = now.toISOString();

  for (const kind of INSIGHT_KINDS) {
    if (gate.blockedKinds.includes(kind)) {
      skipped.push(kind);
      continue;
    }

    let payload: InsightPayload | null = null;
    try {
      switch (kind) {
        case 'calendar_load':
          payload = computeCalendarLoadDelta(db, weekStartYmd);
          break;
        case 'response_time':
          payload = computeResponseTimeTrend(db, weekStartYmd);
          break;
        case 'recurring_themes':
          payload = await queue.add(async () => computeRecurringThemes(db, weekStartYmd)) as InsightPayload;
          break;
        case 'approval_edits':
          payload = computeApprovalEditPattern(db, weekStartYmd);
          break;
      }
    } catch (err) {
      logger.warn(
        { scope: 'insights-aggregate', kind, err: (err as Error).message },
        'compute failed; skipping kind',
      );
      skipped.push(kind);
      continue;
    }

    if (!payload) {
      skipped.push(kind);
      continue;
    }

    // Generate prose (serialized via the shared queue).
    let sentences: string[] = [];
    try {
      const out = await queue.add(async () =>
        insightProse(payload!, { router, logger, db }),
      ) as { sentences: string[] };
      sentences = out.sentences;
    } catch (err) {
      logger.warn(
        { scope: 'insights-aggregate', kind, err: (err as Error).message },
        'prose failed; persisting payload without sentences',
      );
      sentences = [];
    }

    // Persist (upsert keyed on kind + week_ymd).
    const payloadWithProse = { ...payload, sentences };
    try {
      db.prepare(
        `INSERT INTO insights (kind, week_ymd, computed_at, payload_json)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(kind, week_ymd) DO UPDATE SET
           computed_at = excluded.computed_at,
           payload_json = excluded.payload_json,
           dismissed = 0`,
      ).run(kind, weekStartYmd, computedAt, JSON.stringify(payloadWithProse));
      written++;
    } catch (err) {
      logger.warn(
        { scope: 'insights-aggregate', kind, err: (err as Error).message },
        'insights row write failed',
      );
      skipped.push(kind);
    }
  }

  logger.info(
    { scope: 'insights-aggregate', weekStartYmd, written, skipped },
    'insights aggregate complete',
  );
  return { written, skipped };
}

/**
 * Compute the Monday-anchored YMD for `now` in the given IANA tz. Used by the
 * nightly scheduler so an aggregate run targets "this week so far".
 */
export function weekStartYmdFor(now: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  // Determine local Y/M/D + weekday.
  const parts = fmt.formatToParts(now);
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const mo = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  const wk = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const idx = WEEK.indexOf(wk);
  const shift = idx === -1 ? 0 : (idx === 0 ? 6 : idx - 1); // days since Monday
  const local = new Date(`${y}-${mo}-${d}T00:00:00.000Z`);
  local.setUTCDate(local.getUTCDate() - shift);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}`;
}
