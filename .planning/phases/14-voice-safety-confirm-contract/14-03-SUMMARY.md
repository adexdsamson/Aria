---
phase: 14-voice-safety-confirm-contract
plan: 03
subsystem: testing
tags: [static-ratchet, voice, approval, chokepoint, security, architecture]

# Dependency graph
requires:
  - phase: 14-voice-safety-confirm-contract/14-01
    provides: "approval_path='voice-explicit' in DB schema + ApprovalPath type union"
provides:
  - "Ratchet B: caller allow-list fencing sendApprovedEmail / applyCalendarChange / pushApprovedMeetingActions to their three known IPC callers"
  - "Ratchet A: named SC3-phrased voice ratchet asserting no direct chokepoint calls from voice namespace + banned approval_path:'explicit' literal"
  - "ARCHITECTURE.md corpus corrected to voice-explicit design (lines 122/306/314-316)"
affects:
  - 14-voice-safety-confirm-contract/14-02
  - phase-15
  - phase-17

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Chokepoint caller allow-list pattern: ALLOWED_CALLERS Set + offenders===[] + positive-match guard per entry point"
    - "W-1 missing-dir guard: fs.existsSync(VOICE_ROOT) before walk() for future-proof voice namespace ratchets"
    - "SC3-phrased describe/it text makes ratchets auditor-pointable to success criteria"

key-files:
  created:
    - tests/static/chokepoint-caller-allow-list.spec.ts
    - tests/static/voice-routes-through-staging.spec.ts
  modified:
    - .planning/research/ARCHITECTURE.md

key-decisions:
  - "D-08/D-09: Ratchet B fences exported chokepoint entry points (not just low-level SDK surface) — the gap a voice handler would exploit"
  - "D-08A: Ratchet A overlaps B intentionally — A documents SC3 intent at the voice namespace, B closes the hole for all of src/main"
  - "D-09a: banned-literal assertion for approval_path:'explicit' in voice files mirrors D-04 pattern"
  - "D-13: ARCHITECTURE.md corrected via addendum (spec-vs-codebase-reality loop) — ROADMAP/PITFALLS/SUMMARY remain authoritative"
  - "W-1 guard: voice ratchet treats missing src/main/voice/ as empty file set (not ENOENT) — Wave 2 plans are parallel-eligible"

patterns-established:
  - "Chokepoint entry point allow-list: one ALLOWED_CALLERS Set per function, offenders===[] + positive guard, spec fails closed for any rogue caller"
  - "Missing-dir guard: existsSync before readdirSync for speculative namespace ratchets"

requirements-completed: [VOICE-10]

# Metrics
duration: 25min
completed: 2026-06-02
---

# Phase 14 Plan 03: Voice Safety Ratchets + ARCHITECTURE.md Corpus Correction Summary

**Two build-time ratchets close the voice-to-write-module gap (D-08/D-09/D-09a) and ARCHITECTURE.md is corrected from approval_path='explicit' to 'voice-explicit' across all three stale locations (D-13)**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-06-02T19:59:00Z
- **Completed:** 2026-06-02T20:25:00Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Ratchet B (chokepoint-caller-allow-list.spec.ts): fences `sendApprovedEmail` / `applyCalendarChange` / `pushApprovedMeetingActions` to their single known IPC callers; any rogue caller (including future voice handlers) fails the build
- Ratchet A (voice-routes-through-staging.spec.ts): SC3-phrased auditor-pointable ratchet with W-1 missing-dir guard; asserts no direct chokepoint calls from voice namespace AND bans `approval_path:'explicit'` in voice files (D-09a)
- ARCHITECTURE.md reconciled: lines 122, 306, and 314-316 all corrected from 'explicit' to 'voice-explicit'; Non-negotiables rewritten to state that forced/high-severity voice confirms are REJECTED (forcing the on-screen click)

## Task Commits

1. **Task 1: Chokepoint caller allow-list ratchet (Ratchet B)** - `ab7d527` (feat)
2. **Task 2: Named voice-routes-through-staging ratchet (Ratchet A)** - `28bb1ab` (feat)
3. **Task 3: Reconcile ARCHITECTURE.md stale corpus** - `e5f740c` (docs)

## Files Created/Modified

- `tests/static/chokepoint-caller-allow-list.spec.ts` — Ratchet B: ALLOWED_CALLERS Set for three write-module chokepoints with offenders===[] + positive-match guards
- `tests/static/voice-routes-through-staging.spec.ts` — Ratchet A: SC3-phrased voice namespace ratchet with W-1 missing-dir guard and D-09a banned-literal check
- `.planning/research/ARCHITECTURE.md` — D-13: corrected three stale voice-explicit references at lines 122, 306, and 314-316

## Decisions Made

- Ratchets use `stripComments` (block then line — order matters) so comment-only mentions in scheduling/propose.ts and learning/sources/approval.ts do not register as callers
- Definition sites (send.ts / write-event.ts / push-actions.ts) are excluded from offender set via equality check against normalized abs() paths
- Ratchet A overlaps Ratchet B intentionally: A documents intent at the voice namespace, B is the real hole-closer for all of src/main
- ARCHITECTURE.md correction preserves the "load-bearing trust decision" framing for confirm.ts; only the path value and Non-negotiables bullet are changed

## Deviations from Plan

None — plan executed exactly as written. The W-1 guard was specified in the plan and implemented as specified.

## Issues Encountered

**Vitest EBUSY in worktree:** The `tests/setup-native-abi.ts` globalSetup attempts to copy better-sqlite3-multiple-ciphers' native binary, which is locked by the Electron dev process. Since the two static ratchets are pure filesystem-grep specs (no SQLite usage), the spec logic was verified via a Node ESM script exercising the identical logic. All 6 assertions of Ratchet B and 2 assertions of Ratchet A passed. The EBUSY is a pre-existing worktree constraint — the specs will run correctly in CI (no Electron process holding the binary).

**Pre-existing typecheck failures:** `npm run typecheck` has non-zero exit on the base tree (pdf.tsx JSX flag, backup-hook.ts override, etc.) — these pre-date this plan and are in unrelated files. None of the new spec files are included in the project tsconfigs (tests/ is excluded by both tsconfig.json and tsconfig.node.json include arrays), so this plan introduces zero new type errors.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Both ratchets are committed and will fail-closed when `src/main/voice/confirm.ts` lands from Plan 14-02 — if confirm.ts writes `approval_path:'explicit'` instead of `'voice-explicit'`, Ratchet A immediately turns red
- ARCHITECTURE.md is now consistent with ROADMAP.md / PITFALLS.md / SUMMARY.md — no corpus outlier claiming voice='explicit'
- Plan 14-02 (voice/confirm.ts) can merge independently; the W-1 guard ensures this ratchet stays green even if 14-02 merges first

## Self-Check

- [x] `tests/static/chokepoint-caller-allow-list.spec.ts` exists and defines ALLOWED_CALLERS mapping for all three chokepoints
- [x] `tests/static/voice-routes-through-staging.spec.ts` exists with W-1 guard and D-09a banned-literal
- [x] `.planning/research/ARCHITECTURE.md` contains no `approval_path='explicit'` voice-confirm description
- [x] ARCHITECTURE.md contains `voice-explicit` in all three corrected locations
- [x] Commits ab7d527 / 28bb1ab / e5f740c exist in git log

---
*Phase: 14-voice-safety-confirm-contract*
*Completed: 2026-06-02*
