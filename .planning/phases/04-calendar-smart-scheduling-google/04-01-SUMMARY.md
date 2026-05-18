---
phase: 04-calendar-smart-scheduling-google
plan: 01
subsystem: calendar
tags: [calendar, oauth, recurring, chokepoint, migration, appr-02]
dependency_graph:
  requires:
    - migration-006 (approval table baseline)
    - migration-003 (calendar_event baseline)
    - approvals/gate.ts (assertApproved)
    - approvals/persist.ts (transitionTo, getApproval)
    - integrations/google/calendar.ts (existing wrapper)
    - integrations/google/auth.ts (OAuth + SCOPES)
  provides:
    - migration-010 (calendar write-back schema)
    - applyCalendarChange (APPR-02 chokepoint)
    - computeRecurringWrite (this/future/all planner)
    - logCalendarAction (audit writer)
    - EtagMismatchError + InvalidInstanceIdError
  affects:
    - CalendarIntegrationStatus (writeScopeMissing field added)
    - ApprovalKind union (widened)
    - calendar_event schema (etag + recurrence cols)
tech_stack:
  added:
    - rrule@^2.8.1
  patterns:
    - "Polymorphic approval table — same RENAME/CREATE/INSERT/DROP idiom as 006"
    - "Static-grep ratchet — extends 03-04 single-send pattern"
    - "Chokepoint-then-wrapper — assertApproved gates the function boundary, wrapper allow-listed for the literal API call"
key_files:
  created:
    - src/main/db/migrations/010_calendar_writeback.sql
    - src/main/integrations/google/recurrence.ts
    - src/main/integrations/google/write-event.ts
    - src/main/scheduling/audit.ts
    - tests/static/single-calendar-write-site.test.ts
    - tests/unit/main/integrations/google/recurrence.test.ts
    - tests/unit/main/integrations/google/write-event.test.ts
    - tests/unit/main/integrations/google/write-event-etag.test.ts
    - tests/fixtures/google/recurring-events.json
  modified:
    - src/main/db/migrations/embedded.ts (mirror 010 SQL)
    - src/main/approvals/persist.ts (widen ApprovalKind + calendar fields)
    - src/main/integrations/google/auth.ts (calendar.events scope)
    - src/main/integrations/google/calendar.ts (5 wrapper methods + 2 error classes)
    - src/shared/ipc-contract.ts (writeScopeMissing)
    - src/renderer/features/settings/IntegrationsSection.tsx (re-consent banner)
    - tests/unit/main/db/migrations.spec.ts (bump to v10 + schema assertions)
    - tests/unit/renderer/features/settings/IntegrationsSection-calendar.spec.tsx (banner tests)
decisions:
  - "rrule@^2.8.1 installed for UNTIL-split arithmetic; pure JS, no native build"
  - "calendar.ts wrapper allow-listed for events.patch/insert literals (chokepoint sits one layer above)"
  - "getCalendarSettings returns timeZone only (workingHours undefined) — Calendar v3 settings endpoint does not expose working hours (Open Q 1 resolved: defer to user-configured scheduling_rules)"
  - "scope='this' instance-id guard enforced at chokepoint (write-event.ts) not at wrapper, per PATTERNS planner decision — wrapper stays plain"
  - "Rollback for scope='future' is best-effort: parent RRULE restored, second failed row logged if rollback itself throws"
metrics:
  duration_min: 12
  completed_date: "2026-05-18"
  task_count: 3
  file_count: 17
---

# Phase 04 Plan 01: Calendar Write-Back Chokepoint Summary

Wave 0 calendar write-back: migration 010 widens approval to polymorphic kind='calendar_change', adds calendar_event etag + recurrence columns, introduces scheduling_rules singleton and calendar_action_log audit table; rrule@^2.8.1 lands for UNTIL-split math; CalendarClient gains patchEvent/insertEvent/eventsInstances/freebusyQuery/getCalendarSettings; applyCalendarChange becomes the sole approval-gated chokepoint with static-grep ratchet protection (no events.patch / events.insert literals outside calendar.ts + write-event.ts; no `sendUpdates: 'all'` in write-event.ts).

## Outcomes

