/**
 * Plan 02-02 — Calendar sync engine.
 *
 * `CalendarSync.tick()` is the unit-of-work driven by the 15-minute cron in
 * `ipc/calendar.ts`. Responsibilities:
 *
 *   1. Read calendar_account row. If sync_token IS NULL → fullResyncWindow().
 *   2. Page-loop client.listEvents({ syncToken, pageToken }) accumulating items.
 *   3. On SyncTokenInvalidatedError → fullResyncWindow() and return.
 *   4. On TokenInvalidError → write last_error = `token-${reason}` and re-throw.
 *   5. In a single db.transaction(...): upsert each event row + advance
 *      sync_token + last_synced_at. Atomic cursor advance (Pitfall 11 / T-02-02-04).
 *
 * `fullResyncWindow()` (M2 pinned, two-step bootstrap):
 *   step 1: listEventsWindow({ timeMin: now-1d, timeMax: now+30d,
 *           singleEvents: false }) page-looped — collect into buffer.
 *   step 2: listEvents({ pageToken: undefined }) WITHOUT syncToken AND
 *           WITHOUT window args — Google returns a fresh nextSyncToken
 *           (documented bootstrap path). Treat any returned items as
 *           additional backfill rows.
 *   step 3: ONE db.transaction: upsert all rows + advance sync_token.
 *
 * Pitfall 14: listEvents NEVER combines syncToken with timeMin/timeMax/orderBy/
 * q/iCalUID/singleEvents — enforced both here (by separating the two methods)
 * AND defensively in the wrapper (`IncompatibleEventsListParamsError`).
 *
 * XCUT-07 (timezone correctness):
 *   - Timed events: start_at_utc = ISO of dateTime; start_timezone preserved.
 *   - All-day events: start_date = YYYY-MM-DD; start_at_utc null; tz null.
 *   - The migration 003 CHECK enforces exactly-one-not-null at the DB level.
 *
 * Concurrency discipline: every Google API call AND every DB write goes through
 * scheduler.queue.add(...). Single-writer SQLite + serialized API discipline
 * carried over from Plan 02-01 / Pitfall 16.
 */
import type { Logger } from 'pino';
import type Database from 'better-sqlite3-multiple-ciphers';
import type PQueueImport from 'p-queue';
import type {
  CalendarClient,
  CalendarEventRaw,
} from './calendar';
import { SyncTokenInvalidatedError } from './calendar';
import { TokenInvalidError } from './auth';

type Db = Database.Database;

export interface CalendarSyncDeps {
  db: Db;
  client: CalendarClient;
  scheduler: { queue: InstanceType<typeof PQueueImport> };
  logger?: Pick<Logger, 'info' | 'warn'>;
  now?: () => Date;
  /** Backfill window lower bound in days before now. Default 1. */
  windowDaysBack?: number;
  /** Backfill window upper bound in days after now. Default 30. */
  windowDaysForward?: number;
}

interface EventRow {
  id: string;
  calendar_id: string;
  summary: string;
  location: string | null;
  start_at_utc: string | null;
  end_at_utc: string | null;
  start_date: string | null;
  end_date: string | null;
  start_timezone: string | null;
  attendees: string;
  status: string;
  recurring_id: string | null;
  updated_at: string;
  fetched_at: string;
}

/**
 * Normalize a Google CalendarEventRaw into the migration-003 row shape.
 * Exported for testing the XCUT-07 timezone correctness path independently.
 */
