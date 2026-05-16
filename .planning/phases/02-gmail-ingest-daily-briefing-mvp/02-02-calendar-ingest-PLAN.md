---
phase: 02-gmail-ingest-daily-briefing-mvp
plan: 02
type: execute
wave: 2
depends_on: ["02-gmail-ingest-daily-briefing-mvp/01"]
files_modified:
  - src/shared/ipc-contract.ts
  - src/main/db/migrations/embedded.ts
  - src/main/db/migrations/003_calendar.sql
  - src/main/integrations/google/calendar.ts
  - src/main/integrations/google/sync-calendar.ts
  - src/main/ipc/calendar.ts
  - src/main/ipc/index.ts
  - src/renderer/features/settings/IntegrationsSection.tsx
  - src/renderer/features/settings/StatusPanel.tsx
  - tests/setup.ts
  - tests/unit/main/integrations/google/calendar-wrapper.spec.ts
  - tests/unit/main/integrations/google/sync-calendar.spec.ts
  - tests/unit/main/integrations/google/calendar-tz.spec.ts
  - tests/unit/renderer/features/settings/IntegrationsSection-calendar.spec.tsx
autonomous: true
requirements: [CAL-01, EMAIL-07, XCUT-06, XCUT-07]
tags: [calendar, oauth-reuse, sync-token, events-list, timezone, status-panel]

must_haves:
  truths:
    - "Clicking 'Connect Calendar' in Settings → Integrations reuses Plan 02-01's `connectGoogle('calendar')` (no new OAuth code path); persists refresh_token under safeStorage googleTokens.calendar"
    - "Every 15 minutes a cron tick calls events.list(syncToken='primary'); a 410 GONE triggers full-resync (timeMin = now-1d, timeMax = now+30d, singleEvents=false), NOT a crash (Pitfall 14)"
    - "Sync engine NEVER combines syncToken with timeMin/timeMax/orderBy/q/singleEvents (Pitfall 14 — would return 400)"
    - "events.list nextSyncToken is updated in the same SQLite transaction as the row inserts (atomic cursor advance)"
    - "calendar_event row preserves BOTH `start_at_utc` (timed events) and `start_date` (YYYY-MM-DD all-day events); CHECK constraint enforces exactly-one-not-null"
    - "calendar_event.start_timezone is preserved from event.start.timeZone (XCUT-07 forward-compat)"
    - "Expired Calendar refresh token surfaces an EMAIL-07-style re-auth banner inside the Calendar row of IntegrationsSection; Gmail row + other sections continue to function (SC3)"
    - "Status panel row 'Calendar' shows sync state, queue depth, last_synced_at, last_error (XCUT-06 second half)"
    - "Two integrations now share the IntegrationsSection composite — disconnecting one does NOT affect the other (renderer-level isolation, asserted by spec case)"
  artifacts:
    - path: "src/main/integrations/google/calendar.ts"
      provides: "CalendarClient interface + googleapis-backed impl; translates Google errors (410→SyncTokenInvalidatedError, 401→TokenInvalidError)"
      exports: ["CalendarClient", "createCalendarClient", "SyncTokenInvalidatedError"]
    - path: "src/main/integrations/google/sync-calendar.ts"
      provides: "CalendarSync.tick() + fullResyncWindow() + readTodaysEvents() helper for Plan 02-04"
      exports: ["CalendarSync", "createCalendarSync", "readTodaysEvents"]
    - path: "src/main/ipc/calendar.ts"
      provides: "CALENDAR_CONNECT / CALENDAR_STATUS / CALENDAR_DISCONNECT / CALENDAR_FORCE_SYNC handlers"
      exports: ["registerCalendarHandlers"]
    - path: "src/main/db/migrations/003_calendar.sql"
      provides: "calendar_account + calendar_event tables + indices"
  key_links:
    - from: "src/main/integrations/google/sync-calendar.ts"
      to: "src/main/integrations/google/auth.ts"
      via: "getOAuth2Client('calendar') — refresh-token retrieval owned by Plan 02-01"
      pattern: "getOAuth2Client"
    - from: "src/main/ipc/calendar.ts"
      to: "src/main/lifecycle/scheduler.ts + src/main/lifecycle/powerMonitor.ts"
      via: "scheduler.cronRegistry.set('calendar-sync', ...) + queue.add(...) + powerMonitor.registerLifecycleCallbacks (API from Plan 02-01 Task 3)"
      pattern: "calendar-sync"
    - from: "src/renderer/features/settings/IntegrationsSection.tsx"
      to: "window.aria.calendarConnect / calendarStatus / calendarDisconnect"
      via: "preload IPC bridge mirroring the Gmail row added in Plan 02-01"
      pattern: "window\\.aria\\.calendar"
---

<objective>
## Phase Goal

**As a** solo-dev SMB-exec who has already connected Gmail to Aria, **I want to** OAuth-connect my primary Google Calendar with one click and have Aria continuously sync events into the encrypted local DB (incremental via syncToken, recoverable from 410), **so that** the Phase 2 briefing can render "today's calendar" alongside Gmail-derived priority email — and an expired calendar token shows an inline banner without breaking the Gmail row.

