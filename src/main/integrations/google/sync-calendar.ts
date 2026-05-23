/**
 * Plan 02-02 — Calendar sync engine.
 *
 * `CalendarSync.tick()` is the unit-of-work driven by the 15-minute cron in
 * `ipc/calendar.ts`. Responsibilities:
 *
 *   1. Read sync cursor from `provider_sync_state` (provider_key='google',
 *      resource='calendar', account_id=this.accountId). If cursor IS NULL →
 *      fullResyncWindow().
 *   2. Page-loop client.listEvents({ syncToken, pageToken }) accumulating items.
 *   3. On SyncTokenInvalidatedError → fullResyncWindow() and return.
 *   4. On TokenInvalidError → update provider_account.status='needs-auth' +
 *      last_error=`token-${reason}` and re-throw.
 *   5. In a single db.transaction(...): upsert each event row (tagged with
 *      provider_key='google' + account_id) + advance cursor in
 *      provider_sync_state. Atomic cursor advance (Pitfall 11 / T-02-02-04).
 *
 * Migration 014 dropped the legacy singleton `calendar_account` base table.
 * `calendar_account_view` is a read-only view over `provider_account` and is
 * NOT writable; cursor state lives in `provider_sync_state`. Quick task
 * 260523-a5w lifted this file off the dropped base table.
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
import { upsertProviderSyncState } from '../microsoft/provider-account';

type Db = Database.Database;

export interface CalendarSyncDeps {
  db: Db;
  client: CalendarClient;
  scheduler: { queue: InstanceType<typeof PQueueImport> };
  /**
   * Quick task 260523-a5w — Google calendar account_id is the email address
   * (singleton-style upsert in `CALENDAR_CONNECT`). Required so each tick can
   * (a) read its cursor from provider_sync_state for this account, (b) tag
   * inserted calendar_event rows with provider_key='google' + account_id, and
   * (c) update provider_account error state by composite key.
   * Throws at construction if missing (loud failure, not silent).
   */
  accountId: string;
  logger?: Pick<Logger, 'info' | 'warn' | 'debug'>;
  now?: () => Date;
  /** Backfill window lower bound in days before now. Default 1. */
  windowDaysBack?: number;
  /** Backfill window upper bound in days after now. Default 30. */
  windowDaysForward?: number;
}

/**
 * Sentinel returned by `toEventRow` for events that must NOT be inserted —
 * cancelled tombstones (incremental syncToken responses signal deletion this
 * way) and defensively-malformed events with no start field.
 *
 * UAT Gap 7: prior to this guard, the normalizer produced rows with both
 * `start_at_utc` and `start_date` null, violating migration-003's CHECK
 * constraint and failing the entire transaction.
 *
 * - 'delete': caller should DELETE any row with this id (incremental tombstone)
 * - 'skip':   caller should ignore (no start field at all — malformed)
 */
type NormalizeAction =
  | { kind: 'upsert'; row: EventRow }
  | { kind: 'delete'; id: string; reason: 'cancelled' }
  | { kind: 'skip'; id: string; reason: 'cancelled' | 'no-start' };

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
  etag: string | null;
  i_cal_uid: string | null;
  sequence: number | null;
  organizer_email: string | null;
  organizer_self: number | null;
  recurrence_json: string | null;
}

/**
 * Normalize a Google CalendarEventRaw into the migration-003 row shape.
 * Exported for testing the XCUT-07 timezone correctness path independently.
 *
 * UAT Gap 7 contract: returns a `NormalizeAction` discriminated union rather
 * than always producing an EventRow. Cancelled events (Google's tombstone
 * signal on syncToken responses) and malformed events with no start field
 * MUST NOT be inserted — migration-003 CHECK requires exactly-one of
 * `start_at_utc` / `start_date` non-null.
 *
 * Strategy A (chosen): caller deletes any stored row with the same id when
 * action.kind === 'delete'; silently drops `'skip'` actions. Defensive against
 * confirmed-but-no-start events (logged at warn).
 */