export function toEventRow(raw: CalendarEventRaw, fetchedAtIso: string): EventRow {
  const isTimed = !!raw.start?.dateTime;
  const start_at_utc = isTimed ? new Date(raw.start!.dateTime!).toISOString() : null;
  const end_at_utc = raw.end?.dateTime ? new Date(raw.end.dateTime).toISOString() : null;
  const start_date = !isTimed && raw.start?.date ? raw.start.date : null;
  const end_date = !isTimed && raw.end?.date ? raw.end.date : null;
  return {
    id: raw.id,
    calendar_id: 'primary',
    summary: raw.summary ?? '',
    location: raw.location ?? null,
    start_at_utc,
    end_at_utc,
    start_date,
    end_date,
    start_timezone: raw.start?.timeZone ?? null,
    attendees: JSON.stringify(raw.attendees ?? []),
    status: raw.status ?? 'confirmed',
    recurring_id: raw.recurringEventId ?? null,
    updated_at: raw.updated ?? fetchedAtIso,
    fetched_at: fetchedAtIso,
  };
}

export class CalendarSync {
  private readonly db: Db;
  private readonly client: CalendarClient;
  private readonly scheduler: { queue: InstanceType<typeof PQueueImport> };
  private readonly logger?: Pick<Logger, 'info' | 'warn'>;
  private readonly now: () => Date;
  private readonly windowDaysBack: number;
  private readonly windowDaysForward: number;

  constructor(deps: CalendarSyncDeps) {
    this.db = deps.db;
    this.client = deps.client;
    this.scheduler = deps.scheduler;
    this.logger = deps.logger;
    this.now = deps.now ?? (() => new Date());
    this.windowDaysBack = deps.windowDaysBack ?? 1;
    this.windowDaysForward = deps.windowDaysForward ?? 30;
  }

  /**
   * One unit of incremental sync. Idempotent. Caller wraps in try/catch —
   * TokenInvalidError is intentionally re-thrown after recording last_error.
   */
  async tick(): Promise<void> {
    const acct = this.readAccount();
    if (!acct) return; // No account row — caller is expected to create one during connect.
    if (!acct.sync_token) {
      await this.fullResyncWindow();
      return;
    }

    const items: CalendarEventRaw[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;

    try {
      // Page-loop with syncToken. NEVER pass window args (Pitfall 14).
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const page = await this.scheduler.queue.add(() =>
          this.client.listEvents({ syncToken: acct.sync_token!, pageToken }),
        );
        if (!page) break;
        for (const it of page.items) items.push(it);
        if (page.nextPageToken) {
          pageToken = page.nextPageToken;
          continue;
        }
        nextSyncToken = page.nextSyncToken;
        break;
      }
    } catch (err) {
      if (err instanceof SyncTokenInvalidatedError) {
        this.logger?.info(
          { scope: 'calendar-sync', event: 'sync-token-invalidated' },
          'syncToken rejected by Google (410); falling back to bounded full resync',
        );
        await this.fullResyncWindow();
        return;
      }
      if (err instanceof TokenInvalidError) {
        this.recordAuthError(err.reason);
        throw err;
      }
      throw err;
    }

    if (!nextSyncToken) {
      // Should not happen on a successful page-loop terminator, but guard.
      this.logger?.warn(
        { scope: 'calendar-sync', event: 'no-next-sync-token' },
        'listEvents page loop ended without nextSyncToken; skipping cursor advance',
      );
      return;
    }

    const fetchedAt = this.now().toISOString();
    await this.scheduler.queue.add(() =>
      this.applyRowsAndAdvanceCursor(items, nextSyncToken!, fetchedAt),
    );
  }

  /**
   * Full bounded backfill + sync-token bootstrap (M2 pinned).
   *
   * Step 1: page-loop listEventsWindow with [now-1d, now+30d], singleEvents=false.
   * Step 2: ONE call to listEvents({pageToken: undefined}) WITHOUT syncToken AND
   *         WITHOUT window args — Google returns a fresh nextSyncToken.
   * Step 3: single db.transaction commits step 1 + step 2 items + sync_token.
   */
  async fullResyncWindow(): Promise<void> {
    const now = this.now();
    const timeMin = new Date(now.getTime() - this.windowDaysBack * 86_400_000).toISOString();
    const timeMax = new Date(now.getTime() + this.windowDaysForward * 86_400_000).toISOString();

    const collected: CalendarEventRaw[] = [];

    // Step 1: bounded backfill (singleEvents=false — syncToken-compatible).
    let pageToken: string | undefined;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let page;
      try {
        page = await this.scheduler.queue.add(() =>
          this.client.listEventsWindow({ timeMin, timeMax, singleEvents: false, pageToken }),
        );
      } catch (err) {
        if (err instanceof TokenInvalidError) {
          this.recordAuthError(err.reason);
          throw err;
        }
        throw err;
      }
      if (!page) break;
      for (const it of page.items) collected.push(it);
      if (!page.nextPageToken) break;
      pageToken = page.nextPageToken;
    }

