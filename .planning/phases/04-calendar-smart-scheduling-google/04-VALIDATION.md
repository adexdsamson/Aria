---
phase: 4
slug: calendar-smart-scheduling-google
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-18
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Planner: populate the per-task verification map from PLAN.md task IDs.
> See 04-RESEARCH.md "## Validation Architecture" for test files and patterns.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.x |
| **Config file** | vitest.config.ts (existing) |
| **Quick run command** | `pnpm vitest run --reporter=dot` |
| **Full suite command** | `pnpm vitest run` |
| **Estimated runtime** | ~60 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run --reporter=dot`
- **After every plan wave:** Run `pnpm vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| _populated by planner_ | _ | _ | _ | _ | _ | _ | _ | _ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Migration 010 (calendar_event columns, scheduling_rules, calendar_action_log, approval kind widen)
- [ ] `tests/static/single-calendar-write-site.test.ts` — static-grep ratchet for APPR-02
- [ ] Test fixtures for Google Calendar API (recurring event payloads, etag flows)
- [ ] `rrule` dependency install + version pin
- [ ] Vitest unit + integration test stubs for CAL-04..07 and APPR-02

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Google OAuth write-scope incremental consent | CAL-04 | Requires real Google account in dev | Run app, trigger calendar write, accept consent screen |
| Approved write reaches real Google Calendar | CAL-05 | Live API call | Approve scheduled change, verify in Google Calendar UI |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
