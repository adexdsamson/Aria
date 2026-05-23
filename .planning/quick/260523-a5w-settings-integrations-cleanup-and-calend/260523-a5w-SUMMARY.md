---
quick_id: 260523-a5w
type: summary
status: complete
completed_at: "2026-05-23T08:00:00Z"
commits:
  - hash: a70936f
    type: fix
    subject: lift google calendar sync onto provider_account + provider_sync_state
  - hash: 968821c
    type: fix
    subject: hide legacy provider rows on PRESENCE, not health
  - hash: 32e90b2
    type: feat
    subject: add Todoist as third provider in AddAccountModal with API-token paste flow
files_modified:
  - src/main/integrations/google/sync-calendar.ts
  - src/main/ipc/calendar.ts
  - src/renderer/features/settings/IntegrationsSection.tsx
  - src/renderer/components/AddAccountModal.tsx
files_modified_tests:
  - tests/unit/main/integrations/google/sync-calendar.spec.ts
  - tests/unit/renderer/components/AddAccountModal.test.tsx
---

# Quick task 260523-a5w — Settings integrations cleanup + calendar fix Summary

Three surgical, presence-correcting fixes across two surfaces (Settings → Integrations
and the Calendar week view). All three were visible regressions on the running app;
none required a migration or a new IPC channel.

## Task 1 — Google calendar sync lifted onto `provider_account` + `provider_sync_state` (commit `a70936f`)

### Root cause (two compounding bugs)

1. `src/main/integrations/google/sync-calendar.ts` INSERTed `calendar_event` rows
   WITHOUT `provider_key` and `account_id`. The Calendar read-path IPC
   (`CALENDAR_LIST_EVENTS_RANGE`) JOINs to `provider_account` and filters
   `WHERE e.provider_key IS NOT NULL AND e.account_id IS NOT NULL` — so every
   row the Google sync ever wrote was silently excluded from the week grid.
2. The same file SELECT/UPDATEd the legacy singleton `calendar_account` base
   table, which migration 014 dropped. Every tick threw `no such table:
   calendar_account` inside `runTick`'s try/catch, leaving the user with a
   permanently empty grid and no surfaced error.

### Before → after INSERT shape

```sql
-- BEFORE
INSERT OR REPLACE INTO calendar_event
 (id, calendar_id, summary, location, start_at_utc, end_at_utc, start_date, end_date,
  start_timezone, attendees, status, recurring_id, updated_at, fetched_at,
  etag, i_cal_uid, sequence, organizer_email, organizer_self, recurrence_json)
VALUES (@id, ..., @recurrence_json)

-- AFTER
INSERT OR REPLACE INTO calendar_event
 (id, calendar_id, summary, location, start_at_utc, end_at_utc, start_date, end_date,
  start_timezone, attendees, status, recurring_id, updated_at, fetched_at,
  etag, i_cal_uid, sequence, organizer_email, organizer_self, recurrence_json,
  recurrence_unsupported, provider_key, account_id)
VALUES (@id, ..., @recurrence_json,
        0, 'google', @account_id)
```

### Other changes

- Cursor read/write moved from `calendar_account.sync_token` →
  `provider_sync_state` (provider_key='google', account_id=<email>,
  resource='calendar'). Reuses the existing `upsertProviderSyncState` helper
  in `src/main/integrations/microsoft/provider-account.ts` (already typed for
  `'google' | 'microsoft'`).
- `recordError()` UPDATEs `provider_account` by composite key
  `(provider_key='google', account_id)` — mapping `token-*` errors to
  `status='needs-auth'`, everything else to `status='degraded'`, with
  `last_error_at` populated.
- Success path clears `last_error`/`last_error_at`, bumps `last_synced_at`,
  and resets `degraded`/`needs-auth` → `ok` so the Settings status chip
  recovers without waiting on the next status poll.
- `CalendarSync` constructor now **requires** `accountId` and throws loudly
  at construction if missing. `buildSync()` in `ipc/calendar.ts:53-66`
  resolves the email from `calendar_account_view` (the migration-014/125
  compat shim) before instantiation; if no row, `buildSync` returns null —
  preserving the historical `not-connected` contract.

### Test impact

`tests/unit/main/integrations/google/sync-calendar.spec.ts` shim updated to
mirror the new SQL surface — calendar_account_view existence probe,
provider_sync_state cursor read, INSERT OR REPLACE INTO provider_sync_state,
and the two provider_account UPDATE shapes. Behavioral assertions
unchanged. All 14 `createCalendarSync({ ... })` callsites threaded with
`accountId: 'me@x.com'`.

