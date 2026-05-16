---
phase: 02-gmail-ingest-daily-briefing-mvp
plan: 02
subsystem: integrations/google + ipc + renderer/settings + db/migrations
tags: [calendar, oauth-reuse, sync-token, events-list, timezone, status-panel, email-07-banner]
requires: [02-01-gmail-ingest]
provides: [createCalendarClient, CalendarSync, createCalendarSync, readTodaysEvents, computeTodayBoundsUtc, registerCalendarHandlers]
affects:
  - src/shared/ipc-contract.ts
  - src/main/db/migrations/embedded.ts
  - src/main/ipc/index.ts
  - src/renderer/features/settings/IntegrationsSection.tsx
  - src/renderer/features/settings/StatusPanel.tsx
  - tests/setup.ts
  - tests/unit/main/db/migrations.spec.ts
  - tests/unit/renderer/features/settings/IntegrationsSection.spec.tsx
tech_added: [migration 003_calendar.sql]
key_files_created:
  - src/main/db/migrations/003_calendar.sql
  - src/main/integrations/google/calendar.ts
  - src/main/integrations/google/sync-calendar.ts
  - src/main/ipc/calendar.ts
  - tests/unit/main/integrations/google/calendar-wrapper.spec.ts
  - tests/unit/main/integrations/google/sync-calendar.spec.ts
  - tests/unit/main/integrations/google/calendar-tz.spec.ts
  - tests/unit/renderer/features/settings/IntegrationsSection-calendar.spec.tsx
decisions:
  - Calendar reuses Plan 02-01's connectGoogle('calendar') wholesale — no second OAuth code path
  - sync_token cursor advance is atomic with row upserts (single db.transaction)
  - fullResyncWindow uses M2 two-step bootstrap: bounded listEventsWindow then ONE listEvents({pageToken:undefined}) for the fresh nextSyncToken
  - listEvents wrapper defensively throws IncompatibleEventsListParamsError BEFORE any HTTP call when caller mixes syncToken with timeMin/timeMax/orderBy/q/iCalUID/singleEvents (Pitfall 14 enforced in code, not docs)
  - calendar_event schema preserves BOTH start_at_utc (timed) AND start_date (all-day) with a CHECK constraint; start_timezone column reserved for forward-compat (XCUT-07)
  - IntegrationsSection refactored to per-row components with INDEPENDENT React state — SC3 cross-row isolation is now structural rather than coincidental
  - Single shared SchedulerHandle wired into both registerGmailHandlers and registerCalendarHandlers so the concurrency=1 queue invariant holds across both crons
completed: 2026-05-16
---

# Phase 2 Plan 02: Calendar Ingest Summary

