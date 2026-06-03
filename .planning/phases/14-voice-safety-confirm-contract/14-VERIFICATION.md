---
phase: 14-voice-safety-confirm-contract
verified: 2026-06-03T03:05:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
---

# Phase 14: Voice Safety / Confirm Contract — Verification Report

**Phase Goal:** The voice-to-approval safety contract exists and is enforced before any conversational fluency is built — voice can stage but never auto-execute, and high-stakes actions can never be authorized by voice alone.
**Verified:** 2026-06-03T03:05:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth (SC) | Status | Evidence |
|---|-----------|--------|----------|
| 1 | A voice-staged action lands as an approval row and is never executed without a separate explicit confirm turn (SC1: `state='ready'` per D-03/D-05) | VERIFIED | `voiceConfirm(db, approvalId)` calls `transitionTo(db, id, 'approved', { approval_path: 'voice-explicit' })` — a 2-arg dormant seam with zero callers this phase. The 'ready' row sits inert until voiceConfirm is explicitly invoked. `src/main/voice/confirm.spec.ts` 2/2 tests pass including the invalid-transition guard that proves routing through `transitionTo`. |
| 2 | The gate rejects a voice-confirm (`approval_path='voice-explicit'`) for forced/high-severity (financial/legal/HR), forcing on-screen confirm — proven by failing-then-passing gate test (SC2) | VERIFIED | `src/main/approvals/gate.ts` line 95: named `voice-forbidden-forced` branch ordered BEFORE the generic forced check at line 101. `tests/integration/voice-confirm-gate.spec.ts` 7/7 tests pass. Tests assert the SPECIFIC `'voice-forbidden-forced'` code (not `'forced-explicit-missing'`), the two-state expectation comment is present, and the generic branch remains intact for `'silent'` path. |
| 3 | Static-grep ratchet fails the build if voice directly calls `send.ts` / `write-event.ts` / `push-actions.ts` chokepoints, proving voice routes through staging (SC3) | VERIFIED | `tests/static/chokepoint-caller-allow-list.spec.ts` 6/6 tests pass (3 offenders===[] + 3 positive-match guards). `tests/static/voice-routes-through-staging.spec.ts` 2/2 tests pass (SC3-phrased, W-1 missing-dir guard, D-09a banned-literal). Ratchet B closes the real hole for all `src/main`; Ratchet A documents intent at the voice namespace. |
| 4 | A voice confirm of a low/med action performs the SAME `approve()` transition the Approvals UI performs, then runs the unchanged send adapter (`assertApproved`) (SC4) | VERIFIED | SC4 integration tests (2 tests in `voice-confirm-gate.spec.ts`): low/med row reaches stubbed Gmail client (assertApproved at send.ts:146 passes); forced row is rejected at sendApprovedEmail's assertApproved with `'voice-forbidden-forced'` (client never reached). The `ready→approved` edge in `state.ts:28` is the only path into `approved` — SC4 is true by construction (D-05/D-06). |

