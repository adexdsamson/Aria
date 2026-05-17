/**
 * Plan 02-04 — briefing + briefing_item_dismissed persistence layer.
 *
 * Idempotent UPSERT keyed on `date` (YYYY-MM-DD local TZ). Repeated runs same
 * day overwrite the prior row (so cron retries / manual Generate Now after a
 * partial failure produce the latest payload, not a stale cached one).
 *
 * `dismissNewsItem` is per-day, not permanent — the (date, url_hash) primary
 * key on briefing_item_dismissed means dismissing the same URL on the next
 * day still surfaces it.
 *
 * Pitfall 16 compliance: all writes go through scheduler.queue.add(...) in
 * the IPC layer (caller responsibility). This module exposes plain functions
 * over the DB handle; the caller wraps them in queue.add when running under
 * cron contention.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type {
  BriefingNewsItem,
  BriefingPayload,
  BriefingSummary,
  Route,
} from '../../shared/ipc-contract';

type Db = Database.Database;

export interface BriefingRow {
  date: string;
  generatedAt: string;
  tz: string;
  sections: string; // JSON: { calendar, email, news, errors, emailEmptyStateReason? }
  route: Route;
  model: string;
  latency_ms: number;
  ok: 0 | 1;
}

const UPSERT_SQL = `INSERT OR REPLACE INTO briefing
  (date, generated_at, tz, sections, route, model, latency_ms, ok)
  VALUES (@date, @generated_at, @tz, @sections, @route, @model, @latency_ms, @ok)`;

export function upsertBriefing(db: Db, row: BriefingRow): void {
  db.prepare(UPSERT_SQL).run({
    date: row.date,
    generated_at: row.generatedAt,
    tz: row.tz,
    sections: row.sections,
    route: row.route,
    model: row.model,
    latency_ms: Math.max(0, Math.round(row.latency_ms)),
    ok: row.ok,
  });
}

/**
 * Read the briefing row for `date` and rehydrate the BriefingPayload (sections
 * JSON parsed, news[i].dismissed populated by joining briefing_item_dismissed).
 * Returns null when no row exists.
 */
export function readBriefing(db: Db, date: string): BriefingPayload | null {
  const row = db
    .prepare(
      `SELECT date, generated_at, tz, sections, route, model, latency_ms, ok
       FROM briefing WHERE date = ?`,
    )
    .get(date) as
    | {
        date: string;
        generated_at: string;
        tz: string;
        sections: string;
        route: Route;
        model: string;
        latency_ms: number;
        ok: number;
      }
    | undefined;
  if (!row) return null;

  let parsed: {
    calendar?: BriefingPayload['calendar'];
    email?: BriefingPayload['email'];
    news?: BriefingNewsItem[];
    errors?: BriefingPayload['errors'];
    emailEmptyStateReason?: BriefingPayload['emailEmptyStateReason'];
    reason?: string;
  } = {};
  try {
    parsed = JSON.parse(row.sections) as typeof parsed;
  } catch {
    parsed = {};
  }

  // Populate news[i].dismissed by joining the dismissed table for this date.
  const dismissedRows = db
    .prepare('SELECT url_hash FROM briefing_item_dismissed WHERE date = ?')
    .all(date) as Array<{ url_hash: string }>;
  const dismissedSet = new Set(dismissedRows.map((r) => r.url_hash));

  const news: BriefingNewsItem[] = (parsed.news ?? []).map((n) => ({
    ...n,
    dismissed: dismissedSet.has(n.id) || dismissedSet.has(hashFromUrl(n.url)) || !!n.dismissed,
  }));

  return {
    date: row.date,
    generatedAt: row.generated_at,
    tz: row.tz,
    calendar: parsed.calendar ?? [],
    email: parsed.email ?? [],
    news,
    errors: parsed.errors ?? {},
    emailEmptyStateReason: parsed.emailEmptyStateReason,
    route: row.route,
    reason: parsed.reason ?? '',
    model: row.model,
  };
}

export function dismissNewsItem(
  db: Db,
  args: { date: string; urlHash: string },
): void {
  db.prepare(
    `INSERT OR IGNORE INTO briefing_item_dismissed (date, url_hash, dismissed_at)
     VALUES (?, ?, ?)`,
  ).run(args.date, args.urlHash, new Date().toISOString());
}

export function isNewsItemDismissed(db: Db, date: string, urlHash: string): boolean {
  const row = db
    .prepare(
      'SELECT 1 AS one FROM briefing_item_dismissed WHERE date = ? AND url_hash = ?',
    )
    .get(date, urlHash) as { one: number } | undefined;
  return !!row;
}

/** Last N briefing rows in descending date order (for BriefingScreen history). */
export function readBriefingHistory(db: Db, limit = 10): BriefingSummary[] {
  const safe = Math.max(1, Math.min(100, Math.round(limit)));
  const rows = db
    .prepare(
      `SELECT date, generated_at AS generatedAt, route, ok
       FROM briefing ORDER BY date DESC LIMIT ?`,
    )
    .all(safe) as BriefingSummary[];
  return rows;
}

/**
 * Stable per-day url hash used by briefing_item_dismissed. Mirrors the news
 * candidate `id` shape from Plan 02-03 (hn-<n> | rss-<sha256-16>); for
 * dismiss-by-url we hash the URL itself with the same algorithm.
 */
function hashFromUrl(url: string): string {
  // Lazy require to keep this module dependency-light at import time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('node:crypto') as typeof import('node:crypto');
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
}

export { hashFromUrl };