One-liner: Read-only Google Calendar OAuth (reuses Plan 02-01's connectGoogle), bounded 1d-back/30d-forward backfill + 15-min syncToken-driven incremental sync, atomic cursor advance, defensive Pitfall-14 enforcement in the wrapper, XCUT-07-correct all-day vs timed event normalization with original timezone preserved, EMAIL-07-style Calendar re-auth banner with SC3 cross-row isolation verified at the renderer level, and a StatusPanel Calendar row.

## What Shipped

- **Migration 003** (`calendar_account`, `calendar_event` with the exactly-one-not-null CHECK + two indices) appended to `EMBEDDED_MIGRATIONS`. The migrations test now asserts `[1, 2, 3]` and `user_version === 3`.
- **`ipc-contract.ts`** reserves `CALENDAR_CONNECT / STATUS / DISCONNECT / FORCE_SYNC` channels + `CalendarIntegrationStatus` (mirrors GmailIntegrationStatus field-for-field) + `CalendarEventRow` (the migration-003 row shape for Plan 02-04's briefing reader).
- **`CalendarClient` wrapper** (`src/main/integrations/google/calendar.ts`) translates googleapis Calendar v3 errors to domain types — `410 / fullSyncRequired → SyncTokenInvalidatedError`, `invalid_grant → TokenInvalidError({reason})` — AND defensively throws `IncompatibleEventsListParamsError` BEFORE any HTTP call when a caller mixes `syncToken` with `timeMin/timeMax/orderBy/q/iCalUID/singleEvents` (Pitfall 14 enforced in code).
- **`CalendarSync` engine** (`src/main/integrations/google/sync-calendar.ts`):
  - `tick()` page-loops `listEvents({syncToken, pageToken})`, recovers from 410 via `fullResyncWindow()`, surfaces TokenInvalidError by writing `last_error = 'token-' + reason` and re-throwing.
  - `fullResyncWindow()` uses the M2-pinned two-step bootstrap: bounded `listEventsWindow({timeMin: now-1d, timeMax: now+30d, singleEvents: false})` page-looped into a buffer, then ONE `listEvents({pageToken: undefined})` with no syncToken AND no window args (the documented bootstrap path that yields a fresh `nextSyncToken`).
  - `toEventRow()` normalizes Google's `start.dateTime` vs `start.date` to the migration-003 column pair (start_at_utc | start_date — never both); `start_timezone` preserved verbatim from `event.start.timeZone`.
  - `readTodaysEvents(client, userTz)` + `computeTodayBoundsUtc(userTz, now)` — the helpers Plan 02-04 will consume. DST-robust IANA timezone math via `Intl.DateTimeFormat` formatToParts.
  - Every Google API call AND every DB write goes through `scheduler.queue.add(...)`; row + sync_token writes are ONE `db.transaction` (atomic cursor advance — T-02-02-04).
- **Calendar IPC handlers** (`src/main/ipc/calendar.ts`) mirror the Gmail handlers field-for-field — `CALENDAR_CONNECT` runs the OAuth flow + INSERT-OR-REPLACE `calendar_account`, kicks off bootstrap tick + cron. `CALENDAR_STATUS` derives `tokenStatus` from row + token presence + queue depth. `CALENDAR_DISCONNECT` stops cron + `clearGoogleTokens('calendar')` + truncates both calendar tables. `CALENDAR_FORCE_SYNC` runs manual tick.
- **15-min cron + suspend/resume**: `'*/15 * * * *'` stored under `scheduler.cronRegistry['calendar-sync']`; `registerLifecycleCallbacks({onSuspend, onResume})` stops/starts the cron entry (XCUT-01 partial — no back-fire on resume because we `start()` an already-stopped task).
- **Single shared SchedulerHandle**: `src/main/ipc/index.ts` lazily constructs ONE `SchedulerHandle` via `registerScheduler(logger)` and wires it into BOTH `registerGmailHandlers` and `registerCalendarHandlers` so the `concurrency=1` p-queue invariant holds across both crons in production. Previously each handler-block would have constructed its own queue.
- **IntegrationsSection refactor**: split into `GmailRow` + `CalendarRow` sibling components, each owning its own React state (status / modal / busy). Disconnecting one row provably does NOT reset the other — SC3 mechanic is now structural rather than emergent from a shared store.
- **Locked banner copy** (exported for spec assertions):
  - Calendar expired: `"Aria's access to Google Calendar has expired. Re-connect to resume syncing. Gmail and other integrations are unaffected."`
  - Calendar revoked variant: `"Aria's access to Google Calendar was revoked. Re-connect to resume syncing. Gmail and other integrations are unaffected."`
  - Calendar pre-OAuth disclosure: `"Aria will read your calendar only — never create, modify, or send events. Calendar write capability arrives in a later release."`
- **StatusPanel** gains `<IntegrationStatusRow kind="calendar" />` immediately below the Gmail row. The component is now generic over `'gmail' | 'calendar'`, calling the right `window.aria.*Status` per kind.

## Wire Confirmation

`src/main/ipc/index.ts` now registers **eight** handler functions in order: Onboarding, Backup, Secrets, Ollama, Ask, Diagnostics, Gmail, Calendar. The matching grep (`grep -cE '^\s*register[A-Za-z]+Handlers\(ipcMain' src/main/ipc/index.ts`) returns 8.

The handler-count invariant (`tests/unit/main/ipc/index.spec.ts` asserting `handlers.size === Object.keys(CHANNELS).length`) is preserved automatically because both sides grew by 4 channels (20 → 24 channels, 16 → 20 handlers registered before this plan + 4 calendar = 24 / 24).

## Tests

| File | Cases | Result |
|---|---|---|
| `tests/unit/main/integrations/google/calendar-wrapper.spec.ts` | 5 (happy path, 410, invalid_grant→expired, Pitfall-14 defensive throw, pagination) | 5/5 ✓ |
| `tests/unit/main/integrations/google/sync-calendar.spec.ts` | 9 (first-tick bootstrap, incremental, multi-page, 410→full-resync, TokenInvalidError, atomicity, cancelled, queue routing, M2 bootstrap call shape) | 9/9 ✓ |
| `tests/unit/main/integrations/google/calendar-tz.spec.ts` | 6 logical cases (8 assertions: 3 nested DB cases for CHECK constraint behavior on real SQLCipher) | 8/8 ✓ |
| `tests/unit/renderer/features/settings/IntegrationsSection-calendar.spec.tsx` | 5 (disconnected, connected-ok, expired-banner, SC3 isolation, pre-OAuth modal) | 5/5 ✓ |
| Regression: 02-01 + Phase 1 surfaces | — | 132/132 ✓ (was 105 baseline + 27 new from this plan) |

Typecheck (`npm run typecheck`): clean (both `tsconfig.json` and `tsconfig.node.json`).

## Acceptance Criteria

| Criterion | Result |
|---|---|
| `grep -c "version: 3" src/main/db/migrations/embedded.ts` ≥ 1 | 1 ✓ |
| `grep -c "CREATE TABLE calendar_event" 003_calendar.sql` == 1 | 1 ✓ |
| CHECK constraint literal present in 003_calendar.sql | 1 ✓ |
| `grep -c "aria:calendar:"` in ipc-contract.ts (excl. comments) == 4 | 4 ✓ |
| `grep -c "IncompatibleEventsListParamsError" calendar.ts` ≥ 2 | 4 ✓ |
| `grep -c "SyncTokenInvalidatedError" calendar.ts` ≥ 2 | 4 ✓ |
| `grep -c "SyncTokenInvalidatedError" sync-calendar.ts` ≥ 1 | 4 ✓ |
| `scheduler.queue.add` / `queue.add` in sync-calendar.ts ≥ 2 | 7 ✓ |
| `db.transaction` in sync-calendar.ts ≥ 1 | 4 ✓ |
| `start_timezone` in sync-calendar.ts ≥ 1 | 5 ✓ |
| `singleEvents: true` in sync-calendar.ts ≥ 1 (readTodaysEvents) | 2 ✓ |
| `singleEvents: false` in sync-calendar.ts ≥ 1 (fullResyncWindow) | 2 ✓ |
| `INSERT OR REPLACE INTO calendar_event` in sync-calendar.ts ≥ 1 | 1 ✓ |
| `registerCalendarHandlers` referenced in ipc/index.ts ≥ 1 | 2 ✓ |
| `register*Handlers(ipcMain` count in ipc/index.ts == 8 | 8 ✓ |
| `'*/15 * * * *'` literal in ipc/calendar.ts ≥ 1 | 1 ✓ |
| `'calendar-sync'` literal in ipc/calendar.ts ≥ 1 | 8 ✓ |
| `registerLifecycleCallbacks` in ipc/calendar.ts ≥ 1 | 3 ✓ |
| Calendar EMAIL-07 banner SC3 copy in IntegrationsSection.tsx ≥ 1 | 2 ✓ (expired + revoked variants) |
| Gmail EMAIL-07 banner SC3 copy still present ≥ 1 | 2 ✓ |
| Calendar pre-OAuth disclosure copy ≥ 1 | 1 ✓ |
| `npm run typecheck` exits 0 | ✓ |

## Sample calendar_event Rows (from toEventRow normalization tests)

Timed event input (Africa/Lagos, +01:00):
```
{ id: 'ev-timed', summary: 'Lagos sync',
  start: { dateTime: '2026-05-20T09:00:00+01:00', timeZone: 'Africa/Lagos' },
  end:   { dateTime: '2026-05-20T10:00:00+01:00', timeZone: 'Africa/Lagos' } }
```
→ row: `start_at_utc='2026-05-20T08:00:00.000Z'`, `start_timezone='Africa/Lagos'`, `start_date=null`, `end_at_utc='2026-05-20T09:00:00.000Z'`.

All-day event input:
```
{ id: 'ev-allday', summary: 'Holiday',
  start: { date: '2026-05-20' }, end: { date: '2026-05-21' } }
```
→ row: `start_date='2026-05-20'`, `end_date='2026-05-21'`, `start_at_utc=null`, `start_timezone=null`. The migration-003 CHECK constraint accepts the row (start_date IS NOT NULL).

CHECK constraint negative case (real SQLCipher DB via `openDb` + `runMigrations`):
```sql
INSERT INTO calendar_event (..., start_at_utc, ..., start_date, ...)
VALUES (..., NULL, ..., NULL, ...)
```
→ throws `CHECK constraint failed` at the DB layer (case 3 of calendar-tz.spec.ts).

## Deviations from Plan

### Auto-fixed Issues

1. **[Rule 3 — Blocking] Single shared `SchedulerHandle` across Gmail + Calendar handler registrations**
   - **Found during:** Task 3 wiring of `registerCalendarHandlers` into `src/main/ipc/index.ts`.
   - **Issue:** The Plan-02-01 ipc/index.ts pattern constructed a `SchedulerHandle` inline for `registerGmailHandlers` if the caller omitted `deps.scheduler`. Naive copy-paste would have spawned a SECOND `SchedulerHandle` for Calendar — two p-queues with concurrency=1 each, defeating the cross-cron serialization invariant the p-queue concurrency choice exists to enforce.
   - **Fix:** introduced a lazy `getScheduler()` helper that constructs ONE shared handle on first use and reuses it for both registrations. Caller-supplied `deps.scheduler` still takes precedence.
   - **Commit:** d50ce58.

2. **[Rule 3 — Blocking] Gmail-row test would have crashed once CalendarRow polls `window.aria.calendarStatus`**
   - **Found during:** Task 3 verification before the renderer suite ran.
   - **Issue:** `tests/unit/renderer/features/settings/IntegrationsSection.spec.tsx` (Plan 02-01) installed a `window.aria` stub with only `gmail*` methods. After CalendarRow was added to the section, mounting the component in the existing spec would call `window.aria.calendarStatus()` → `undefined is not a function`.
   - **Fix:** added `calendarStatus / calendarConnect / calendarDisconnect / calendarForceSync` stubs (calendarStatus defaults to disconnected) to the existing spec's `installAria` so all six Plan 02-01 cases continue to assert Gmail-only behaviors against a stable Calendar baseline.
   - **Commit:** d50ce58.

3. **[Rule 1 — Test correctness] migrations.spec.ts assertion `[1, 2]` → `[1, 2, 3]`**
   - **Found during:** Task 1 verification.
   - **Issue:** The Plan-02-01 migrations spec was hard-coded to assert two applied migrations + `user_version === 2`. With migration 003 in place, both literals had to advance.
   - **Fix:** updated to `[1, 2, 3]` and `user_version === 3`. This is test-only and matches the Plan-02-01 precedent (Plan 02-01 advanced from `[1]` → `[1, 2]`).
   - **Commit:** 3bc0a10.

No Rule-4 architectural decisions arose during this plan. All discoveries were correctness/wiring fixes inside the established Plan-02-01 patterns.

### TDD Gate Compliance

All three tasks were `tdd="true"`. Tests + impl shipped in single per-task commits rather than RED-then-GREEN split commits (consistent with Plan 02-01 Task 3's documented compromise). All listed acceptance-criteria tests pass without modification post-implementation.

## Known Stubs

None. The Calendar row is fully wired end-to-end: connect → bootstrap fullResyncWindow → 15-min cron → suspend/resume → status polling → disconnect cleanup. `readTodaysEvents` is exported but not yet consumed — that's the documented Plan 02-04 handoff.

## Deferred Items (out of scope for 02-02)

None new. The existing Phase 1 ABI dual-build pipeline (resolved 2026-05-16) covered every test in this plan including the three real-SQLCipher CHECK-constraint cases.

## Authentication Gates

Reuses Plan 02-01's OAuth config — `.env.local` with `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET`. The `connectGoogle` SCOPES map already includes `calendar.readonly` (added in Plan 02-01). No new GCP credential work needed.

Real end-to-end Calendar dogfood (clicking Connect Calendar in the running Electron app) is a Phase-2 manual verification step the user will run; the wiring is exercised end-to-end in unit tests but cannot be automated without spinning up Electron + a real GCP test-mode session.

## Self-Check

| Claim | Verified |
|-------|----------|
| `src/main/integrations/google/{calendar,sync-calendar}.ts` exist | yes (committed in c3faeca) |
| `src/main/ipc/calendar.ts` exists | yes (committed in d50ce58) |
| `src/main/db/migrations/003_calendar.sql` exists | yes (committed in 3bc0a10) |
| 8 register*Handlers calls in `src/main/ipc/index.ts` | yes |
| 4 `aria:calendar:` CHANNELS entries in ipc-contract.ts | yes |
| Calendar EMAIL-07 banner locked-copy verbatim in IntegrationsSection | yes (expired + revoked variants) |
| Calendar pre-OAuth disclosure copy verbatim in IntegrationsSection | yes |
| `registerLifecycleCallbacks` consumed by calendar-sync | yes |
| `npm run typecheck` exits 0 | yes |
| Full unit suite 132/132 pass | yes (was 105 + 27 new for 02-02) |
| Migration test asserts `[1, 2, 3]` + `user_version === 3` | yes |
| ROADMAP.md plan box ticked | yes |
| STATE.md completed_plans bumped to 7 | yes |

## Self-Check: PASSED

## Open Issues to Forward

- **02-03 (News / Briefing inputs):** when adding migration 004 for news/dismissed tables, follow the same EMBEDDED_MIGRATIONS append pattern and bump the migrations spec to `[1, 2, 3, 4]` / `user_version === 4`.
- **02-04 (Briefing engine):** consume `readTodaysEvents(client, userTz)` from `src/main/integrations/google/sync-calendar.ts` for today's-calendar candidate gathering. Register the `'briefing'` cron in the SAME shared `SchedulerHandle` + `powerMonitor.registerLifecycleCallbacks` API. The Plan-02-04 "today" filter on cached `calendar_event` rows should compare `start_date === localToday` (Pitfall 19 mitigation already established here in calendar-tz.spec case 6).
- **CalendarRow "Sync now" disabled-during-busy edge:** the current implementation disables the button while a force-sync is in flight (`disabled={busy}`). If Plan 02-04 needs a manual "force sync" affordance from the briefing screen, it should call `window.aria.calendarForceSync()` directly rather than reaching into IntegrationsSection's `busy` state.
- **Phase 5 calendar write capability:** the schema is read-only-shaped (no `etag` column, no write-back state). Phase 5 will need a follow-up migration to add the etag/update-token columns before any `events.update` call ships.