### Verify

The file-shape verify (`noLegacy && hasProviderKey && hasSyncState`) returns
all-`true`. `pnpm typecheck` produces zero new TS errors in
`sync-calendar.ts` / `ipc/calendar.ts`.

### Closes

MEMORY `migration_014_lift_incomplete` — this closes the calendar half of
the migration-014 lift (the Gmail IPC writes were lifted in commit
`f44ffd4`; the sync engines were left pointing at dropped base tables until
this task).

## Task 2 — Presence-based legacy-row gating (commit `968821c`)

### Root cause

`IntegrationsSection.tsx` exposed `hideWhenHealthy = hasHealthyAccount(...)`
on the legacy `GmailRow` / `CalendarRow` / `TodoistRow`. The "healthy"
predicate required `status === 'ok' && !lastError`. Any time an account
flipped to `status === 'degraded' | 'needs-auth'` OR carried a non-null
`lastError`, the legacy card reappeared as a duplicate empty box under the
unified `AccountRow` list — even though `AccountRow` already surfaces
provider, email, status chip, and lastError banner.

### Change

```diff
-function hasHealthyAccount(accounts, providerKey) {
-  return accounts.some(a => a.providerKey === providerKey
-                         && a.status === 'ok' && !a.lastError);
+function hasAccount(accounts, providerKey) {
+  return accounts.some(a => a.providerKey === providerKey);
 }
 ...
-<GmailRow ... hideWhenHealthy={hasHealthyAccount(accounts, 'google')} />
-<CalendarRow hideWhenHealthy={hasHealthyAccount(accounts, 'google')} />
-<TodoistRow ... hideWhenHealthy={hasHealthyAccount(accounts, 'todoist')} />
+<GmailRow ... hideWhenHealthy={hasAccount(accounts, 'google')} />
+<CalendarRow hideWhenHealthy={hasAccount(accounts, 'google')} />
+<TodoistRow ... hideWhenHealthy={hasAccount(accounts, 'todoist')} />
```

The legacy row's internal `hasBanner` check still lets the
connect-error / pre-OAuth disclosure / verification-pending banners surface
during the disconnected-but-attempting-to-connect flow when no
`AccountRow` of that provider exists yet.

`hasHealthyAccount` had only the IntegrationsSection callsite (verified via
grep across `src tests`) and was deleted.

### Verify

`hasHelper && callsites === 3 && noOldHelper` all true. Existing
IntegrationsSection tests either stub `providerAccountsList` with
`rows: []` (so neither old nor new gating fires) or assert on AccountRow
testids directly — no breakage.

## Task 3 — Todoist provider in AddAccountModal (commit `32e90b2`)

### Change

- `ProviderChoice` widened: `'google' | 'microsoft'` → `'google' | 'microsoft' | 'todoist'`.
- Third `PROVIDERS` entry: `{ id: 'todoist', letter: 'T', letterColor: '#e44332',
  letterBg: 'rgba(228,67,50,0.10)', name: 'Todoist', scopes: 'Personal API token
  (read + write tasks)' }`.
- New `token` state alongside `selected` / `busy` / `error`.
- When `selected === 'todoist'`:
  - Privacy note swaps to the Todoist-specific copy (safeStorage encryption +
    todoist.com/prefs/integrations link).
  - An inline password input renders above the action row
    (`data-testid="add-account-todoist-token"`, `aria-label="Todoist API
    token"`).
  - The primary action button becomes "Connect Todoist"
    (`data-testid="add-account-todoist-connect"`) styled identically to the
    existing Continue button.
- `connect()` branches on the three providers. The Todoist branch trims the
  token, surfaces an inline `add-account-error` when empty (no IPC fires),
  calls `window.aria.todoistConnectToken({ token })`, then on success clears
  local state, invokes `onConnected()`, and closes.

Existing Microsoft / Google flows are untouched — same `add-account-modal`,
`add-account-cancel`, `add-account-connect` testids, same IPC calls, same
copy. No new IPC channels, no preload changes, no migrations.

### Test impact

`tests/unit/renderer/components/AddAccountModal.test.tsx` rewritten with three
cases:

1. Three-provider happy path: Microsoft default selection still wires
   `microsoftConnect` through `add-account-connect`.
2. Todoist happy path: radio click → paste token → click
   `add-account-todoist-connect` → `todoistConnectToken({ token })` called →
   `onConnected()` → `onClose()`.