    // Step 2: bootstrap call to obtain a fresh nextSyncToken.
    let nextSyncToken: string | undefined;
    let bootstrapItems: CalendarEventRaw[] = [];
    try {
      const bootstrap = await this.scheduler.queue.add(() =>
        this.client.listEvents({ pageToken: undefined }),
      );
      if (bootstrap) {
        bootstrapItems = bootstrap.items;
        nextSyncToken = bootstrap.nextSyncToken;
      }
    } catch (err) {
      if (err instanceof SyncTokenInvalidatedError) {
        // Extremely unlikely — we just bootstrapped without a syncToken.
        // Retry once.
        try {
          const retry = await this.scheduler.queue.add(() =>
            this.client.listEvents({ pageToken: undefined }),
          );
          if (retry) {
            bootstrapItems = retry.items;
            nextSyncToken = retry.nextSyncToken;
          }
        } catch {
          this.recordError('sync-token-bootstrap-failed');
          return;
        }
      } else if (err instanceof TokenInvalidError) {
        this.recordAuthError(err.reason);
        throw err;
      } else {
        throw err;
      }
    }

    if (!nextSyncToken) {
      this.recordError('sync-token-bootstrap-failed');
      return;
    }

    const allItems = collected.concat(bootstrapItems);
    const fetchedAt = this.now().toISOString();
    await this.scheduler.queue.add(() =>
      this.applyRowsAndAdvanceCursor(allItems, nextSyncToken!, fetchedAt),
    );
  }

  // ------------------------- DB helpers (single-writer) -------------------------

  private readAccount(): { email: string; sync_token: string | null } | null {
    const row = this.db
      .prepare('SELECT email, sync_token FROM calendar_account WHERE id = 1')
      .get() as { email: string; sync_token: string | null } | undefined;
    return row ?? null;
  }

  private applyRowsAndAdvanceCursor(
    items: CalendarEventRaw[],
    newSyncToken: string,
    fetchedAtIso: string,
  ): void {
    const rows = items.map((r) => toEventRow(r, fetchedAtIso));
    const tx = this.db.transaction(() => {
      const stmt = this.db.prepare(
        `INSERT OR REPLACE INTO calendar_event
         (id, calendar_id, summary, location, start_at_utc, end_at_utc, start_date, end_date,
          start_timezone, attendees, status, recurring_id, updated_at, fetched_at)
         VALUES (@id, @calendar_id, @summary, @location, @start_at_utc, @end_at_utc,
                 @start_date, @end_date, @start_timezone, @attendees, @status,
                 @recurring_id, @updated_at, @fetched_at)`,
      );
      for (const r of rows) stmt.run(r);
      this.db
        .prepare(
          `UPDATE calendar_account
           SET sync_token = @sync_token, last_synced_at = @last_synced_at, last_error = NULL
           WHERE id = 1`,
        )
        .run({ sync_token: newSyncToken, last_synced_at: fetchedAtIso });
    });
    tx();
  }

  private recordAuthError(reason: 'expired' | 'revoked'): void {
    this.recordError(`token-${reason}`);
  }

  private recordError(value: string): void {
    try {
      this.db
        .prepare('UPDATE calendar_account SET last_error = ? WHERE id = 1')
        .run(value);
    } catch {
      /* best-effort */
    }
  }
}

export function createCalendarSync(deps: CalendarSyncDeps): CalendarSync {
  return new CalendarSync(deps);
}

// ============================================================================
// readTodaysEvents — Plan 02-04 briefing helper (lives here for cohesion).
// ============================================================================

/**
 * Compute the UTC ISO bounds of "today" in the given IANA timezone, then call
 * client.listEventsWindow({ ..., singleEvents: true }) so recurring events
 * expand correctly. Fresh from the API — NOT the SQLite cache.
 *
 * Pitfall 19 mitigation: an all-day event with start.date='YYYY-MM-DD' is
 * considered "today" by Plan 02-04's downstream filter when its start_date
 * matches the local date in `userTz`. This function returns the raw events
 * the briefing reader filters.
 */
export async function readTodaysEvents(
  client: CalendarClient,
  userTz: string,
  nowOverride?: Date,
): Promise<CalendarEventRaw[]> {
  const now = nowOverride ?? new Date();
  const { timeMin, timeMax } = computeTodayBoundsUtc(userTz, now);
  const out: CalendarEventRaw[] = [];
  let pageToken: string | undefined;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page = await client.listEventsWindow({
      timeMin,
      timeMax,
      singleEvents: true,
      pageToken,
    });
    for (const it of page.items) out.push(it);
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }
  return out;
}

/**
 * Compute the UTC ISO bounds of the calendar day containing `now` in `userTz`.
 * Returns { timeMin, timeMax } as ISO strings (timeMax is start-of-next-day).
 *
 * Exported for direct unit testing (XCUT-07 case 4/5).
 */
export function computeTodayBoundsUtc(
  userTz: string,
  now: Date,
): { timeMin: string; timeMax: string } {
  // 1. Get the YYYY-MM-DD of `now` as observed in userTz.
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: userTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  // 2. For that local midnight, derive the userTz offset at that instant.
  //    Strategy: compute Intl parts for the local instant and reconstruct.
  //    Use the difference between the same wall-clock interpreted as UTC vs
  //    interpreted in userTz to recover the offset.
  const startMs = localMidnightUtcMs(ymd, userTz);
  const endMs = startMs + 86_400_000;
  return {
    timeMin: new Date(startMs).toISOString(),
    timeMax: new Date(endMs).toISOString(),
  };
}

/**
 * Given an ISO date `YYYY-MM-DD` and an IANA timezone, return the UTC epoch ms
 * corresponding to `YYYY-MM-DDT00:00:00` in that timezone. DST-robust.
 */
function localMidnightUtcMs(ymd: string, tz: string): number {
  // Parse the date components.
  const [y, m, d] = ymd.split('-').map((v) => Number.parseInt(v, 10));
  // Construct a "naive" UTC instant at the same wall-clock and measure how the
  // target tz reports that instant. The delta is the tz offset at that wall.
  // Iterate up to twice to handle DST gaps/overlaps (refines the guess).
  let utcGuess = Date.UTC(y!, m! - 1, d!, 0, 0, 0, 0);
  for (let i = 0; i < 2; i++) {
    const partsTz = getDateParts(new Date(utcGuess), tz);
    const asUtcInTz = Date.UTC(
      partsTz.year,
      partsTz.month - 1,
      partsTz.day,
      partsTz.hour,
      partsTz.minute,
      partsTz.second,
    );
    const offsetMs = asUtcInTz - utcGuess;
    utcGuess = Date.UTC(y!, m! - 1, d!, 0, 0, 0, 0) - offsetMs;
  }
  return utcGuess;
}

function getDateParts(
  d: Date,
  tz: string,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string): number =>
    Number.parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  // hour can come as '24' from some Intl impls when hour12:false at midnight.
  let hour = get('hour');
  if (hour === 24) hour = 0;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute: get('minute'),
    second: get('second'),
  };
}