Purpose: Closes CAL-01 read portion (OAuth + incremental ingest), the Calendar half of EMAIL-07 (re-auth banner), XCUT-06 (status panel row), and XCUT-07 (timezone correctness — all-day vs timed events, original timezone preservation). Generalizes the OAuth + sync + status pattern Plan 02-01 established; demonstrates two integrations co-exist in IntegrationsSection without state coupling.

Output: Migration 003 with `calendar_account` + `calendar_event` tables, a `googleapis`-backed CalendarClient wrapper with sync-token semantics + 410 fallback + all-day vs timed event normalization, a 15-min cron registered through Phase 1's scheduler, a Calendar row in IntegrationsSection + StatusPanel, and unit tests covering the happy path, 410→full-resync, syncToken+timeMin guard (Pitfall 14), all-day-event parsing, timezone preservation, and the re-auth banner.

**Wave assignment (B2):** This plan is **wave 2** and depends on Plan 02-01 because Task 3 imports `getOAuth2Client` + `connectGoogle` + `setGoogleTokens` + `IntegrationStatusRow` from Plan 02-01, AND consumes the `powerMonitor.registerLifecycleCallbacks` API extended in Plan 02-01 Task 3. Plans 02-01 and 02-02 CANNOT run in parallel — they share `src/renderer/features/settings/IntegrationsSection.tsx`, `src/main/ipc/index.ts`, `src/shared/ipc-contract.ts`, and `src/main/lifecycle/powerMonitor.ts` (file-overlap implicit dependency).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@CLAUDE.md
@.planning/phases/02-gmail-ingest-daily-briefing-mvp/02-CONTEXT.md
@.planning/phases/02-gmail-ingest-daily-briefing-mvp/02-RESEARCH.md
@.planning/phases/01-foundation/01-02-db-passphrase-SUMMARY.md
@.planning/phases/01-foundation/01-04-llm-router-SUMMARY.md
@.planning/phases/02-gmail-ingest-daily-briefing-mvp/02-01-SUMMARY.md
@.planning/debug/sqlcipher-electron-42-abi.md
@src/shared/ipc-contract.ts
@src/main/ipc/index.ts
@src/main/db/migrations/embedded.ts
@src/main/lifecycle/scheduler.ts
@src/main/lifecycle/powerMonitor.ts
@src/main/integrations/google/auth.ts
@src/main/integrations/google/gmail.ts
@src/main/ipc/gmail.ts
@src/renderer/features/settings/IntegrationsSection.tsx
@src/renderer/features/settings/SettingsScreen.tsx