3. Empty-token gate: clicking Connect Todoist with no token surfaces the
   inline `add-account-error` element and the IPC is NOT called.

(Side note: the pre-existing assertion `getByText('Google Gmail + Calendar')`
was already failing against the source copy `'Google · Gmail + Calendar'`
with a middle dot — replaced with a regex match in the same spirit.)

### Verify

`hasTodoistEntry && callsIpc && widenedType` all true. `pnpm typecheck`
clean on `AddAccountModal.tsx` and the rewritten test file.

## Deviations from Plan

None — plan executed exactly as written. The plan's Task 3 layout
guidance ("input + button can sit in the same flex row as Cancel, OR on a
row above the Cancel/Continue row — pick the layout that requires fewer
style changes") was resolved as the row-above option to keep the existing
Cancel/primary footer layout intact.

## Tests

| Surface | Test file | Status |
|---|---|---|
| CalendarSync engine | `tests/unit/main/integrations/google/sync-calendar.spec.ts` | Shim updated; cannot run vitest in this environment (better-sqlite3 ABI lock + missing worktree node_modules per project memory `reference_better_sqlite3_abi_lock` + `reference_vitest_teardown_strands_electron`). File-shape verify authoritative per plan constraints. |
| AddAccountModal | `tests/unit/renderer/components/AddAccountModal.test.tsx` | Rewritten — 3 cases. Same vitest-blocked status as above. |
| IntegrationsSection | (existing) | Not modified. Both `IntegrationsSection.spec.tsx` and `IntegrationsSection-accounts.spec.tsx` already mock `providerAccountsList` with `rows: []` or assert on AccountRow testids — no breakage expected from the presence-gating switch. |
| Pure-function calendar TZ | `tests/unit/main/integrations/google/calendar-tz.spec.ts` | Untouched. Uses `toEventRow` / `computeTodayBoundsUtc` / `readTodaysEvents` — none affected by Task 1. |

`pnpm typecheck` against `tsconfig.json` + `tsconfig.node.json` shows zero
new errors in any of the four edited source files. The pre-existing TS
errors flagged in the run (single-instance, learning tests, pdf.tsx jsx,
etc.) carry forward from before this task per `MEMORY project_aria_phase9_uat_polish`
and are out of scope.

## Followups discovered during execution

1. **`pnpm typecheck` reveals pre-existing carry-forward errors** in 11+
   files (single-instance.ts, learning/schedule.test.ts, learning/signal-log.test.ts,
   rag/backfill.ts, recap/export/pdf.tsx, release/backup-hook.ts,
   scheduling/resolver.ts, tray/notify.ts, tests/setup.ts, plus the
   2 known Phase-8 carry-forwards in RecapScreen + SchedulingRulesSection).
   Out of scope per executor scope-boundary rule.
2. **`sync-gmail.ts` cursor lift not verified.** This task only addressed
   the calendar half. Per MEMORY `migration_014_lift_incomplete`,
   `sync-gmail.ts` may still SELECT/UPDATE dropped base tables for cursor
   advance — but Gmail rows ALREADY tag `provider_key/account_id` and
   Briefing has continued to render (vs Calendar's hard-zero), so any
   remaining Gmail half is at most cosmetic ("Last sync" status). Did not
   touch in this quick task to keep scope tight.
3. **`identity_set_json` on the provider_account update path.** Both the
   Microsoft adapter and this lift leave identitySet untouched on tick —
   acceptable for v1 because the column is populated on
   `CALENDAR_CONNECT` (`src/main/ipc/calendar.ts:153-178`) and is not
   read by the calendar week view.

## Self-Check

- Created files:
  - `.planning/quick/260523-a5w-settings-integrations-cleanup-and-calend/260523-a5w-SUMMARY.md` — FOUND (this file)
- Modified files (`git show --stat <hash>`):
  - `src/main/integrations/google/sync-calendar.ts` (a70936f) — FOUND
  - `src/main/ipc/calendar.ts` (a70936f) — FOUND
  - `tests/unit/main/integrations/google/sync-calendar.spec.ts` (a70936f) — FOUND
  - `src/renderer/features/settings/IntegrationsSection.tsx` (968821c) — FOUND
  - `src/renderer/components/AddAccountModal.tsx` (32e90b2) — FOUND
  - `tests/unit/renderer/components/AddAccountModal.test.tsx` (32e90b2) — FOUND
- Commits:
  - `a70936f` — FOUND (`git log --oneline -4` shows it)
  - `968821c` — FOUND
  - `32e90b2` — FOUND

## Self-Check: PASSED