- **Migration 010 applied cleanly** at user_version=9 → 10. Existing approval rows preserved with NULL calendar_* values (verified by dedicated test). approval.kind CHECK now accepts both `email_send` and `calendar_change`; rejects unknown kinds.
- **calendar_event additive columns:** etag, i_cal_uid, sequence, organizer_email, organizer_self, recurrence_json — pays back Phase 2 etag debt without disturbing the existing CHECK constraint.
- **scheduling_rules singleton** seeded with `rules_json='[]'`, `time_zone='UTC'`.
- **calendar_action_log** audit table with phase enum (proposed, pre_write, post_write, failed, override) and indexes on (approval_id, event_id).
- **SCOPES.calendar** now includes `calendar.events` alongside `calendar.readonly` (narrowest write scope; T-04-01-05).
- **CalendarIntegrationStatus.writeScopeMissing** field added; renderer shows re-consent banner with locked copy: "Aria needs permission to make changes to your calendar. Reconnect Google Calendar."
- **CalendarClient extended** with 5 new methods + 2 new error classes (EtagMismatchError, InvalidInstanceIdError); patchEvent maps Google's 412 → EtagMismatchError and propagates ifMatch header for optimistic concurrency.
- **recurrence.ts**: pure-functional `computeRecurringWrite` covering scope=this (instance patch), scope=all (parent patch), scope=future (parent RRULE UNTIL-truncated + new series inserted with UNTIL cleared, plus rollback callback). Throws when scope='future' is requested without an RRULE.
- **write-event.ts**: applyCalendarChange chokepoint. First executable line is `assertApproved(db, approvalId)`. Enforces scope='this' instance-id guard before any API call. Hard-codes sendUpdates:'none'. Writes pre_write + post_write audit rows on success; failed row on Google API failure or etag mismatch. Best-effort rollback for scope='future' parent-PATCH + insert-FAIL sequence. Transitions approval to 'sent' only on full success.
- **Static-grep ratchet**: scans `src/main/**/*.{ts,js,tsx,mts,cts}`. Strips both line and block comments before matching. Asserts events.patch + events.insert literals confined to calendar.ts (wrapper) + write-event.ts (chokepoint); secondary regex asserts no `sendUpdates: 'all'` literal in write-event.ts; positive assertion that write-event.ts contains `assertApproved(db, approvalId)`.

## Migration 010 Schema Diff (vs RESEARCH §Pattern 2 sketch)

| Element | Sketch | Final | Notes |
|---|---|---|---|
| approval.kind CHECK | `IN ('email_send','calendar_change')` | same | exact match |
| approval calendar_* cols | 8 nullable | 8 nullable | calendar_event_id, calendar_action (CHECK move/create/find-time), recurring_scope (CHECK this/future/all), before/after/conflicts/alternatives/rule_overrides_json |
| approval.beta_voice preservation | not in sketch | INCLUDED | Plan 03-04 added column 009; INSERT-SELECT preserves it (extra care taken vs naive 006 template) |
| calendar_event additive cols | 6 columns | 6 columns | exact match |
| scheduling_rules | singleton id=1 | singleton id=1 | rules_json='[]', time_zone='UTC', updated_at='1970-01-01T00:00:00.000Z' (sentinel) |
| calendar_action_log | AUTOINCREMENT id + FK + 2 indexes | same | exact match |

**Single deviation:** the rebuild's INSERT-SELECT carries `beta_voice` through. RESEARCH §Pattern 2 was authored before 009 landed and didn't enumerate beta_voice. Caught by reading 009 during read_first; flagged here so future migration plans copy the right baseline.

## Deviations from RESEARCH §Pattern 3

None of substance. The "future" branch builds the new series RRULE by cloning the parent's options and setting `until: null` — `RRule.toString()` emits the cleared form. Verified by recurrence.test.ts ("the new series RRULE should NOT carry the UNTIL clause").

## Working-Hours Resolution (Open Q 1)

Google Calendar v3's `calendarList.get` does NOT expose working hours. `getCalendarSettings` returns `{ timeZone }` only, with `workingHours: undefined` documented as the contract. Working-hours derivation is therefore deferred to user-configured `scheduling_rules.rules_json` (Plan 04-02 will plumb the editor UI for it).

## Threat Mitigations Landed

