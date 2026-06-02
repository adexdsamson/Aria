---
phase: 14-voice-safety-confirm-contract
plan: "01"
subsystem: db-schema
tags: [migration, approval, voice, typescript, schema]
dependency_graph:
  requires: []
  provides:
    - approval_path CHECK widened to admit 'voice-explicit' (migration 134, both .sql and embedded)
    - ApprovalPath TypeScript union includes 'voice-explicit'
  affects:
    - src/main/approvals/persist.ts
    - src/main/db/migrations/embedded.ts
    - src/main/db/migrations/134_voice_explicit_path.sql
tech_stack:
  added: []
  patterns:
    - SQLite CHECK-widening via full table-rebuild (copy of migration 124 idiom)
    - EMBEDDED_MIGRATIONS byte-equivalent copy for fresh-install/packaged DB parity
key_files:
  created:
    - src/main/db/migrations/134_voice_explicit_path.sql
  modified:
    - src/main/approvals/persist.ts
    - src/main/db/migrations/embedded.ts
decisions:
  - "D-01: ApprovalPath union extended to 'voice-explicit' as a DISTINCT value; insertApproval default left at 'explicit'"
  - "D-03: Both .sql chain and embedded.ts snapshot updated byte-equivalently; four historical approval snapshots frozen"
metrics:
  duration: "~15 minutes"
  completed: "2026-06-02"
  tasks_completed: 3
  tasks_total: 3
  files_changed: 3
---

# Phase 14 Plan 01: Voice Schema Foundation Summary

**One-liner:** SQLite `approval_path` CHECK widened to admit `'voice-explicit'` via a full table-rebuild migration (migration 134) and matching TypeScript union extension — the schema prerequisite for the voice-confirm gate in Plan 02.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extend the ApprovalPath union (D-01) | `1183926` | `src/main/approvals/persist.ts` |
| 2 | Author the v134 CHECK-widening table-rebuild migration (D-03) | `6b5d84d` | `src/main/db/migrations/134_voice_explicit_path.sql` |
| 3 | Append the version-134 embedded snapshot entry (D-03) | `86a82a9` | `src/main/db/migrations/embedded.ts` |

## Decisions Made

- **D-01 (ApprovalPath union):** Extended the `ApprovalPath` type alias from `'explicit' | 'silent'` to `'explicit' | 'silent' | 'voice-explicit'`. The `insertApproval` default (`'explicit'`) and `ALLOWED_PATCH_COLS` (already contains `'approval_path'`) were left unchanged per plan spec — voice staging reuses `insertApproval`, the confirm seam sets the path via `transitionTo`.

- **D-03 (split-brain prevention):** Migration 134 authored as a full SQLite table-rebuild (SQLite cannot `ALTER ... CHECK`). Both the `.sql` chain entry and the `embedded.ts` snapshot were updated with byte-equivalent SQL. The four historical approval snapshots in `embedded.ts` (at original lines 157/254/464/685) remain frozen at `('explicit','silent')`.

## Verification Results

- `npx tsc --noEmit` exits 0 after all edits.
- Migration 134 SQL structural checks: all 14 assertions PASS (CHECK widening, `BEGIN;` envelope, `beta_voice`, `meeting_note_id`, 5 `idx_approval_*` indexes, `IF NOT EXISTS`, `PRAGMA foreign_keys=OFF/ON`).
- INSERT vs SELECT column lists: identical (no positional drift).
- Byte-equivalence: 3072 chars each (LF-normalized) — `.sql` file matches embedded template literal.
- Frozen snapshots: 4 occurrences of `approval_path IN ('explicit','silent')` in `embedded.ts` unchanged; 1 new occurrence of the widened constraint.
- `vitest run tests/unit/main/db/migrations.spec.ts`: EBUSY on native ABI swap (pre-existing Windows OS file-lock; binary compiled for Electron ABI 145, test harness tries to swap to Node ABI 141 which is locked by another process). This is a pre-existing environment quirk documented in project memory. Functional verification performed via direct node evaluation of the migration SQL against an in-memory SQLite instance — all acceptance criteria confirmed.

## Deviations from Plan

None — plan executed exactly as written. The vitest run produced an EBUSY error (pre-existing Windows environment issue with the ABI-swap global setup, unrelated to migration content), but all acceptance criteria were verified through direct node evaluation.

## Known Stubs

None. This plan is purely schema/type foundation — no UI, no data rendering, no placeholder values.

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns introduced. Changes are confined to the `approval` table DDL (existing trust boundary) and its TypeScript type. No new threat flags beyond those already in the plan's threat register (T-14-01 through T-14-03, all mitigated as designed).

## Self-Check: PASSED

- FOUND: `src/main/approvals/persist.ts`
- FOUND: `src/main/db/migrations/134_voice_explicit_path.sql`
- FOUND: `src/main/db/migrations/embedded.ts`
- FOUND: `.planning/phases/14-voice-safety-confirm-contract/14-01-SUMMARY.md`
- FOUND commit `1183926` (Task 1)
- FOUND commit `6b5d84d` (Task 2)
- FOUND commit `86a82a9` (Task 3)