export function normalizeEvent(raw: CalendarEventRaw, fetchedAtIso: string): NormalizeAction {
  const hasStart = !!(raw.start?.dateTime || raw.start?.date);
  if (raw.status === 'cancelled') {
    // Tombstone — incremental sync deletes; bootstrap (no prior row) silently drops.
    return { kind: 'delete', id: raw.id, reason: 'cancelled' };
  }
  if (!hasStart) {
    // Confirmed but malformed (no start.dateTime or start.date). Skip defensively.
    return { kind: 'skip', id: raw.id, reason: 'no-start' };
  }
  return { kind: 'upsert', row: toEventRow(raw, fetchedAtIso) };
}

/**
 * Pure row builder. Caller guarantees `raw.start` has either `dateTime` or
 * `date` — invariant enforced by `normalizeEvent`. Migration-003 CHECK is
 * satisfied by construction.
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
    etag: raw.etag ?? null,
    i_cal_uid: raw.iCalUID ?? null,
    sequence: typeof raw.sequence === 'number' ? raw.sequence : null,
    organizer_email: raw.organizer?.email ?? null,
    organizer_self: raw.organizer?.self === true ? 1 : raw.organizer ? 0 : null,
    recurrence_json: raw.recurrence && raw.recurrence.length > 0 ? JSON.stringify(raw.recurrence) : null,
  };
}

export class CalendarSync {
  private readonly db: Db;
  private readonly client: CalendarClient;
  private readonly scheduler: { queue: InstanceType<typeof PQueueImport> };
  private readonly logger?: Pick<Logger, 'info' | 'warn' | 'debug'>;
  private readonly now: () => Date;
  private readonly windowDaysBack: number;
  private readonly windowDaysForward: number;
  /** Quick task 260523-a5w — required to tag rows + key cursor state. */
  private readonly accountId: string;

  constructor(deps: CalendarSyncDeps) {
    if (!deps.accountId || typeof deps.accountId !== 'string') {
      // Loud failure at construction — caller (buildSync in ipc/calendar.ts)
      // is responsible for resolving the connected Google calendar account_id.
      throw new Error('CalendarSync: accountId is required (provider_account email)');
    }
    this.db = deps.db;
    this.client = deps.client;
    this.scheduler = deps.scheduler;
    this.accountId = deps.accountId;
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

    // Step 2: bootstrap page-loop to obtain a fresh nextSyncToken.
    //
    // Per Google Calendar API docs, nextSyncToken is ONLY present on the LAST
    // page of a paginated response. A busy primary calendar (>~250 events)
    // returns nextPageToken on the first page with no nextSyncToken — we MUST
    // page through to the end. The empty-calendar case still returns
    // nextSyncToken on its single page, so no special-casing required.
    let nextSyncToken: string | undefined;
    const bootstrapItems: CalendarEventRaw[] = [];
    const MAX_PAGES = 50; // safety guard — primary calendars can have thousands of events
    let bootstrapOverflow = false;
    let bootstrapPagesSeen = 0;
    try {
      let pageToken2: string | undefined = undefined;
      for (let i = 0; i < MAX_PAGES; i++) {
        const page = await this.scheduler.queue.add(() =>
          this.client.listEvents({ pageToken: pageToken2 }),
        );
        bootstrapPagesSeen = i + 1;
        if (!page) break;
        for (const it of page.items) bootstrapItems.push(it);
        if (page.nextSyncToken) {
          nextSyncToken = page.nextSyncToken;
          break;
        }
        if (!page.nextPageToken) break;
        pageToken2 = page.nextPageToken;
        if (i === MAX_PAGES - 1) {
          bootstrapOverflow = true;
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      if (err instanceof SyncTokenInvalidatedError) {
        // Extremely unlikely — we just bootstrapped without a syncToken.
        this.logger?.warn(
          { scope: 'calendar-sync', err: errorMessage, stack: errorStack },
          'bootstrap step 2 failed with SyncTokenInvalidatedError (unexpected without syncToken)',
        );
        this.recordError('sync-token-bootstrap-failed');
        return;
      } else if (err instanceof TokenInvalidError) {
        this.logger?.warn(
          { scope: 'calendar-sync', err: errorMessage, stack: errorStack, reason: err.reason },
          'bootstrap step 2 failed with TokenInvalidError',
        );
        this.recordAuthError(err.reason);
        throw err;
      } else {
        this.logger?.warn(
          { scope: 'calendar-sync', err: errorMessage, stack: errorStack },
          'bootstrap step 2 failed with unexpected error',
        );
        throw err;
      }
    }

    if (!nextSyncToken) {
      if (bootstrapOverflow) {
        this.logger?.warn(
          { scope: 'calendar-sync', pages: bootstrapPagesSeen, max_pages: MAX_PAGES },
          'bootstrap page-loop exhausted MAX_PAGES without nextSyncToken',
        );
        this.recordError('sync-token-bootstrap-paginated-overflow');
      } else {
        this.logger?.warn(
          { scope: 'calendar-sync', pages: bootstrapPagesSeen },
          'bootstrap page-loop ended without nextSyncToken (no overflow)',
        );
        this.recordError('sync-token-bootstrap-failed');
      }
      return;
    }

    const allItems = collected.concat(bootstrapItems);
    const fetchedAt = this.now().toISOString();
    await this.scheduler.queue.add(() =>
      this.applyRowsAndAdvanceCursor(allItems, nextSyncToken!, fetchedAt),
    );
  }

  // ------------------------- DB helpers (single-writer) -------------------------

  /**
   * Quick task 260523-a5w — read cursor from provider_sync_state (post-014
   * shape) + verify the provider_account row still exists. `email` is the
   * account_id by Google convention (singleton upsert on connect). Returns
   * null only if the account row has been disconnected mid-flight.
   */
  private readAccount(): { email: string; sync_token: string | null } | null {
    // Confirm the provider_account row is still present — disconnect is
    // racy with cron ticks. calendar_account_view is the migration-014/125
    // compat shim over provider_account WHERE provider_key='google' AND
    // capabilities_json.calendar=1.
    const acctRow = this.db
      .prepare(
        `SELECT email FROM calendar_account_view WHERE email = ? LIMIT 1`,
      )
      .get(this.accountId) as { email: string } | undefined;
    if (!acctRow) return null;
    const cursorRow = this.db
      .prepare(
        `SELECT cursor
           FROM provider_sync_state
          WHERE provider_key = 'google'
            AND account_id = ?
            AND resource = 'calendar'`,
      )
      .get(this.accountId) as { cursor: string | null } | undefined;
    return { email: acctRow.email, sync_token: cursorRow?.cursor ?? null };
  }

  private applyRowsAndAdvanceCursor(
    items: CalendarEventRaw[],
    newSyncToken: string,
    fetchedAtIso: string,
  ): void {
    // UAT Gap 7: partition raw items into upserts/deletes/skips. Cancelled
    // events are tombstones — DELETE existing row (or silently drop on
    // bootstrap). Malformed (confirmed-but-no-start) events are logged + skipped
    // rather than allowed to violate migration-003 CHECK.
    const upserts: EventRow[] = [];
    const deletes: string[] = [];
    for (const raw of items) {
      const action = normalizeEvent(raw, fetchedAtIso);
      if (action.kind === 'upsert') {
        upserts.push(action.row);
      } else if (action.kind === 'delete') {
        deletes.push(action.id);
        this.logger?.debug?.(
          { scope: 'calendar-sync', event_id: action.id, reason: action.reason },
          'normalizer: cancelled event → delete',
        );
      } else {
        // skip
        if (action.reason === 'no-start') {
          this.logger?.warn(
            { scope: 'calendar-sync', event_id: action.id, reason: action.reason },
            'normalizer: confirmed event has no start field — skipping',
          );
        } else {
          this.logger?.debug?.(
            { scope: 'calendar-sync', event_id: action.id, reason: action.reason },
            'normalizer: cancelled event with no prior row → skip',
          );
        }
      }
    }

    const tx = this.db.transaction(() => {
      if (upserts.length > 0) {
        // Quick task 260523-a5w — tag each row with provider_key='google' +
        // account_id so the calendar read-path JOIN to provider_account
        // (ipc/calendar.ts:CALENDAR_LIST_EVENTS_RANGE) matches. Without
        // these two columns the read path filters every Google row out
        // (`WHERE e.provider_key IS NOT NULL AND e.account_id IS NOT NULL`).
        // recurrence_unsupported defaults to 0 for v1 — Google adapter does
        // not yet derive unsupported-recurrence detection; the Microsoft
        // adapter is the only writer that sets this bit today.
        const stmt = this.db.prepare(
          `INSERT OR REPLACE INTO calendar_event
           (id, calendar_id, summary, location, start_at_utc, end_at_utc, start_date, end_date,
            start_timezone, attendees, status, recurring_id, updated_at, fetched_at,
            etag, i_cal_uid, sequence, organizer_email, organizer_self, recurrence_json,
            recurrence_unsupported, provider_key, account_id)
           VALUES (@id, @calendar_id, @summary, @location, @start_at_utc, @end_at_utc,
                   @start_date, @end_date, @start_timezone, @attendees, @status,
                   @recurring_id, @updated_at, @fetched_at,
                   @etag, @i_cal_uid, @sequence, @organizer_email, @organizer_self, @recurrence_json,
                   0, 'google', @account_id)`,
        );
        for (const r of upserts) stmt.run({ ...r, account_id: this.accountId });
      }
      if (deletes.length > 0) {
        const del = this.db.prepare(`DELETE FROM calendar_event WHERE id = ?`);
        for (const id of deletes) del.run(id);
      }
      // Quick task 260523-a5w — cursor lives in provider_sync_state (014).
      upsertProviderSyncState(this.db, {
        providerKey: 'google',
        accountId: this.accountId,
        resource: 'calendar',
        cursor: newSyncToken,
        lastSyncAt: fetchedAtIso,
        lastError: null,
      });
      // Mirror Microsoft adapter: clear last_error + bump last_synced_at on
      // the provider_account row so the Settings UI status chip reflects
      // success without waiting on the next status poll.
      this.db
        .prepare(
          `UPDATE provider_account
              SET last_error = NULL,
                  last_error_at = NULL,
                  last_synced_at = ?,
                  status = CASE WHEN status IN ('degraded', 'needs-auth') THEN 'ok' ELSE status END
            WHERE provider_key = 'google' AND account_id = ?`,
        )
        .run(fetchedAtIso, this.accountId);
    });
    tx();
  }

  private recordAuthError(reason: 'expired' | 'revoked'): void {
    this.recordError(`token-${reason}`);
  }

  private recordError(value: string): void {
    // ALWAYS log before the DB UPDATE — even if the DB write fails the
    // original error context surfaces in the dev terminal (Problem B).
    this.logger?.warn(
      { scope: 'calendar-sync', last_error: value },
      'calendar sync recorded error',
    );
    try {
      // Quick task 260523-a5w — record error against provider_account by
      // composite key (provider_key, account_id). Token errors flip status
      // to 'needs-auth'; everything else marks the account 'degraded'. The
      // UI Settings chip + Calendar read-path JOIN filter (`status IN
      // ('ok', 'degraded')`) already understand both states.
      const isTokenError = value.startsWith('token-');
      const nextStatus = isTokenError ? 'needs-auth' : 'degraded';
      const nowIso = this.now().toISOString();
      this.db
        .prepare(
          `UPDATE provider_account
              SET status = ?,
                  last_error = ?,
                  last_error_at = ?
            WHERE provider_key = 'google' AND account_id = ?`,
        )
        .run(nextStatus, value, nowIso, this.accountId);
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