| Threat | Mitigation |
|---|---|
| T-04-01-01 EoP at write-event.ts | assertApproved is first executable line; static-grep ratchet locks call sites |
| T-04-01-02 Tampering via stale etag | patchEvent passes ifMatch; 412 → EtagMismatchError; chokepoint surfaces via failed audit row |
| T-04-01-03 Repudiation of calendar writes | logCalendarAction writes pre_write + post_write on success, failed on error; both carry google_etag + before/after JSON |
| T-04-01-04 Orphan future series | computeRecurringWrite.rollback restores original RRULE; chokepoint logs second failed row if rollback throws |
| T-04-01-05 Over-broad scope | Only calendar.events added (no full calendar, no calendar.app.created); incremental consent re-prompt explains why |
| T-04-01-06 Spoofed approvalId | Chokepoint reads row from main-process DB; state machine prevents non-approved rows from reaching Google |
| T-04-01-07 "this" patch hits parent | InvalidInstanceIdError thrown when scope='this' but eventId lacks '_'; unit test covers |
| T-04-01-08 Silent attendee notifications | sendUpdates:'none' hard-coded; static-grep secondary regex asserts 'all' literal absent |

## Auth Gates

User must re-consent to Calendar with the calendar.events scope. Surfaced by `writeScopeMissing` on CalendarIntegrationStatus and the re-consent banner. No CLI / out-of-app step — Reconnect button reuses the existing OAuth loopback flow. Real consent screen reachability requires a live Google account (documented in plan frontmatter `user_setup`).

## Test Coverage Snapshot

| Suite | Tests | Status |
|---|---|---|
| migrations.spec.ts | 5 | green (added 1 row-preservation case) |
| persist.test.ts | 6 | green (existing — passes with widened union via type compatibility) |
| recurrence.test.ts | 6 | green |
| IntegrationsSection-calendar.spec.tsx | 7 | green (added 2 write-scope banner cases) |
| IntegrationsSection.spec.tsx | 6 | green (unchanged) |
| calendar-wrapper.spec.ts | 5 | green (existing wrapper methods unaffected) |
| single-calendar-write-site.test.ts | 4 | green |
| write-event.test.ts | 5 | green |
| write-event-etag.test.ts | 1 | green |
| single-send-call-site.test.ts | 1 | green (regression OK) |
| gate.test.ts + persist.test.ts | 22 | green |

Typecheck (`tsc --noEmit -p tsconfig.json`) clean.

## Commits

| Task | Commit | Description |
|---|---|---|
| 1 | fa2cbdf | Migration 010 + rrule + widen ApprovalKind |
| 2 | 44e455a | Calendar write scope + wrapper + recurrence planner |
| 3 | cd33b2c | APPR-02 chokepoint write-event.ts + audit + static-grep ratchet |

## Deviations from Plan

None of substance — plan executed exactly as written. Two adjustments noted inline:

1. **Static-grep comment stripping extended to block comments** [Rule 1 — Bug]: the chokepoint's header docblock necessarily references the forbidden `sendUpdates: 'all'` literal (it documents why the literal MUST be absent from executable code). With only line-comment stripping the static-grep secondary regex tripped on the docblock. Fixed by also stripping `/* ... */` block comments before matching. Same approach as 03-04's enforcer would need if it touched block-comment territory.
2. **beta_voice column preserved in INSERT-SELECT**: not enumerated in RESEARCH §Pattern 2 sketch (it predates 009). Caught at read-first; added to INSERT-SELECT to avoid silently dropping the column on existing rows.

No architectural changes; no checkpoints triggered.

## Known Stubs

None. Every code path is wired end-to-end; the only thing waiting on downstream plans is the consumer that catches `EtagMismatchError` and renders a refresh prompt (Plan 04-03 deliverable, explicitly out-of-scope here).

## Self-Check: PASSED

- FOUND: src/main/db/migrations/010_calendar_writeback.sql
- FOUND: src/main/integrations/google/recurrence.ts
- FOUND: src/main/integrations/google/write-event.ts
- FOUND: src/main/scheduling/audit.ts
- FOUND: tests/static/single-calendar-write-site.test.ts
- FOUND: tests/unit/main/integrations/google/recurrence.test.ts
- FOUND: tests/unit/main/integrations/google/write-event.test.ts
- FOUND: tests/unit/main/integrations/google/write-event-etag.test.ts
- FOUND: tests/fixtures/google/recurring-events.json
- FOUND commits: fa2cbdf, 44e455a, cd33b2c
