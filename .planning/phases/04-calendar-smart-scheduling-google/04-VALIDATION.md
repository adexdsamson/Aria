---
phase: 4
slug: calendar-smart-scheduling-google
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-18
updated: 2026-05-18
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> See 04-RESEARCH.md "## Validation Architecture" for test files and patterns.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.x + Playwright 1.48+ (_electron) |
| **Config file** | vitest.config.ts (existing), playwright.config.ts |
| **Quick run command** | `pnpm vitest run --reporter=dot` |
| **Full suite command** | `pnpm vitest run && pnpm playwright test` |
| **Estimated runtime** | ~60s unit; +~60s e2e at wave merge gate |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run --reporter=dot` (unit-only; <30s)
- **After every plan wave:** Run `pnpm vitest run` + `pnpm playwright test` if e2e tasks landed
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max per-task feedback latency:** 30 seconds (unit). E2E reserved for wave merge gate per task 3b.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-T1 | 04-01 | 1 | APPR-02 | T-04-01-06 | Migration 010 widens approval.kind + adds calendar_event etag/i_cal_uid/sequence/organizer_* + scheduling_rules singleton + calendar_action_log | unit | `npm run test:unit -- tests/unit/main/db/migrations.spec.ts tests/unit/main/approvals/persist.test.ts` | ✅ (extend) | ⬜ pending |
| 04-01-T2 | 04-01 | 1 | CAL-04, APPR-02 | T-04-01-02, T-04-01-04, T-04-01-05, T-04-01-07 | calendar.events scope; CalendarClient methods; recurrence module covers this/future/all + rollback | unit | `npm run test:unit -- tests/unit/main/integrations/google/recurrence.test.ts tests/unit/renderer/features/settings/IntegrationsSection.spec.tsx` | ❌ Wave 0 | ⬜ pending |
| 04-01-T3 | 04-01 | 1 | APPR-02 | T-04-01-01, T-04-01-03, T-04-01-07, T-04-01-08 | applyCalendarChange chokepoint (assertApproved line 1); audit-log both paths; static-grep ratchet | unit + static | `npm run test:unit -- tests/static/single-calendar-write-site.test.ts tests/unit/main/integrations/google/write-event.test.ts tests/unit/main/integrations/google/write-event-etag.test.ts tests/unit/main/scheduling/audit.test.ts` | ❌ Wave 0 | ⬜ pending |
| 04-02-T1 | 04-02 | 2 | CAL-06 | T-04-02-01, T-04-02-02 | RulesSchema (Zod) shared; CRUD round-trip; Settings UI persists; workingHours fallback field | unit | `npm run test:unit -- tests/unit/main/scheduling/rules.test.ts tests/unit/renderer/features/settings/SchedulingRulesSection.spec.tsx` | ❌ Wave 0 | ⬜ pending |
| 04-02-T2 | 04-02 | 2 | CAL-05, CAL-06, CAL-07 | T-04-02-05 | Pure-function conflict detector classifies hard/soft; top-3 by proximity; prime-time bonus high-value only; TZ canonical; workingHours fallback chain | unit | `npm run test:unit -- tests/unit/main/scheduling/conflict.test.ts tests/unit/main/scheduling/conflict-alternatives.test.ts tests/unit/main/scheduling/conflict-prime-time.test.ts tests/unit/main/scheduling/timezone.test.ts` | ❌ Wave 0 | ⬜ pending |
| 04-03-T1 | 04-03 | 3 | CAL-04 | T-04-03-01, T-04-03-02, T-04-03-09 | parseIntent (redactor + p-queue + maxRetries=2); cancel-not-in-v1 refusal; self-only gate two-predicate | unit | `pnpm vitest run intent.test.ts self-only-gate.test.ts` | ❌ Wave 0 | ⬜ pending |
| 04-03-T2 | 04-03 | 3 | CAL-04, APPR-02 | T-04-03-05 | /scheduling chat surface + ApprovalCard calendar variant (alternatives picker, scope radio default='this', override button) | unit | `pnpm vitest run ApprovalCard-calendar.spec.tsx SchedulingChat.spec.tsx` | ❌ Wave 0 | ⬜ pending |
| 04-03-T3a | 04-03 | 3 | CAL-04, CAL-05, CAL-07 | T-04-03-03 | proposeCalendarChange orchestrator + IPC SCHEDULING_PROPOSE/CONFIRM_TARGET/OVERRIDE; all 6 branches covered (cancel, multi-attendee, no-match, multiple-matches, success-no-conflicts, success-with-conflicts) | unit | `pnpm vitest run propose.test.ts` | ❌ Wave 0 | ⬜ pending |
| 04-03-T3b | 04-03 | 3 | APPR-02 | T-04-03-04, T-04-03-06, T-04-03-07, T-04-03-08 | APPROVALS_APPROVE dispatch on kind='calendar_change' → applyCalendarChange; bypass attempt refused; full propose→approve→write slice | e2e | `pnpm playwright test tests/e2e/scheduling-propose.spec.ts tests/e2e/calendar-approval-bypass.spec.ts` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Feedback-latency note:** Task 3b uses Playwright e2e (~30–60s). Per Nyquist guidance, e2e runs at the wave merge gate, not on every commit during Task 3b execution. All other tasks ship sub-30s unit verify.

---

## Wave 0 Requirements

- [x] Migration 010 (calendar_event columns, scheduling_rules, calendar_action_log, approval kind widen) — Plan 04-01 Task 1
- [x] `tests/static/single-calendar-write-site.test.ts` — static-grep ratchet for APPR-02 — Plan 04-01 Task 3
- [x] Test fixtures for Google Calendar API (`tests/fixtures/google/recurring-events.json`) — Plan 04-01 Task 2
- [x] `rrule` dependency install + version pin — Plan 04-01 Task 1
- [x] Vitest unit/integration test stubs for CAL-04..07 and APPR-02 — distributed across Plans 04-01/02/03 task `<files>` blocks

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Google OAuth write-scope incremental consent | CAL-04 | Requires real Google account in dev | Run app, trigger calendar write, accept consent screen |
| Approved write reaches real Google Calendar | CAL-05 | Live API call | Approve scheduled change, verify in Google Calendar UI |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s (unit per-task < 30s; e2e at wave merge gate only)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready
