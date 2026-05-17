---
phase: 03-approval-queue-sensitivity-router-email-triage-drafting-send
plan: 03
subsystem: triage
tags: [email-triage, thread-summary, EMAIL-03, EMAIL-04, briefing]
requires:
  - 03-01 (approval table — source_message_id column, ApprovalCard render hook)
  - 03-02 (LLMRouter, dispatchHybrid, tokenize/rehydrate)
  - migration 002 (gmail_message)
  - migration 005 (briefing)
provides:
  - email_triage table (migration 008)
  - triageMessage() + TriageSchema + TRIAGE_CLASSIFIER_VERSION
  - summarizeThread() + ThreadSummarySchema (on-demand, not persisted)
  - aria:triage:summarize-thread IPC
  - aria:triage:get-for-message IPC
  - ApprovalCard triage signal chips + summary line
  - ThreadSummaryModal (renderer dialog)
  - post-sync onMessagesInserted hook on GmailSync (delta-only)
affects:
  - briefing email section now JOINs email_triage (was: is_important filter)
  - sync-gmail.ts emits delta-only post-insert hook
tech-stack:
  added: []
  patterns:
    - Injectable dispatchFn seam for LLM calls (router-agnostic in unit tests)
    - Store-once immutability via PRIMARY KEY + INSERT OR IGNORE
    - Per-request token-table approvalId for thread summary (T-03-03-03)
    - Schema-graceful fallbacks (try/catch around email_triage SELECT in briefing)
key-files:
  created:
    - src/main/db/migrations/008_email_triage.sql
    - src/main/triage/email.ts
    - src/main/triage/thread.ts
    - src/main/ipc/triage.ts
    - src/renderer/features/email/ThreadSummaryModal.tsx
    - tests/unit/main/triage/email.test.ts
    - tests/unit/main/triage/thread.test.ts
    - tests/integration/triage-on-sync.test.ts
  modified:
    - src/main/db/migrations/embedded.ts (added version 8)
    - src/main/integrations/google/sync-gmail.ts (onMessagesInserted hook)
    - src/main/briefing/generate.ts (gatherEmailCandidates JOIN; B4 SC2 probe)
    - src/main/ipc/index.ts (registerTriageHandlers wiring)
    - src/shared/ipc-contract.ts (channels, DTOs, AriaApi methods)
    - src/renderer/features/approvals/ApprovalCard.tsx (triage chips + summary)
    - tests/unit/main/db/migrations.spec.ts (user_version=8)
    - tests/unit/main/briefing/generate.spec.ts (seed email_triage rows)
decisions:
  - "VIP signal deferred in v1: gmail_message has no direction column; LLM-emitted signals only. Phase 6 contacts directory replaces."
  - "Triage rows are store-once immutable; classifier_version stamped. Re-classification on version upgrade deferred per CONTEXT."
  - "summarizeThread is router-agnostic via dispatchFn seam — production wiring uses dispatchHybrid; tests can inject any callback."
  - "Sync hook computes delta-only ids via SELECT-before-upsert; falls back to no-op on shim DBs without that prepared statement."
metrics:
  duration: ~70min
  completed: 2026-05-18
---

# Phase 3 Plan 3: Email Triage + Thread Summary Summary

EMAIL-03 + EMAIL-04 landed. Every freshly-ingested Gmail message now generates exactly one immutable triage row (priority + signals + summary + classifier_version) via a delta-only post-sync hook; the briefing email section JOINs `email_triage` and surfaces priority IN ('urgent','needs-you') instead of Phase 2's IMPORTANT-label placeholder; users can ask for an on-demand thread summary that reuses Plan 02's hybrid router so HR/legal/financial threads stay LOCAL.

## Tasks

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Migration 008 + triage/email.ts + sync hook + briefing rewrite | a1ddc2a | migration 008, embedded.ts, triage/email.ts, sync-gmail.ts, briefing/generate.ts, email.test.ts, triage-on-sync.test.ts, migrations.spec.ts, generate.spec.ts |
| 2 | thread.ts + IPC + ApprovalCard chips + ThreadSummaryModal | 0074610 | triage/thread.ts, ipc/triage.ts, ipc/index.ts, ipc-contract.ts, ApprovalCard.tsx, ThreadSummaryModal.tsx, thread.test.ts |

## Verification

- `tests/unit/main/triage/email.test.ts`: 7 cases — TriageSchema rejects unknown priority + empty signals + 280-char cap; happy-path persists row with `classifier_version` stamped; throw → fallback row (priority='fyi', signals=['automated'], summary='triage unavailable'); idempotency (second call no-ops); scheduler.queue dispatch asserted; malformed-output rejected via Zod.
- `tests/unit/main/triage/thread.test.ts`: 8 cases — happy path, no-persist invariant, HR-flagged routes through injected dispatch (production router enforces forced-local), single-message and empty-thread paths, queue dispatch, fallback on throw.
- `tests/integration/triage-on-sync.test.ts`: 3 cases — hook fires once per new message (3 inserts → 1 hook call with [m1,m2,m3]); delta-only on re-sync (4-msg list with 3 existing → hook fires only with ['m4']); briefing JOIN selects urgent first, then needs-you, excludes 'fyi'.
- `tests/unit/main/db/migrations.spec.ts`: user_version=8; migrations array length 8.
- `tests/unit/main/briefing/generate.spec.ts`: all 15 pre-existing cases still pass after seeding email_triage rows in `seedGmailMessages` (priority='urgent' when test asks for `important: 1`; 'fyi' otherwise).
- `tests/unit/main/integrations/google/sync-gmail.spec.ts`: all 7 cases pass; onMessagesInserted is optional and absent in legacy tests.
- typecheck: `tsc --noEmit -p tsconfig.json` exits clean.

## Success Criteria

- [x] All unit + integration tests green (8 + 7 + 3 + 1 + 15 + 7 = 41 in scope; 41/41 pass)
- [x] Migration 008 applies cleanly to Phase 2 + Plan 03-01 + Plan 03-02 DBs (user_version 7 → 8)
- [x] After sync of N new messages, email_triage table contains exactly N rows with stamped classifier_version
- [x] Briefing email section sourced from email_triage JOIN; Phase 2 placeholder copy semantics rewritten (probe detects untriaged backlog)
- [x] ApprovalCard renders signal chips + triage summary line when source_message_id has a triage row
- [x] Thread summary modal renders loading / error+retry / ready states; HR/legal/financial threads force local through router (production-side; unit asserts router-agnostic dispatch surface)
- [x] ROADMAP success criterion 6 met (structured + auditable rationale via TriageSchema + classifier_version stamp)

## Threat Mitigations Applied

| ID | Mitigation | Where |
|----|------------|-------|
| T-03-03-01 | Triage priority informs UI surfacing only; never bypasses APPR-01 gate | email_triage rows feed briefing/ApprovalCard; no IPC mutates approval state |
| T-03-03-02 | summarizeThread routes via dispatchHybrid; HR/legal/financial categories force LOCAL | `src/main/ipc/triage.ts::makeProductionDispatch` — frontier provider returned `null` for those categories |
| T-03-03-03 | Per-request approvalId = `thread-summary-${threadId}-${uuid}`; disposeDraftTable in finally | `src/main/ipc/triage.ts` |
| T-03-03-04 | Triage dispatched via scheduler.queue (concurrency=1); sync completion does NOT await hook drain | `sync-gmail.ts` onMessagesInserted; `triage/email.ts` queue.add |
| T-03-03-05 | classifier_version stamped on every row | `email_triage.classifier_version NOT NULL`; auto-re-rationale on upgrade DEFERRED |
| T-03-03-06 | XCUT-03 pino redact sink covers; no console.log of summary fields | inherited from Phase 1 |
| T-03-03-07 | B4 SC2 fallback probe rewritten to detect untriaged backlog (LEFT JOIN ... WHERE t.message_id IS NULL) | `briefing/generate.ts` |

## Deviations from Plan

### Auto-fixed Issues

1. **[Rule 1 — Bug] Briefing test regression after gatherEmailCandidates rewrite**
   - **Found during:** Task 1 — after switching briefing's email source to email_triage JOIN, 5 of 15 `tests/unit/main/briefing/generate.spec.ts` cases failed because the seed helper only inserted gmail_message rows and not email_triage rows.
   - **Fix:** Extended `seedGmailMessages` to also INSERT an email_triage row per seeded message, with priority='urgent' when the test seeded `important: 1` (preserving the test's "visible to briefing" intent) and priority='fyi' otherwise (preserving "excluded" intent). Case 7 inlines its own seed loop; same insert added inline.
   - **Files modified:** tests/unit/main/briefing/generate.spec.ts
   - **Commit:** a1ddc2a

2. **[Rule 3 — Blocking] Test path mismatch with vitest project include**
   - **Found during:** Task 1 — plan specified `tests/unit/triage/email.test.ts`, but vitest's main project include is `tests/unit/main/**/*.{test,spec}.ts`. The plan-prescribed path would silently be skipped.
   - **Fix:** Placed test under `tests/unit/main/triage/email.test.ts` (and `thread.test.ts`). Integration test at `tests/integration/triage-on-sync.test.ts` per plan.
   - **Files modified:** path of created tests
   - **Commit:** a1ddc2a / 0074610

3. **[Rule 3 — Blocking] gmail_message has no `direction` column for VIP heuristic**
   - **Found during:** Task 1 design — plan called out the "top-20-replied senders" heuristic but the Phase 2 gmail_message schema (migration 002) does not record a `direction`. Plan explicitly authorized skipping VIP detection in v1 if so.
   - **Fix:** Documented in `triage/email.ts` header comment; signals come exclusively from the LLM in v1. Phase 6 contacts directory replaces.
   - **Commit:** a1ddc2a

4. **[Rule 3 — Blocking] Worktree-vs-main repo path confusion (#3099)**
   - **Found during:** Task 1 — initial Edit/Write operations used the absolute path `C:\Users\HomePC\Documents\GitHub\Aria\...` which resolves to the main repo, not the worktree. Files were created in the main repo and the worktree's `git status` came up clean.
   - **Fix:** Captured the main-repo diffs with `git diff`, applied them to the worktree with `git apply`, then restored the main repo via `git checkout` and removed leaked untracked files. Switched all subsequent Edit/Write operations to relative paths.
   - **Files modified:** none of the work was lost; recovery preserved every change.
   - **Commit:** a1ddc2a (recovered into Task 1 commit)

## Known Stubs

None. Every UI surface (ApprovalCard chips, ThreadSummaryModal) wires to a real IPC call and a real DB row.

## Notes

- **VIP signals deferred** by design per plan §action — Phase 6 contacts directory will source `from-vip`.
- **Thread summary not persisted** — re-opening the modal triggers a new LLM call. Adequate for v1 EMAIL-04 ("ad-hoc rationale"). Caching can be layered later without schema change.
- **Re-classification on classifier_version upgrade** is explicitly deferred to a future plan; the column exists so we can detect drift.

## Self-Check: PASSED

- Migration 008 file present: src/main/db/migrations/008_email_triage.sql ✓
- triage/email.ts and triage/thread.ts present ✓
- ipc/triage.ts present and wired in ipc/index.ts ✓
- ipc-contract.ts has 2 new channels + 2 AriaApi methods + DTOs ✓
- ApprovalCard.tsx renders triage chips when source_message_id has a row ✓
- ThreadSummaryModal.tsx renders loading / error+retry / ready states ✓
- Commits a1ddc2a and 0074610 present in `git log` ✓
- 41/41 in-scope tests green; typecheck clean ✓
