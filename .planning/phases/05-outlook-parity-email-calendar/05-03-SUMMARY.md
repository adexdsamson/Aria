# Phase 5 Wave 3 Summary

Date: 2026-05-19
Plan: `05-03-PLAN.md`
Status: Completed with live Microsoft OAuth/UAT verification deferred.

## Delivered

- Added `AccountChip` and `ProviderStatusTray` for per-account identity and aggregate account health.
- Wired `AccountChip` into approvals, briefing calendar/email/news rows, and the unified calendar grid.
- Fixed L-04-03 by rendering approval backend `last_error_message` verbatim.
- Fixed L-04-10 by rendering calendar approval times with `scheduling_rules.time_zone` via IPC.
- Added `/calendar` route, side-nav link, `UnifiedCalendarScreen`, `CalendarGrid`, account visibility toggles, and C14 recurrence unsupported pill/toast.
- Updated briefing gather to prefer local `provider_account` calendar rows, suppress `recurrence_unsupported=1`, and surface a calendar status note.
- Added approval queue account filtering.
- Added migration `014_legacy_singleton_views.sql` for `gmail_account_view` and `calendar_account_view`.
- Removed `ARIA_PROVIDER_REGISTRY` production kill-switch.
- Added per-account legacy Google keyring cleanup with `basic_text` skip guard.

## Verification

- PASS: Task 1 renderer tests: 4 files, 9 tests.
- PASS: Existing impacted approval/scheduling/briefing renderer tests: 4 files, 22 tests.
- PASS: Task 2 calendar tests + route reachability: 4 files, 8 tests.
- PASS: Task 3 briefing/approval focused tests: 3 files, 27 tests.
- PASS: Task 4 migration/secrets/registry/static tests: 4 files, 24 tests.
- PASS: Node typecheck introduced no new errors; only known baseline remains.
- PASS: Renderer typecheck introduced no new errors; only known baseline remains.

## Deferred Live Checks

- Outlook OAuth/manual tenant verification remains skipped per user direction because Microsoft OAuth keys are not available.
- Live SC-1, SC-2, and SC-4 are marked partial/deferred in `05-UAT.md`.

## Cleanup Notes

- R4/C7: Automated tests cover verified drop and `basic_text` skip. Live machine counts are deferred until OAuth state exists.
- M4: Migration file is named `014_legacy_singleton_views.sql`, but runner maps it to version `122` because prior `012a` is version `121`; a literal version `14` would never run.
- M3: Static test confirms `ARIA_PROVIDER_REGISTRY` has zero production `src/` matches.
- M5: Open Q2 remains deferred to a follow-up if live OAuth parity reveals resolver/freeBusy gaps.

## Carry-Overs

- F-1 sensitivity classifier audit: Phase 4.5 / Phase 8.
- F-4 time-of-day scheduling nuance: Phase 4.5.
- F-8 onboarding seal atomicity: unchanged.
- F-10 local model documentation: Phase 8.