<interfaces>
<!-- New IPC channels (CHANNELS map): -->
<!-- CALENDAR_CONNECT: 'aria:calendar:connect'           () => { ok: true, email: string } | { ok: false, error: string } -->
<!-- CALENDAR_STATUS: 'aria:calendar:status'             () => CalendarIntegrationStatus -->
<!-- CALENDAR_DISCONNECT: 'aria:calendar:disconnect'     () => { ok: true } -->
<!-- CALENDAR_FORCE_SYNC: 'aria:calendar:force-sync'     () => { ok: boolean, error?: string } -->
<!-- CalendarIntegrationStatus mirrors GmailIntegrationStatus (Plan 02-01) field-by-field: -->
<!--   { connected: boolean; email?: string; lastSyncedAt?: string; lastError?: string; tokenStatus: 'ok'|'missing'|'expired'|'revoked'; queueDepth: number } -->
<!-- CalendarClient interface (injected into CalendarSync): -->
<!--   listEvents({ syncToken?, pageToken? }): Promise<{ items: CalendarEventRaw[]; nextPageToken?: string; nextSyncToken?: string }> -->
<!--   listEventsWindow({ timeMin, timeMax, singleEvents }): Promise<{ items: CalendarEventRaw[]; nextPageToken?: string }>  // syncToken-free path -->
<!--   getCalendarMetadata(): Promise<{ email: string }>  // calendarList.list 'primary' summary -->
<!-- readTodaysEvents(client, userTz): Promise<CalendarEventRaw[]>  // briefing helper — Plan 02-04 consumer -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Migration 003 (calendar tables) + ipc-contract extension + CalendarClient wrapper with 410 + 401 translation</name>
  <files>src/shared/ipc-contract.ts, src/main/db/migrations/embedded.ts, src/main/db/migrations/003_calendar.sql, src/main/integrations/google/calendar.ts, tests/setup.ts, tests/unit/main/integrations/google/calendar-wrapper.spec.ts</files>
  <read_first>
    - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-RESEARCH.md §"SQLCipher Migration 002 — Recommended Shape" (the calendar_account + calendar_event subset only)
    - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-RESEARCH.md §"Pattern: Calendar events.list with syncToken + 410 GONE Fallback"
    - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-RESEARCH.md §"Common Pitfalls" 14, 19 (syncToken combo restriction; cross-DST date parsing)
    - src/main/db/migrations/embedded.ts (current state after Plan 02-01 — append version 3 entry; do not edit version 1 or 2)
    - src/main/integrations/google/gmail.ts (Plan 02-01's wrapper pattern — mirror it for Calendar)
  </read_first>
  <behavior>
    - Migration 003 ships EXACTLY the `calendar_account` + `calendar_event` tables + two indices per RESEARCH §SQLCipher Migration 002. Briefing / news / dismissed tables ship in 004 (Plan 02-03) and 005 (Plan 02-04).
    - `CHANNELS` adds `CALENDAR_CONNECT`, `CALENDAR_STATUS`, `CALENDAR_DISCONNECT`, `CALENDAR_FORCE_SYNC`. `CalendarIntegrationStatus` interface mirrors `GmailIntegrationStatus` field-for-field.
    - `CalendarClient` interface defined per `<interfaces>` block. `createCalendarClient(oauth2Client)` wraps `google.calendar({ version: 'v3', auth })`.
    - Error translation: `410` on events.list → `SyncTokenInvalidatedError`; `401` / `invalid_grant` → `TokenInvalidError({ reason })` (reuse the class exported by Plan 02-01's auth.ts; same `invalid_grant` payload detection logic as Plan 02-01 Task 2).
    - `listEvents` MUST refuse to pass timeMin/timeMax/orderBy/q/singleEvents when `syncToken` is set (defensive: if caller mistakenly provides both, throw a typed `IncompatibleEventsListParamsError` BEFORE the API call — Pitfall 14 enforcement in code, not just in tests).
    - `listEventsWindow` is the syncToken-free path used by `readTodaysEvents` (and by 410 fallback) — it accepts `timeMin`, `timeMax`, `singleEvents`.
  </behavior>
  <action>
    Create `src/main/db/migrations/003_calendar.sql` with:
    ```
    CREATE TABLE calendar_account (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      email TEXT NOT NULL,
      calendar_id TEXT NOT NULL DEFAULT 'primary',
      sync_token TEXT,
      last_synced_at TEXT,
      last_error TEXT,
      connected_at TEXT NOT NULL
    );
    CREATE TABLE calendar_event (
      id TEXT PRIMARY KEY,
      calendar_id TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      location TEXT,
      start_at_utc TEXT,
      end_at_utc TEXT,
      start_date TEXT,
      end_date TEXT,
      start_timezone TEXT,
      attendees TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'confirmed',
      recurring_id TEXT,
      updated_at TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      CHECK ((start_at_utc IS NOT NULL) OR (start_date IS NOT NULL))
    );
    CREATE INDEX idx_calendar_event_start ON calendar_event(start_at_utc);
    CREATE INDEX idx_calendar_event_start_date ON calendar_event(start_date);
    ```
    Append `EMBEDDED_MIGRATIONS[2] = { version: 3, file: '003_calendar.sql', sql: <verbatim above> }` to `embedded.ts`.

    Extend `src/shared/ipc-contract.ts` `CHANNELS` with the four new channel literals. Export `CalendarIntegrationStatus` interface verbatim per `<interfaces>` and a `CalendarEventRow` interface mirroring the schema (used by Plan 02-04's briefing reader).

    Create `src/main/integrations/google/calendar.ts`. Define and export `CalendarClient` interface + the wrapper impl + `SyncTokenInvalidatedError` + `IncompatibleEventsListParamsError` classes. The wrapper's `listEvents({syncToken, pageToken})`:
    1. If `syncToken` is provided AND any of timeMin/timeMax/orderBy/q/singleEvents is provided → throw `IncompatibleEventsListParamsError`.
    2. Call `calendar.events.list({ calendarId: 'primary', syncToken, pageToken })`.
    3. Map response to `{ items: res.data.items ?? [], nextPageToken: res.data.nextPageToken, nextSyncToken: res.data.nextSyncToken }`.
    4. On error: `code === 410` → `SyncTokenInvalidatedError`; `code === 401` or `errors[0].reason === 'invalid_grant'` or `response.data.error === 'invalid_grant'` → `TokenInvalidError({reason:'expired'})`; otherwise re-throw.
    `listEventsWindow({timeMin, timeMax, singleEvents})` is the syncToken-free path; takes ISO strings.

    Extend `tests/setup.ts` `mockGoogleapis()` factory to ALSO return a `CalendarClientFake` shape (`listEvents`, `listEventsWindow`, `getCalendarMetadata` as `vi.fn()`).

    Create `tests/unit/main/integrations/google/calendar-wrapper.spec.ts` (the ONE `vi.mock('googleapis')` test for Calendar). Cases:
    1. `events.list` happy path returns `{ items, nextSyncToken }` correctly mapped.
    2. `events.list` throws `{ code: 410 }` → wrapper throws `SyncTokenInvalidatedError`.
    3. `events.list` throws `{ code: 401, errors: [{ reason: 'invalid_grant' }] }` → wrapper throws `TokenInvalidError({reason:'expired'})`.
    4. `listEvents({syncToken:'st-1', singleEvents: true})` → wrapper throws `IncompatibleEventsListParamsError` BEFORE any HTTP call (Pitfall 14 enforcement).
    5. Pagination: when `nextPageToken` is set on page 1, caller (sync engine — verified in Task 2) makes a second call; wrapper itself does not auto-paginate.
  </action>
  <verify>
    <automated>npm run test:unit -- tests/unit/main/integrations/google/calendar-wrapper.spec.ts tests/unit/main/db</automated>
  </verify>
  <acceptance_criteria>
    - All 5 calendar-wrapper.spec.ts cases pass.
    - `grep -c "version: 3" src/main/db/migrations/embedded.ts` returns ≥ 1.
    - `grep -c "CREATE TABLE calendar_event" src/main/db/migrations/003_calendar.sql` returns 1.
    - `grep -c "CHECK ((start_at_utc IS NOT NULL) OR (start_date IS NOT NULL))" src/main/db/migrations/003_calendar.sql` returns 1.
    - `grep -v '^\s*//' src/shared/ipc-contract.ts | grep -c "aria:calendar:"` returns 4.
    - `grep -c "IncompatibleEventsListParamsError" src/main/integrations/google/calendar.ts` returns ≥ 2 (export + throw).
    - `grep -c "SyncTokenInvalidatedError" src/main/integrations/google/calendar.ts` returns ≥ 2.
    - Migration runner (Plan 01-02 drift test) confirms 003_calendar.sql matches the embedded string byte-for-byte (modulo trim).
  </acceptance_criteria>
  <done>Migration 003 ships calendar_account + calendar_event tables, ipc-contract reserves the four Calendar channels + CalendarIntegrationStatus type, and the CalendarClient wrapper translates googleapis errors AND defensively rejects illegal syncToken+window combos before the API call.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: CalendarSync engine (tick + fullResyncWindow + readTodaysEvents) with timezone-correct event row writes</name>
  <files>src/main/integrations/google/sync-calendar.ts, tests/unit/main/integrations/google/sync-calendar.spec.ts, tests/unit/main/integrations/google/calendar-tz.spec.ts</files>
  <read_first>
    - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-RESEARCH.md §"Pattern: Calendar events.list with syncToken + 410 GONE Fallback" (full code shape — paging loop + syncToken update at end + 410 fallback)
    - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-RESEARCH.md §"Common Pitfalls" 19 (event.start.dateTime + DST)
    - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-RESEARCH.md §"Time-Zone Handling" (the table)
    - src/main/integrations/google/sync-gmail.ts (Plan 02-01 mirror pattern: scheduler.queue + db.transaction atomicity)
    - src/main/lifecycle/scheduler.ts (single-writer queue discipline; same as Plan 02-01)
  </read_first>
  <behavior>
    - `CalendarSync.tick()`:
      1. Read `calendar_account` row. If `sync_token IS NULL`, run `fullResyncWindow()` and return.
      2. Page-loop calling `client.listEvents({ syncToken, pageToken })`, accumulating items, until `nextPageToken` is undefined.
      3. On `SyncTokenInvalidatedError`, call `fullResyncWindow()` and return.
      4. On `TokenInvalidError`, write `last_error = 'token-' + reason`, re-throw.
      5. In a single `db.transaction(...)`: upsert each event row + update `calendar_account.sync_token = nextSyncToken` + `last_synced_at = now`. Atomic cursor advance.
    - `fullResyncWindow()` (M2 pinned — replaces the previous "pick simpler approach" handwaving):
      1. Call `client.listEventsWindow({ timeMin: now-1d ISO, timeMax: now+30d ISO, singleEvents: false })`. Page-loop until `nextPageToken` is undefined; collect all events into a buffer (DO NOT write incrementally — the syncToken cursor advance must remain atomic with the rows).
      2. **After the bounded backfill completes**, make ONE `client.listEvents({ pageToken: undefined })` call with NO syncToken AND NO timeMin/timeMax/singleEvents — Google returns a fresh `nextSyncToken` (and may return zero or more items; treat them as additional backfill rows). The wrapper's `listEvents` allows `syncToken=undefined`, in which case Google issues a brand-new sync token without complaining; this is the documented bootstrap path. Persist `nextSyncToken` as the cursor.
      3. In a single `db.transaction(...)`: upsert all collected rows (from step 1 + step 2) + write `calendar_account.sync_token = nextSyncToken` + `last_synced_at = now`. Atomic.
      4. On `SyncTokenInvalidatedError` during step 2 (extremely unlikely since we just bootstrapped): retry once with a fresh window call; if still fails, surface as `last_error = 'sync-token-bootstrap-failed'`.
    - `upsertEvent(db, raw)` normalization (XCUT-07):
      - If `raw.start.dateTime` is set: `start_at_utc = new Date(raw.start.dateTime).toISOString()`; `end_at_utc = new Date(raw.end.dateTime).toISOString()`; `start_timezone = raw.start.timeZone ?? null`; `start_date = null`; `end_date = null`.
      - Else if `raw.start.date` is set: `start_date = raw.start.date` (YYYY-MM-DD); `end_date = raw.end.date`; `start_at_utc = null`; `end_at_utc = null`; `start_timezone = null`.
      - `attendees = JSON.stringify(raw.attendees ?? [])`; `status = raw.status ?? 'confirmed'`; `recurring_id = raw.recurringEventId ?? null`; `updated_at = raw.updated`; `fetched_at = now`.
      - `summary` and `location` may be missing on Google events; default to '' and null respectively. Cancelled events (`status === 'cancelled'`) STILL upsert (so subsequent syncs see them gone-from-cache via downstream filters) per Calendar API guidance.
    - `readTodaysEvents(client, userTz)` is the Plan 02-04 helper (lives here for cohesion):
      1. Compute `today` in `userTz` via `Intl.DateTimeFormat('en-CA', { timeZone: userTz }).format(new Date())` → `YYYY-MM-DD`.
      2. Compute `timeMin` = start of that day in `userTz` as UTC ISO; `timeMax` = start of next day in `userTz` as UTC ISO. Use a small helper that constructs a `Date` from `YYYY-MM-DDT00:00:00` + the IANA offset (calculated via the `Intl.DateTimeFormat` longOffset format pattern).
      3. Call `client.listEventsWindow({ timeMin, timeMax, singleEvents: true })` — fresh from API (NOT the cache) so recurring events expand correctly. Returns the raw events.
  </behavior>
  <action>
    Create `src/main/integrations/google/sync-calendar.ts` exporting `class CalendarSync` (constructor `{ db, client, scheduler, logger }`, methods `tick()` + `fullResyncWindow()`) and the standalone `readTodaysEvents(client, userTz)` function. Every Google API call AND every DB write goes through `scheduler.queue.add(...)`. The full transaction (rows + sync_token) is one `db.transaction(() => { ... })()`.

    Create `tests/unit/main/integrations/google/sync-calendar.spec.ts` using `CalendarClientFake` + real temp SQLCipher DB (via Plan 01-02 `openDb({ runMigrationsOnOpen: true })`). Cases:
    1. **First tick, no sync_token** → fullResyncWindow path; fake `listEventsWindow` returns 2 timed events + 1 all-day event; fake `listEvents({pageToken: undefined})` (M2 step 2) returns `{ items: [], nextSyncToken: 'st-fresh' }`; after tick, `calendar_event` has 3 rows; `sync_token === 'st-fresh'`.
    2. **Incremental tick happy path** → seed `sync_token='st-1'`; `listEvents` returns 1 new event + `nextSyncToken='st-2'`; after tick, 1 new row, `sync_token='st-2'`.
    3. **Multi-page** → `listEvents` returns page 1 with `nextPageToken='p2'` (1 event), page 2 with no `nextPageToken` (1 event) + `nextSyncToken='st-3'`; after tick, 2 new rows, `sync_token='st-3'`. Spy: `listEvents` called exactly twice.
    4. **SyncTokenInvalidatedError → fullResyncWindow** → seed `sync_token='old'`; `listEvents` throws `SyncTokenInvalidatedError`; `listEventsWindow` returns 1 event; subsequent `listEvents({pageToken: undefined})` returns `nextSyncToken='st-new'`; tick recovers → 1 row + `sync_token='st-new'`.
    5. **TokenInvalidError** → `listEvents` throws `TokenInvalidError({reason:'expired'})`; tick → `calendar_account.last_error='token-expired'`; tick re-throws.
    6. **Atomicity** → forced upsert failure mid-transaction → neither rows nor sync_token advanced.
    7. **Cancelled event** → `listEvents` returns `{ id:'ev1', status:'cancelled', start:{dateTime:'...'}, end:{...} }` → row IS upserted with `status='cancelled'`.
    8. **Queue routing** → spy on `scheduler.queue.add` → called ≥ once for the API call AND ≥ once for the DB transaction.
    9. **M2 bootstrap call shape** → in case 1, assert the second `listEvents` call was invoked with `{ pageToken: undefined }` AND NO `syncToken` AND NO `timeMin`/`timeMax`/`singleEvents` arguments (the bootstrap-cursor call pinned by M2).

    Create `tests/unit/main/integrations/google/calendar-tz.spec.ts` covering XCUT-07 explicitly. Cases:
    1. **Timed event** with `start.dateTime='2026-05-20T09:00:00+01:00'`, `start.timeZone='Africa/Lagos'` → row has `start_at_utc='2026-05-20T08:00:00.000Z'`, `start_timezone='Africa/Lagos'`, `start_date=null`.
    2. **All-day event** with `start.date='2026-05-20'`, `end.date='2026-05-21'` → row has `start_date='2026-05-20'`, `start_at_utc=null`, `start_timezone=null`. CHECK constraint passes (start_date IS NOT NULL).
    3. **CHECK constraint** rejects a row where BOTH `start_at_utc` and `start_date` are null (manual INSERT attempt → SQLite throws constraint failure).
    4. **readTodaysEvents in Lagos TZ (Africa/Lagos, UTC+1)** on 2026-05-20 → calls `listEventsWindow` with `timeMin='2026-05-19T23:00:00.000Z'`, `timeMax='2026-05-20T23:00:00.000Z'`.
    5. **readTodaysEvents in New York TZ (America/New_York)** on 2026-05-20 → timeMin/timeMax adjusted by NY offset (handles whichever offset is current at the test date — DST robust).
    6. **All-day event displayed on the local day** — given an all-day event with `start_date='2026-05-20'` and user in `Africa/Lagos`, the briefing helper that filters "today" treats `start_date === today` as on-day regardless of UTC midnight crossings (Pitfall 19 mitigation).
  </action>
  <verify>
    <automated>npm run test:unit -- tests/unit/main/integrations/google/sync-calendar.spec.ts tests/unit/main/integrations/google/calendar-tz.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - All 9 sync-calendar.spec.ts cases pass (including the new M2 bootstrap-shape case).
    - All 6 calendar-tz.spec.ts cases pass.
    - `grep -c "SyncTokenInvalidatedError" src/main/integrations/google/sync-calendar.ts` returns ≥ 1.
    - `grep -c "scheduler.queue.add\\|queue\\.add" src/main/integrations/google/sync-calendar.ts` returns ≥ 2.
    - `grep -c "db.transaction" src/main/integrations/google/sync-calendar.ts` returns ≥ 1.
    - `grep -c "start_timezone" src/main/integrations/google/sync-calendar.ts` returns ≥ 1.
    - `grep -c "singleEvents: true" src/main/integrations/google/sync-calendar.ts` returns ≥ 1 (in readTodaysEvents — fresh window read).
    - `grep -c "singleEvents: false" src/main/integrations/google/sync-calendar.ts` returns ≥ 1 (in fullResyncWindow — syncToken-compatible).
    - `grep -v '^[[:space:]]*//' src/main/integrations/google/sync-calendar.ts | grep -c "INSERT INTO calendar_event\\|INSERT OR REPLACE INTO calendar_event"` returns ≥ 1.
  </acceptance_criteria>
  <done>CalendarSync owns the sync_token cursor atomically, recovers from 410, never combines syncToken with timeMin (Pitfall 14 caught both in tests AND by the wrapper's defensive throw), preserves all-day vs timed event shape (CHECK constraint + spec), preserves event start_timezone for forward-compat, exposes the `readTodaysEvents` helper Plan 02-04 will consume, and uses the M2-pinned bootstrap call shape after bounded backfill.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Calendar IPC handlers + 15-min cron + powerMonitor pause/resume + Settings Calendar row + StatusPanel extension</name>
  <files>src/main/ipc/calendar.ts, src/main/ipc/index.ts, src/renderer/features/settings/IntegrationsSection.tsx, src/renderer/features/settings/StatusPanel.tsx, tests/unit/renderer/features/settings/IntegrationsSection-calendar.spec.tsx</files>
  <read_first>
    - src/main/ipc/gmail.ts (Plan 02-01 — mirror its handler shape, cron registration, powerMonitor.registerLifecycleCallbacks hook)
    - src/main/ipc/index.ts (registerHandlers chain — append registerCalendarHandlers as the 8th call; Phase 1 baseline 6 + Plan 02-01 Gmail = 7, this plan adds Calendar = 8)
    - src/renderer/features/settings/IntegrationsSection.tsx (Plan 02-01's Gmail row — add a Calendar row as a sibling; they share the section but NOT state)
    - src/renderer/features/settings/StatusPanel.tsx (Plan 02-01's IntegrationStatusRow — add a `kind="calendar"` variant)
    - src/main/lifecycle/powerMonitor.ts (registerLifecycleCallbacks API extended by Plan 02-01 Task 3 — this plan consumes it for calendar-sync)
    - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-CONTEXT.md "Expired token UX (EMAIL-07)"
  </read_first>
  <behavior>
    - `registerCalendarHandlers(ipcMain, deps)` registers four channels with semantics symmetric to Plan 02-01's Gmail handlers:
      - `CALENDAR_CONNECT`: invokes pre-OAuth disclosure modal flow → `connectGoogle('calendar')` → write `calendar_account` row → enqueue `CalendarSync.tick()` (triggers fullResyncWindow because sync_token is NULL).
      - `CALENDAR_STATUS`: returns `CalendarIntegrationStatus` with the same fields + the same `tokenStatus` derivation rules as Gmail.
      - `CALENDAR_DISCONNECT`: stops `calendar-sync` cron, `clearGoogleTokens('calendar')`, deletes `calendar_account` + truncates `calendar_event`.
      - `CALENDAR_FORCE_SYNC`: enqueue tick; return when done.
    - On main startup (in `registerCalendarHandlers`), when a `calendar_account` row exists, register cron `'*/15 * * * *'` calling `CalendarSync.tick()`. Use `powerMonitor.registerLifecycleCallbacks({ onSuspend: () => cronRegistry.get('calendar-sync')?.stop(), onResume: () => cronRegistry.get('calendar-sync')?.start() })` (no back-fire on resume — reuses the API extended in Plan 02-01 Task 3).
    - `IntegrationsSection.tsx` gains a Calendar row beneath the Gmail row. Same UI vocabulary (connect / disconnect / sync now / re-auth banner). The two rows poll INDEPENDENTLY — disconnecting Gmail does NOT clear the Calendar row's state (asserted by spec case 4).
    - `StatusPanel.tsx` gains `<IntegrationStatusRow kind="calendar" />` mirroring the Gmail variant.
    - The pre-OAuth disclosure modal copy adapts: *"Aria will read your calendar only — never create, modify, or send events. Calendar write capability arrives in a later release."*
    - EMAIL-07 banner copy variant for Calendar: *"Aria's access to Google Calendar has expired. Re-connect to resume syncing. Gmail and other integrations are unaffected."* — the SC3 phrasing is mirrored.
  </behavior>
  <action>
    Create `src/main/ipc/calendar.ts` exporting `registerCalendarHandlers(ipcMain, deps)` with the same construction-then-registration shape as Plan 02-01's `src/main/ipc/gmail.ts`. Cron key = `'calendar-sync'`; cron expression = `'*/15 * * * *'`. The cron callback wraps `await sync.tick()` in `try/catch logger.warn` — never crash the app.

    Update `src/main/ipc/index.ts` `registerHandlers` to append `registerCalendarHandlers` as the 8th call (after Plan 02-01's `registerGmailHandlers`).

    Update `src/renderer/features/settings/IntegrationsSection.tsx` to render a Calendar row beneath the existing Gmail row. The Calendar-row component MUST hold its own React state (no shared store with Gmail) so the disconnect-isolation spec case passes. Reuse the pre-OAuth disclosure modal component but with the Calendar-specific copy variant.

    Update `src/renderer/features/settings/StatusPanel.tsx` to render `<IntegrationStatusRow kind="calendar" />` immediately below the Gmail row.

    Create `tests/unit/renderer/features/settings/IntegrationsSection-calendar.spec.tsx`. Cases:
    1. **Disconnected (Calendar)**: `calendarStatus` returns `{ connected: false, tokenStatus: 'missing', queueDepth: 0 }` → "Connect Calendar" button visible, no banner.
    2. **Connected (Calendar, ok)** → renders email + "Sync now" + "Disconnect"; no banner.
    3. **Expired token (Calendar)** → banner with EXACT copy "Aria's access to Google Calendar has expired. Re-connect to resume syncing. Gmail and other integrations are unaffected." + "Reconnect" button.
    4. **Cross-row isolation (SC3 mechanic)** → Gmail state `{ connected:true, tokenStatus:'ok' }` AND Calendar state `{ connected:true, tokenStatus:'expired' }` rendered together: Calendar banner visible, Gmail row NOT showing any banner, Gmail "Sync now" button still enabled. Then simulate a Calendar `Disconnect` action → assert Gmail row state is UNCHANGED in the next render (no re-render reset).
    5. **Pre-OAuth modal (Calendar)** → "Connect Calendar" click renders modal with Calendar-specific disclosure copy; "Continue" calls `calendarConnect` once.
  </action>
  <verify>
    <automated>npm run test:unit -- tests/unit/renderer/features/settings/IntegrationsSection-calendar.spec.tsx tests/unit/main/integrations && npm run typecheck</automated>
  </verify>
  <acceptance_criteria>
    - All 5 IntegrationsSection-calendar.spec.tsx cases pass.
    - `grep -c "registerCalendarHandlers" src/main/ipc/index.ts` returns ≥ 1.
    - `grep -cE '^\s*register[A-Za-z]+Handlers\(ipcMain' src/main/ipc/index.ts` returns 8 (Phase 1 baseline 6 + Gmail + Calendar).
    - `grep -c "'\\*/15 \\* \\* \\* \\*'" src/main/ipc/calendar.ts` returns ≥ 1.
    - `grep -c "'calendar-sync'" src/main/ipc/calendar.ts` returns ≥ 1.
    - `grep -c "registerLifecycleCallbacks" src/main/ipc/calendar.ts` returns ≥ 1.
    - `grep -c "Gmail and other integrations are unaffected" src/renderer/features/settings/IntegrationsSection.tsx` returns ≥ 1 (Calendar banner SC3 copy).
    - `grep -c "Calendar and other integrations are unaffected" src/renderer/features/settings/IntegrationsSection.tsx` returns ≥ 1 (Gmail banner SC3 copy — from Plan 02-01 still present).
    - `grep -c "Aria will read your calendar only" src/renderer/features/settings/IntegrationsSection.tsx` returns ≥ 1 (Calendar pre-OAuth disclosure).
    - `npm run typecheck` exits 0.
  </acceptance_criteria>
  <done>Calendar integration is wired end-to-end symmetric to Gmail: connect/disconnect/status/force-sync IPC, 15-min cron + powerMonitor pause/resume via registerLifecycleCallbacks (no back-fire on resume — XCUT-01 partial), Settings → Integrations now shows two cleanly-isolated rows, StatusPanel surfaces calendar sync state + queue depth + last error, and the SC3 isolation mechanic is verified at the renderer level.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Main → Google Calendar API | TLS; access_token short-lived; refresh_token in safeStorage (reused from Plan 02-01) |
| Main → SQLCipher calendar_event | Whole-DB AES; event bodies are summaries only — no meeting body content |
| Renderer ↔ Main calendar handlers | Refresh tokens never cross IPC; renderer sees only CalendarIntegrationStatus |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-02-01 | Information Disclosure | OAuth refresh_token leak | mitigate (HIGH) | Reuses Plan 02-01 safeStorage googleTokens.calendar subtree; identical guarantees (Pitfall 13) |
| T-02-02-02 | Tampering | syncToken combined with timeMin → API 400, sync stalls silently | mitigate (HIGH; Pitfall 14) | Wrapper throws `IncompatibleEventsListParamsError` BEFORE the HTTP call; spec case 4 enforces |
| T-02-02-03 | Information Disclosure | Event attendees / locations in DB backup | accept (LOW for Phase 2) | Whole-DB encryption; backups are encrypted; Phase 2 stores only what the user already has on Google. |
| T-02-02-04 | Tampering | sync_token rolled back leaves DB with phantom events | mitigate (MEDIUM) | `db.transaction(...)` wraps rows + sync_token; sync-calendar.spec case 6 enforces |
| T-02-02-05 | Denial of Service | 410 storm on broken syncToken → fullResync loop | mitigate (LOW) | scheduler.queue concurrency=1 + 15-min cadence makes a loop self-throttling; last_error surfaces in StatusPanel |
| T-02-02-06 | Repudiation | Cross-tz event displayed wrong, user blames Aria | mitigate (HIGH; XCUT-07) | start_timezone column preserved; calendar-tz.spec cases enforce; whole-hour-only briefing picker in Plan 02-04 sidesteps DST |
</threat_model>

<verification>
- All three `<automated>` commands pass on Windows 11 with Electron 41.6.1 + patched SQLCipher
- Manual: after Gmail is connected (Plan 02-01), clicking "Connect Calendar" → pre-OAuth modal → consent → loopback receives code → Calendar row shows the connected email within ~5 seconds → after ≤ 15 minutes (or "Sync now") `SELECT COUNT(*) FROM calendar_event` matches the user's near-term event count
- Manual: disconnect Calendar while Gmail is connected → Gmail row remains untouched (Sync now button still works) — SC3 mechanic
- Phase-1 regression: all Phase-1 IPC tests still pass; Plan 02-01 tests still pass (`npm run test:unit`)
</verification>

<success_criteria>
Plan 02-02 closes CAL-01 read portion, the Calendar half of EMAIL-07, the Calendar half of XCUT-06, and the entirety of XCUT-07 (timezone correctness across the ingest path). Contributes to ROADMAP SC3 (expired-token banner; other features unaffected — both halves now verified). The "calendar visible in briefing" surface (SC2) lands in Plan 02-04.
</success_criteria>

<out_of_scope>
- News sources (Plan 02-03)
- Briefing UI + briefing engine (Plan 02-04)
- Daily briefing cron + briefing missed-on-sleep "Generate now?" affordance (Plan 02-04)
- Calendar write capability + recurring-event expansion + smart-scheduling (Phase 4)
- Outlook calendar (Phase 5)
- Multi-calendar (non-`primary`) support (Phase 5)
- Cross-tz event display per-event (Phase 5 — `start_timezone` column reserved now)
</out_of_scope>

<handoff>
Plan 02-04 (Briefing engine) imports `readTodaysEvents(client, userTz)` from `src/main/integrations/google/sync-calendar.ts` as the today-calendar candidate gatherer. The briefing schedule registers its own `'briefing'` cron entry alongside `'gmail-sync'` (Plan 02-01) and `'calendar-sync'` (this plan) in `scheduler.cronRegistry`, hooked into the SAME `powerMonitor.registerLifecycleCallbacks` API.
</handoff>

<output>
After completion, create `.planning/phases/02-gmail-ingest-daily-briefing-mvp/02-02-SUMMARY.md` describing:
- Sample calendar_event rows from a real dogfood connect (timed + all-day)
- Confirmation that the eight handler-registration functions are wired in order
- Confirmation Calendar EMAIL-07 banner copy is the exact locked string
- Confirmation `start_timezone` is populated on every row from a real event source
- Confirmation cross-row isolation works in a manual run (disconnect Calendar; Gmail unaffected)
- Confirmation the M2 bootstrap-cursor call (`listEvents({pageToken: undefined})` post-backfill) returns a usable nextSyncToken in production
- Open issues to forward to Plan 02-03 / 02-04
</output>
</content>
</invoke>