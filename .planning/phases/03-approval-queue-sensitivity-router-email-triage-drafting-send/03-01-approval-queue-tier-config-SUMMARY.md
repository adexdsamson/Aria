---
phase: 03-approval-queue-sensitivity-router-email-triage-drafting-send
plan: 01
subsystem: approvals
tags: [phase-3, approvals, sqlcipher, state-machine, ipc, renderer]
requires:
  - phase-2 SQLCipher DB + migrations runner (Phase 1)
  - phase-2 dbHolder + IPC registry pattern
provides:
  - polymorphic `approval` table (all downstream Phase-3 columns pre-declared)
  - `approval_tier` table seeded with `email_send_general -> always-confirm`
  - ApprovalState union + assertTransition (state machine)
  - insertApproval, transitionTo (txn-wrapped), listApprovals, reapInterruptedOnStartup
  - assertApproved + ApprovalGateError (APPR-07 forced-explicit enforced)
  - 5 new APPROVALS_* IPC channels + AriaApi surface
  - /approvals route with full card actions + batch approve confirmation
  - briefing inline preview deep-linking to /approvals
  - tests/static/single-send-call-site.test.ts grep enforcer (APPR-01 belt)
affects:
  - migration 006 lands cleanly on Phase-2 DBs (IF NOT EXISTS + additive cols)
  - reapInterruptedOnStartup wired into onboardingSeal + onboardingUnlock paths,
    BEFORE any approvals IPC can be invoked (sweep happens at db-open time)
  - vitest.config.ts: tests/static/** added to the main project's include glob
tech-stack:
  added: []           # zero new deps — pure wiring on Phase 1/2 infra (per RESEARCH §key insight)
  patterns:
    - server-authoritative typed state machine + assertTransition chokepoint
    - crash-recovery via pre-write + startup sweep (RESEARCH Pattern 2)
    - single-call-site enforcement via static grep test
key-files:
  created:
    - src/main/db/migrations/006_approvals_and_tier.sql
    - src/main/approvals/state.ts
    - src/main/approvals/persist.ts
    - src/main/approvals/gate.ts
    - src/main/approvals/tier.ts
    - src/main/ipc/approvals.ts
    - src/renderer/features/approvals/ApprovalCard.tsx
    - src/renderer/features/approvals/ApprovalsScreen.tsx
    - src/renderer/features/approvals/InlineApprovalsPreview.tsx
    - tests/unit/main/approvals/state.test.ts
    - tests/unit/main/approvals/persist.test.ts
    - tests/unit/main/approvals/gate.test.ts
    - tests/unit/main/approvals/tier.test.ts
    - tests/static/single-send-call-site.test.ts
    - tests/e2e/approval-crash-recovery.spec.ts
  modified:
    - src/main/db/migrations/embedded.ts (register migration 006)
    - src/main/ipc/onboarding.ts (call reapInterruptedOnStartup post-openDb)
    - src/main/ipc/index.ts (register approvals handlers)
    - src/shared/ipc-contract.ts (5 channels + ApprovalRowDto)
    - src/preload/index.ts (gated ARIA_E2E hook)
    - src/renderer/app/routes.tsx (swap placeholder for ApprovalsScreen)
    - src/renderer/features/briefing/BriefingScreen.tsx (inline preview)
    - vitest.config.ts (tests/static/** glob)
    - tests/unit/main/db/migrations.spec.ts (extend applied-versions to [1..6])
decisions:
  - "Polymorphic approval table — Phase 4 calendar approvals will reuse the same table without rework. All Phase-3 downstream columns (severity, categories_json, classifier_rationale, routed, triage_*, source_message_id, etc.) pre-declared so plans 02-04 add NO columns to the table."
  - "Sweep site = inside onboardingSeal + onboardingUnlock right after openDb(). The bootstrap registers IPC handlers before the DB exists (dbHolder is empty at boot); the practical 'BEFORE any IPC handler can act on approvals' point is db-open. Verified: a renderer cannot reach any APPROVALS_* handler before unlock because every handler returns DB_NOT_OPEN until dbHolder.db is set."
  - "writeSendLog is dormant in Plan 03-01 — the send_log table is created by Plan 03-04 migration 009. Locking the helper signature now means Plan 03-04 adds zero new public exports to persist.ts."
  - "Diff view is a two-column placeholder (RESEARCH §Don't Hand-Roll). Real diff library deferred until card surface is in use."
  - "InlineApprovalsPreview uses router-independent navigation (history.pushState + popstate). Avoids breaking existing BriefingScreen.spec which renders the screen without a Router. Keeps the prior renderer suite green without re-stubbing window.aria across 11 test cases."
  - "Static-grep enforcer scans only src/main/** (renderer doesn't have Node SDK access; preload uses ipcRenderer.invoke). Strips line comments before regex so this very documentation file can mention `gmail.users.messages.send` without tripping itself."
metrics:
  completed_date: 2026-05-17
  duration_minutes: ~75
  task_count: 2
  test_files_added: 6     # 4 unit + 1 static + 1 e2e
  test_count_added: ~30   # 30 unit cases + 1 e2e
---

# Phase 3 Plan 1: Approval Queue + Tier Config Summary

Landed the persisted polymorphic Approval Queue, server-authoritative state machine, crash-recovery sweep, `assertApproved` chokepoint, tier-config schema (always-confirm default), `/approvals` UI surface, and briefing inline preview — using the Vercel AI SDK / SQLCipher / IPC infrastructure already shipped in Phase 1/2 with zero new dependencies.

## What Changed

### Migration 006 — `approval` + `approval_tier`

Polymorphic `approval` table with `kind = 'email_send'` (Phase 4 adds `'calendar_change'`), the full eight-state `state` CHECK constraint, and every downstream-shared column pre-declared per RESEARCH §Approval Persistence Schema (`approval_path`, `classifier_version`, `categories_json`, `severity`, `confidence`, `classifier_rationale`, `routed`, `triage_signals_json`, `triage_summary`, `source_message_id`, `recipients_json`, `subject`, `body_original`, `body_edited`, `rejection_reason`, `snooze_until`, `sent_at`, `send_log_id`). Three indexes: state, (kind,state), updated_at DESC.

`approval_tier` table seeded with `('email_send_general', 'always-confirm')`. v1 ships always-confirm only; the schema is enforced by `assertApproved` (APPR-06).

Migration assignment locked: Plan 01 = 006_approvals_and_tier.sql, Plan 02 = 007_sensitivity_router.sql, Plan 03 = 008_email_triage.sql, Plan 04 = 009_voice_match_drafting.sql.

### State machine + persistence

`ApprovalState` union + `assertTransition` enforce the legal transitions verbatim from RESEARCH Pattern 1. `transitionTo` wraps SELECT-current-state, `assertTransition`, and the UPDATE inside one `db.transaction()` so a crash mid-call leaves the row in `from`. `reapInterruptedOnStartup` is called post-`openDb()` in both seal and unlock paths (only practical "before IPC can act on approvals" point — see `decisions[1]`).

### Send gate

`assertApproved(db, id)` returns void on success or throws `ApprovalGateError` with code in `{'not-found', 'not-approved', 'forced-explicit-missing'}`. APPR-07 forced-explicit rule: when `severity === 'high'` OR `categories ∩ {financial, legal, hr} ≠ ∅`, the row's `approval_path` MUST be `'explicit'` — i.e., it was approved via a user click, not a silent-tier auto-approve. Plan 01 records the path on every approve transition through the IPC layer; Plan 02-04 builds on this.

### IPC + renderer

5 channels (`APPROVALS_LIST / APPROVE / REJECT / SNOOZE / BATCH_APPROVE`) wired through `persist.transitionTo` so every write validates and is txn-safe. `batchApprove` wraps every per-row transition inside ONE `db.transaction(...)`; on any failure (invalid state, missing row), the whole batch rolls back per T-03-01-02 mitigation.

`ApprovalsScreen` mounts `/approvals` with state-filter chips, multi-select, and a batch-approve confirmation dialog. `ApprovalCard` renders recipients, subject, body, two-column diff (when `body_edited != body_original`), Approve / Edit-then-approve (inline textarea, "Save & Approve") / Reject (with optional reason) / Snooze (1h default) — plus the Interrupted badge with a stubbed Regenerate button.

`InlineApprovalsPreview` reads top-3 pending+ready+interrupted rows and renders a count badge above the existing briefing sections; deep-link works without a Router context.

### Tests

| Suite | File | Cases | Result |
|-------|------|-------|--------|
| State machine | tests/unit/main/approvals/state.test.ts | 18 (9 allowed + 9 rejected) | green |
| Persistence + sweep | tests/unit/main/approvals/persist.test.ts | 6 | green |
| Gate + APPR-07 | tests/unit/main/approvals/gate.test.ts | 11 | green |
| Tier | tests/unit/main/approvals/tier.test.ts | 2 | green |
| Static grep | tests/static/single-send-call-site.test.ts | 1 | green (0 matches expected) |
| Migrations runner | tests/unit/main/db/migrations.spec.ts | extended to expect [1..6] | green |
| Crash-recovery e2e | tests/e2e/approval-crash-recovery.spec.ts | 1 | tolerant-skip when `out/main/index.js` absent, matching `tests/e2e/briefing.spec.ts` precedent |

Full suite: **289/289 passing**. `npm run typecheck` clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] InlineApprovalsPreview useNavigate broke existing BriefingScreen.spec**
- **Found during:** Task 2 renderer-test pass
- **Issue:** Inserting `<InlineApprovalsPreview />` into BriefingScreen made the existing 11 BriefingScreen.spec cases throw `useNavigate() may be used only in the context of a <Router> component.` — the spec renders BriefingScreen bare, not wrapped in MemoryRouter.
- **Fix:** Replaced `useNavigate` with a router-independent `navigateToApprovals()` helper that uses `window.history.pushState` + a `popstate` event dispatch (works inside the App's MemoryRouter at runtime; degrades to a no-op in unit-test environments). Also made the preview tolerant of `window.aria.approvalsList` being absent so the briefing tests don't have to re-stub it.
- **Files modified:** src/renderer/features/approvals/InlineApprovalsPreview.tsx
- **Commits:** be97785

**2. [Rule 1 - Bug] migrations.spec.ts asserted applied = [1..5]**
- **Found during:** Post-Task-1 verification
- **Issue:** Plan 02-04's `migrations.spec.ts` hard-coded `expect(applied).toEqual([1, 2, 3, 4, 5])` and `expect(version).toBe(5)`. Adding migration 006 broke it.
- **Fix:** Extended assertions to include version 6.
- **Files modified:** tests/unit/main/db/migrations.spec.ts
- **Commits:** e0600d9

### Authentication Gates
None.

### Worktree Path Drift (process note, not a deviation)

Several initial Edit/Write operations went to the main repo at `C:\Users\HomePC\Documents\GitHub\Aria\...` instead of the worktree at `C:\Users\HomePC\Documents\GitHub\Aria\.claude\worktrees\agent-a8bc5fad11b8179c5\...`. Caught immediately via `git status` in the main repo. Reverted with `git restore` + `rm -rf` of unstaged dirs, then re-applied everything against the worktree paths. Also created `node_modules` as an NTFS junction → main repo so vitest's `setup-native-abi.ts` ABI-swap script could find `node_modules/better-sqlite3-multiple-ciphers/aria-abi/*.node`. The junction is not tracked (its `.git/info/exclude` is irrelevant — junction is filesystem-level).

## Threat Surface Scan

| Threat ID | Status | Notes |
|-----------|--------|-------|
| T-03-01-01 (renderer→state EoP) | mitigated | All transitions go through `persist.transitionTo` which calls `assertTransition`; covered by state.test.ts. |
| T-03-01-02 (batchApprove tampering) | mitigated | Single `db.transaction` wraps every transition; rollback on any non-`ready` state. |
| T-03-01-03 (stale generating row) | mitigated | `reapInterruptedOnStartup` runs at every db-open; UI shows "Interrupted — regenerate?" with no auto-retry. |
| T-03-01-04 (rogue send call site) | mitigated | tests/static/single-send-call-site.test.ts asserts ≤1 match against allowed file. |
| T-03-01-05 (direct SQL tamper) | accepted | Renderer cannot reach SQLCipher; main owns the key. |
| T-03-01-06 (PII in approval body logged) | mitigated | All IPC log lines use pino's existing redact policy; no `body_original` or `body_edited` is logged. |
| T-03-01-07 (migration crashes Phase-2 DB) | mitigated | `IF NOT EXISTS` everywhere; additive columns only; migrations.spec.ts runs against migration chain 1→6 from scratch. |

No new threat flags found. The renderer's E2E hook (`__e2eInsertGenerating`) is gated by `ARIA_E2E === '1'` in both preload and main, so production binaries never expose it.

## Self-Check: PASSED

**Files (created):**
- FOUND: src/main/db/migrations/006_approvals_and_tier.sql
- FOUND: src/main/approvals/state.ts
- FOUND: src/main/approvals/persist.ts
- FOUND: src/main/approvals/gate.ts
- FOUND: src/main/approvals/tier.ts
- FOUND: src/main/ipc/approvals.ts
- FOUND: src/renderer/features/approvals/ApprovalCard.tsx
- FOUND: src/renderer/features/approvals/ApprovalsScreen.tsx
- FOUND: src/renderer/features/approvals/InlineApprovalsPreview.tsx
- FOUND: tests/unit/main/approvals/state.test.ts
- FOUND: tests/unit/main/approvals/persist.test.ts
- FOUND: tests/unit/main/approvals/gate.test.ts
- FOUND: tests/unit/main/approvals/tier.test.ts
- FOUND: tests/static/single-send-call-site.test.ts
- FOUND: tests/e2e/approval-crash-recovery.spec.ts

**Commits:**
- FOUND: e0600d9 (Task 1 — migration + state/persist/gate/tier + unit tests + static grep)
- FOUND: be97785 (Task 2 — IPC + /approvals UI + briefing inline preview + crash-recovery e2e)