**Score: 4/4 truths verified**

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/main/db/migrations/134_voice_explicit_path.sql` | CHECK-widening table-rebuild: `approval_path IN ('explicit','silent','voice-explicit')`, `BEGIN;` envelope, all columns + 5 indexes | VERIFIED | File exists. Contains `approval_path IN ('explicit','silent','voice-explicit')` at line 23. Has `BEGIN;` at line 10. Committed at `6b5d84d`. |
| `src/main/db/migrations/embedded.ts` | version-134 entry byte-equivalent to .sql; 4 frozen historical snapshots unchanged | VERIFIED | `version: 134` entry at line 1516. Widened constraint at line 1540. 4 historical snapshots still read `approval_path IN ('explicit','silent')` (grep count = 4). Committed at `86a82a9`. |
| `src/main/approvals/persist.ts` | `ApprovalPath` union contains `'voice-explicit'`; `insertApproval` default unchanged | VERIFIED | Line 25: `export type ApprovalPath = 'explicit' \| 'silent' \| 'voice-explicit';`. Line 135: default still `'explicit'`. Committed at `1183926`. |
| `src/main/approvals/gate.ts` | Named `voice-forbidden-forced` branch in `ApprovalGateErrorCode` union, ordered before generic forced check | VERIFIED | `ApprovalGateErrorCode` union at lines 21-25 includes `'voice-forbidden-forced'`. Named branch at line 95, generic check at line 101 (branch ordering confirmed). Committed at `7cb1407`. |
| `src/main/voice/confirm.ts` | Pure dormant `voiceConfirm(db: Db, approvalId: string): void` wrapping `transitionTo`, zero callers | VERIFIED | Exports `voiceConfirm` with exact 2-arg signature. Body is single `transitionTo(db, approvalId, 'approved', { approval_path: 'voice-explicit' })` call. No read-back payload type defined. Zero callers in `src/main` (confirmed by grep). Committed at `daeb66f`. |
| `src/main/voice/confirm.spec.ts` | Unit tests: happy-path transition + invalid-transition-throws | VERIFIED | 2 tests, both pass. Committed at `daeb66f`. |
| `tests/integration/voice-confirm-gate.spec.ts` | SC2 failing-then-passing gate test + SC4 same-transition/unchanged-adapter test | VERIFIED | 7 tests, all pass. SC2 asserts `.code === 'voice-forbidden-forced'` (specific). SC4 uses `sendApprovedEmail` deps injection with stubbed `buildGmailClient`. Two-state expectation comment present. Committed at `174b890`, mock fix at `d59209a`. |
| `tests/static/voice-routes-through-staging.spec.ts` | SC3-phrased voice ratchet: no direct chokepoint calls from `src/main/voice/**` + D-09a banned literal; W-1 missing-dir guard | VERIFIED | 2 tests, both pass. SC3-phrased describe text present. `fs.existsSync(VOICE_ROOT)` guard implemented in `walk()`. Banned regex `/approval_path\s*:\s*['"]explicit['"]/` present. Committed at `28bb1ab`. |
| `tests/static/chokepoint-caller-allow-list.spec.ts` | Allow-list fencing 3 chokepoints to 3 IPC callers; offenders===[] + positive-match guards | VERIFIED | 6 tests (3 offenders + 3 positive assertions), all pass. Definition sites excluded. `stripComments` applied (block then line). Committed at `ab7d527`. |
| `.planning/research/ARCHITECTURE.md` | Corrected voice-confirm description at lines 122/306/314-316 from `'explicit'` to `'voice-explicit'`; forced/high-severity rejection described | VERIFIED | Lines 122, 306, 315 all reference `'voice-explicit'`. Non-negotiables bullet rewritten. D-13 verify command (`node -e "..."`) exits 0. Committed at `e5f740c`. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/main/voice/confirm.ts` | `src/main/approvals/persist.ts transitionTo` | `transitionTo(db, id, 'approved', { approval_path: 'voice-explicit' })` | VERIFIED | Single-line body confirmed. No raw SQL. Grep of `transitionTo` in confirm.ts returns the expected call. |
| `src/main/approvals/gate.ts` | `ApprovalGateError('voice-forbidden-forced', ...)` | Named branch at line 95 before generic branch at line 101 | VERIFIED | Line numbers confirmed by grep. Ordering is correct (named before generic). |
| `tests/static/chokepoint-caller-allow-list.spec.ts` | `src/main/ipc/gmail-send.ts` (sendApprovedEmail), `src/main/ipc/approvals.ts` (applyCalendarChange), `src/main/ipc/todoist.ts` (pushApprovedMeetingActions) | `ALLOWED_CALLERS` set + offenders===[] assertion | VERIFIED | All 6 tests pass including 3 positive-match guards confirming the regex matches real allowed callers. |
| `src/main/db/migrations/134_voice_explicit_path.sql` | `src/main/db/migrations/embedded.ts` | version-134 entry with byte-equivalent SQL | VERIFIED | Both contain `approval_path IN ('explicit','silent','voice-explicit')`. embedded.ts version-134 entry confirmed. |

---

### Data-Flow Trace (Level 4)

Not applicable to this phase — all deliverables are backend contract code (gate logic, dormant seam, static ratchets, migration). No components render dynamic data. The seam is intentionally dormant with zero callers.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| voiceConfirm unit tests (happy-path + invalid-transition) | `npx vitest run src/main/voice/confirm.spec.ts` | 2/2 passed | PASS |
| SC2 + SC4 integration gate tests (7 tests) | `npx vitest run tests/integration/voice-confirm-gate.spec.ts` | 7/7 passed | PASS |
| Voice ratchet (SC3 + D-09a, 2 tests) | `npx vitest run tests/static/voice-routes-through-staging.spec.ts` | 2/2 passed | PASS |
| Chokepoint allow-list ratchet (6 tests) | `npx vitest run tests/static/chokepoint-caller-allow-list.spec.ts` | 6/6 passed | PASS |

**Total: 17/17 tests pass across all four Phase 14 spec files.**

---

### Probe Execution

No declared probes for this phase.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| VOICE-10 | 14-01-PLAN.md, 14-02-PLAN.md, 14-03-PLAN.md | Approval-gated actions require voice-confirm contract: stage → gate rejection for forced/high → assertApproved. Voice can never auto-execute; blocked from satisfying forced-explicit override. Extends static ratchet to voice write-paths. | SATISFIED | Migration 134 + ApprovalPath union (stage foundation); gate.ts `voice-forbidden-forced` branch + voiceConfirm seam (gate enforcement); both static ratchets (write-path structural prevention). Read-back, dual-channel UX, and mishear recovery are explicitly deferred to Phase 17 per CONTEXT.md D-10/D-11 and the REQUIREMENTS.md traceability table. |

**Note on VOICE-10 scope:** VOICE-10 in REQUIREMENTS.md references the full contract including read-back and dual-channel confirm. The CONTEXT.md decisions (D-10/D-11, `<deferred>`) explicitly narrow Phase 14 to the backend contract/gate/ratchet seam only, deferring voice UI, read-back payload, dual-channel UX, and mishear recovery to Phase 17. The ROADMAP Phase 14 success criteria map exactly to this narrowed scope. The traceability table maps VOICE-10 to Phase 14 for the contract foundation, not the full VOICE-10 delivery.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

Scan performed on all Phase 14-modified files: `src/main/voice/confirm.ts`, `src/main/approvals/gate.ts`, `src/main/db/migrations/134_voice_explicit_path.sql`, `tests/static/chokepoint-caller-allow-list.spec.ts`, `tests/static/voice-routes-through-staging.spec.ts`, `tests/integration/voice-confirm-gate.spec.ts`. Zero TODO/FIXME/TBD/XXX/PLACEHOLDER markers found.

The three remaining occurrences of `explicit` in ARCHITECTURE.md at lines 55, 94, and 395 use the English adjective ("explicit approval transition", "explicit path") rather than the string literal `approval_path='explicit'`. The D-13 verification command (`node -e "if(/approval_path\s*=\s*'explicit'/.test(s))..."`) confirms no stale path-literal form remains. These are not blockers.

---

### Human Verification Required

None. All acceptance criteria for this phase are provable headlessly — the deliverable is a backend contract (gate logic, dormant seam, schema migration, static ratchets) with no audio, no UI, and no external service integration required. All 17 tests run and pass in the local environment.

---

## Gaps Summary

No gaps found. All 4 ROADMAP success criteria are verified by codebase evidence and passing tests.

---

_Verified: 2026-06-03T03:05:00Z_
_Verifier: Claude (gsd-verifier)_
