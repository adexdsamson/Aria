---
phase: 03-approval-queue-sensitivity-router-email-triage-drafting-send
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/main/db/migrations/embedded.ts
  - src/main/db/migrations/006_approvals_and_tier.sql
  - src/main/approvals/state.ts
  - src/main/approvals/persist.ts
  - src/main/approvals/gate.ts
  - src/main/approvals/tier.ts
  - src/main/index.ts
  - src/main/ipc/approvals.ts
  - src/shared/ipc-contract.ts
  - src/renderer/app/routes.tsx
  - src/renderer/features/approvals/ApprovalsScreen.tsx
  - src/renderer/features/approvals/ApprovalCard.tsx
  - src/renderer/features/approvals/InlineApprovalsPreview.tsx
  - src/renderer/features/briefing/BriefingScreen.tsx
  - tests/unit/approvals/state.test.ts
  - tests/unit/approvals/persist.test.ts
  - tests/unit/approvals/gate.test.ts
  - tests/unit/approvals/tier.test.ts
  - tests/e2e/approval-crash-recovery.spec.ts
  - tests/static/single-send-call-site.test.ts
autonomous: true
requirements: [APPR-01, APPR-03, APPR-04, APPR-05, APPR-06]
must_haves:
  truths:
    - "Approval rows persist across app restart in SQLCipher `approval` table"
    - "State machine rejects illegal transitions (e.g. ready->sent, generating->approved) at runtime"
    - "On startup, every `generating` row is swept to `interrupted` before any IPC handler registers"
    - "`/approvals` route renders pending+ready cards with approve/edit-then-approve/reject/snooze/batch actions"
    - "Briefing screen shows count badge + inline preview of top-N pending approvals deep-linking to `/approvals`"
    - "Tier config table seeded with `('email_send_general','always-confirm')`; tier.ts enforces lookup; no other tier rows user-editable in v1"
    - "`assertApproved(db, id)` throws `ApprovalGateError` if row missing, state!=='approved', or forced-explicit invariant unmet"
    - "Single static-grep test enforces zero call sites to `gmail.users.messages.send` outside `src/main/integrations/google/send.ts` (file may not exist yet — grep returns zero matches, test passes)"
  artifacts:
    - path: "src/main/db/migrations/006_approvals_and_tier.sql"
      provides: "approval, approval_tier, send_log tables per RESEARCH §Approval Persistence Schema"
      contains: "CREATE TABLE approval"
    - path: "src/main/approvals/state.ts"
      provides: "ApprovalState union + assertTransition()"
      exports: ["ApprovalState", "assertTransition"]
    - path: "src/main/approvals/persist.ts"
      provides: "CRUD + reapInterruptedOnStartup + transition wrapper"
      exports: ["insertApproval", "transitionTo", "listApprovals", "reapInterruptedOnStartup", "writeSendLog"]
    - path: "src/main/approvals/gate.ts"
      provides: "assertApproved + ApprovalGateError"
      exports: ["assertApproved", "ApprovalGateError"]
    - path: "src/main/approvals/tier.ts"
      provides: "tier schema + lookup; always-confirm default"
      exports: ["getTier", "TIER_DEFAULT"]
    - path: "src/renderer/features/approvals/ApprovalsScreen.tsx"
      provides: "/approvals route with card list, filters, batch select"
      min_lines: 80
    - path: "tests/static/single-send-call-site.test.ts"
      provides: "Grep enforcer for APPR-01 chokepoint"
      min_lines: 20
  key_links:
    - from: "src/main/index.ts"
      to: "src/main/approvals/persist.ts::reapInterruptedOnStartup"
      via: "post-db-open boot sequence, BEFORE IPC handler registration"
      pattern: "reapInterruptedOnStartup\\(db\\)"
    - from: "src/main/ipc/approvals.ts"
      to: "src/main/approvals/state.ts::assertTransition"
      via: "every state-changing IPC handler validates transition first"
      pattern: "assertTransition\\("
    - from: "src/renderer/features/briefing/BriefingScreen.tsx"
      to: "src/renderer/features/approvals/InlineApprovalsPreview.tsx"
      via: "inline component import; deep-link to /approvals"
      pattern: "InlineApprovalsPreview"
---

<objective>
Land the Approval Queue foundation: persisted polymorphic `approval` table, typed state machine, crash-recovery sweep, `assertApproved` chokepoint, tier-config schema (always-confirm default), `/approvals` UI surface, and briefing inline preview. This plan establishes the contract every subsequent Phase 3 plan (and Phase 4 calendar approvals) builds on.

Purpose: Lock APPR-01/03/04/05/06 invariants — outbound communication CANNOT leave Aria without an approved row, queue survives crashes, tier config exists and is enforced even though only `always-confirm` ships as user-selectable. Establishes the polymorphic schema (kind column) that Phase 4 calendar approvals will reuse without rework.

Output:
- Migration 006_approvals_and_tier.sql creating `approval` table (with ALL downstream-shared columns pre-declared: approval_path, classifier_version, categories_json, severity, confidence, classifier_rationale, routed, source_message_id, triage_signals_json, triage_summary, etc. per RESEARCH Approval Persistence Schema) + `approval_tier` table. send_log lands in Plan 04 migration 009_voice_match_drafting.sql.
- `src/main/approvals/{state,persist,gate,tier}.ts` modules with full unit coverage.
- Renderer `/approvals` route + briefing inline preview component.
- Static-grep test asserting single send call site (initially zero — passes; plan 03-04 will add the one allowed match).
- Crash-recovery Playwright e2e proving APPR-05 survival.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/03-approval-queue-sensitivity-router-email-triage-drafting-send/03-CONTEXT.md
@.planning/phases/03-approval-queue-sensitivity-router-email-triage-drafting-send/03-RESEARCH.md
@.planning/phases/02-gmail-ingest-daily-briefing-mvp/02-CONTEXT.md
@src/main/db/migrations/embedded.ts
@src/main/db/connect.ts
@src/main/briefing/persist.ts
@src/shared/ipc-contract.ts
@src/renderer/app/routes.tsx
@src/renderer/features/briefing/BriefingScreen.tsx
</context>

<interfaces>
<!-- Contracts downstream Phase 3 plans (02/03/04) consume. Defined here in Task 1. -->

From src/main/approvals/state.ts:
- `type ApprovalState = 'pending'|'generating'|'ready'|'approved'|'rejected'|'snoozed'|'interrupted'|'sent'`
- `function assertTransition(from: ApprovalState, to: ApprovalState): void` — throws `invalid-transition:from->to`

From src/main/approvals/persist.ts:
- `interface ApprovalRow { id; kind:'email_send'; state:ApprovalState; created_at; updated_at; source_message_id?; recipients_json?; subject?; body_original?; body_edited?; classifier_version?; categories_json?; severity?; confidence?; classifier_rationale?; routed?; triage_signals_json?; triage_summary?; rejection_reason?; snooze_until?; sent_at?; send_log_id?; approval_path?:'explicit'|'silent' }`
- `function insertApproval(db, row: NewApprovalInput): string` (returns id)
- `function transitionTo(db, id: string, to: ApprovalState, patch?: Partial<ApprovalRow>): void` (wraps assertTransition + UPDATE in txn)
- `function listApprovals(db, opts?: { states?: ApprovalState[]; limit?: number }): ApprovalRow[]`
- `function reapInterruptedOnStartup(db): number`
- `function writeSendLog(db, args: { approvalId; ok: 0|1; providerMsgId?: string; error?: string; recipients: string[] }): number`

From src/main/approvals/gate.ts:
- `class ApprovalGateError extends Error { code: 'not-found'|'not-approved'|'forced-explicit-missing' }`
- `function assertApproved(db, approvalId: string): void`

From src/main/approvals/tier.ts:
- `type Tier = 'silent'|'explicit'|'always-confirm'`
- `const TIER_DEFAULT: Tier = 'always-confirm'`
- `function getTier(db, contentClass: string): Tier`

From src/shared/ipc-contract.ts (additions):
- `aria.approvals.list({ states?, limit? }) -> ApprovalRow[]`
- `aria.approvals.approve({ id, edited?: { body, subject } }) -> { ok: true }`
- `aria.approvals.reject({ id, reason?: string }) -> { ok: true }`
- `aria.approvals.snooze({ id, until: ISOString }) -> { ok: true }`
- `aria.approvals.batchApprove({ ids: string[] }) -> { ok: true; count: number }`
</interfaces>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Migration 006 + state machine + persistence + gate + tier contracts (Wave 0 tests landed first)</name>
  <files>src/main/db/migrations/006_approvals_and_tier.sql, src/main/db/migrations/embedded.ts, src/main/approvals/state.ts, src/main/approvals/persist.ts, src/main/approvals/gate.ts, src/main/approvals/tier.ts, src/main/index.ts, tests/unit/approvals/state.test.ts, tests/unit/approvals/persist.test.ts, tests/unit/approvals/gate.test.ts, tests/unit/approvals/tier.test.ts, tests/static/single-send-call-site.test.ts</files>
  <behavior>
    Wave 0 — write failing tests FIRST per RESEARCH §Validation Architecture:
    - state.test: assertTransition allows pending->generating, generating->ready, generating->interrupted, ready->approved, ready->rejected, ready->snoozed, snoozed->ready, interrupted->generating, approved->sent; REJECTS pending->sent, ready->sent, generating->approved, sent->anything, rejected->anything.
    - persist.test: insert returns uuid; transitionTo throws on invalid transitions; reapInterruptedOnStartup updates rows in `generating` to `interrupted` AND returns the count; writeSendLog inserts row + returns id.
    - gate.test: assertApproved throws ApprovalGateError code='not-found' for unknown id; 'not-approved' when state!='approved'; 'forced-explicit-missing' when severity='high' AND approval_path='silent'; passes when state='approved' AND (not forced OR approval_path='explicit'). Cover all three categories financial|legal|hr individually triggering forced path.
    - tier.test: getTier returns 'always-confirm' for 'email_send_general' (seeded); returns TIER_DEFAULT for any unknown class.
    - single-send-call-site.test: greps src/main/** for `users.messages.send`; asserts matches.length <= 1 AND every match's file path equals 'src/main/integrations/google/send.ts'. At this plan's commit time the file does not exist; expected matches = 0; test passes.

    Then implement to GREEN.

    Migration 006_approvals_and_tier.sql per RESEARCH Approval Persistence Schema -- create `approval` and `approval_tier` tables ONLY (send_log table deferred to Plan 04 migration 009_voice_match_drafting.sql). Pre-declare ALL downstream-shared columns on `approval` so later plans need NOT add columns to this table: `approval_path TEXT NOT NULL DEFAULT 'explicit' CHECK (approval_path IN ('explicit','silent'))` (APPR-07 belt+suspenders per RESEARCH Example 1), `classifier_version TEXT`, `categories_json TEXT`, `severity TEXT`, `confidence REAL`, `classifier_rationale TEXT`, `routed TEXT`, `source_message_id TEXT`, `triage_signals_json TEXT`, `triage_summary TEXT`, `rejection_reason TEXT`, `snooze_until TEXT`, `sent_at TEXT`, `send_log_id INTEGER`, `body_original TEXT`, `body_edited TEXT`, `recipients_json TEXT`, `subject TEXT`. Migration assignment is LOCKED: Plan 01=006_approvals_and_tier.sql, Plan 02=007_sensitivity_router.sql, Plan 03=008_email_triage.sql, Plan 04=009_voice_match_drafting.sql. Register 006 in embedded.ts migrations array following Phase 1 pattern.

    state.ts: export `ApprovalState` union + `ALLOWED` map + `assertTransition` per RESEARCH §Pattern 1 verbatim.

    persist.ts: insertApproval (crypto.randomUUID, INSERT inside db.transaction); transitionTo (SELECT current state; assertTransition; UPDATE state+updated_at+patch in same txn); listApprovals (WHERE state IN (...) ORDER BY updated_at DESC LIMIT ?); reapInterruptedOnStartup per RESEARCH §Pattern 2 verbatim; writeSendLog targets the send_log table (table itself is created by Plan 04 migration 009_voice_match_drafting.sql; Plan 01 ships the helper signature only -- calls to writeSendLog from Plan 01 code paths are nonexistent, so the function is dormant until Plan 04 lands the table).

    gate.ts: ApprovalGateError + assertApproved per RESEARCH §Example 1 verbatim, including the FORCED_CATEGORIES set and approval_path check.

    tier.ts: seed migration also INSERTs `('email_send_general','always-confirm')`; getTier does single-row SELECT with TIER_DEFAULT fallback. v1 ships always-confirm only — do NOT expose tier mutation IPC (allowlist UI deferred per CONTEXT §deferred).

    index.ts: after `openDb()` call and BEFORE any `ipcMain.handle(...)` registration, call `reapInterruptedOnStartup(db)`; log the changed count via existing pino logger.
  </behavior>
  <action>Implement per <behavior>. Use existing Phase 1/2 patterns from src/main/briefing/persist.ts (upsert + txn) and src/main/db/migrations/embedded.ts (migration registration). All decisions reference RESEARCH §Approval Persistence Schema, §Pattern 1, §Pattern 2, §Example 1 and CONTEXT decisions on tier (always-confirm v1) and forced-explicit (APPR-07). Use crypto.randomUUID() per RESEARCH A3. Do NOT bump electron version (locked at 41.6.1 per CONTEXT prior_decisions).</action>
  <verify>
    <automated>npm run test:unit -- tests/unit/approvals tests/static/single-send-call-site.test.ts</automated>
  </verify>
  <done>All five unit test files green; migration 006 applies cleanly on fresh DB and on Phase 2 DB; single-send-call-site test passes (zero matches expected at this stage).</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: IPC layer + renderer /approvals screen + briefing inline preview + crash-recovery e2e</name>
  <files>src/main/ipc/approvals.ts, src/shared/ipc-contract.ts, src/renderer/app/routes.tsx, src/renderer/features/approvals/ApprovalsScreen.tsx, src/renderer/features/approvals/ApprovalCard.tsx, src/renderer/features/approvals/InlineApprovalsPreview.tsx, src/renderer/features/briefing/BriefingScreen.tsx, tests/e2e/approval-crash-recovery.spec.ts</files>
  <behavior>
    IPC handlers (all writes go through persist.transitionTo so assertTransition fires):
    - approvals.list — listApprovals(db, { states: ['pending','generating','ready','interrupted','snoozed'] }) default
    - approvals.approve — set body_edited if edited, set approval_path='explicit', transitionTo('approved')
    - approvals.reject — set rejection_reason, transitionTo('rejected')
    - approvals.snooze — set snooze_until, transitionTo('snoozed')
    - approvals.batchApprove — wrap in single db.transaction; on any failure rollback whole batch; return count

    Renderer ApprovalsScreen.tsx: TanStack Query useQuery('approvals') -> ApprovalCard list. Filter chips by state. Multi-select w/ explicit confirmation dialog before batchApprove (per CONTEXT card actions "Batch approve (multi-select with explicit confirmation UX)").

    ApprovalCard.tsx: renders recipients, subject, body preview, diff if body_edited != body_original (two-column view per RESEARCH §Don't Hand-Roll — defer real diff lib), and the four primary actions + Edit-then-approve (inline textarea + Save+Approve). Show `interrupted` state with badge "Interrupted — regenerate?" (regenerate button wired to no-op in this plan; plan 03-04 attaches drafting agent). Show classifier rationale chip if categories/severity columns populated (populated by plan 03-02).

    InlineApprovalsPreview.tsx: small component reading top-3 pending+ready approvals; renders count badge + 3-row preview; deep-link button "/approvals".

    BriefingScreen.tsx: import InlineApprovalsPreview at top of body, above existing sections.

    routes.tsx: add `<Route path="/approvals" element={<ApprovalsScreen/>} />`.

    Crash-recovery e2e per RESEARCH §Example 3 — launch app, IPC-insert an approval row with state='generating', process.exit(137), relaunch, navigate to /approvals, expect "Interrupted — regenerate?" text visible. Run on Win (current dev env) via playwright _electron.
  </behavior>
  <action>Implement IPC contracts per <interfaces> block. Renderer uses existing shadcn primitives (no new packages). Diff view = two-column placeholder per RESEARCH §Don't Hand-Roll (defer jsdiff). All IPC handlers must call persist.transitionTo (not raw UPDATEs) so assertTransition runs. No code path in this plan should call gmail send — single-send-call-site test must still pass post-merge. CONTEXT decisions referenced: card-actions full set, both surfaces (briefing inline + /approvals dedicated), no auto-retry of interrupted.</action>
  <verify>
    <automated>npm run test:unit -- tests/unit/approvals tests/static/single-send-call-site.test.ts && npx playwright test tests/e2e/approval-crash-recovery.spec.ts</automated>
  </verify>
  <done>/approvals route navigable; cards render all 4 actions + edit; batch-approve confirmation modal works; briefing shows inline preview when approvals exist; crash-recovery e2e green; single-send-call-site still 0 matches.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Renderer → Main (IPC) | Renderer is untrusted relative to send authorization; only main owns DB key and approval state |
| Main process → SQLCipher | All approval writes inside transactions; renderer cannot write directly |
| Future: Main → Gmail API | Out of this plan; plan 03-04 lands the chokepoint. This plan enforces the *absence* of any send call site via static grep. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03-01-01 | Elevation of Privilege | renderer IPC → approval state transition | mitigate | All transitions go through `persist.transitionTo` which calls `assertTransition`; illegal moves throw; tested in state.test.ts. |
| T-03-01-02 | Tampering | renderer crafts batchApprove with non-`ready` ids | mitigate | batchApprove wrapped in db.transaction; transitionTo enforces `ready->approved` only; entire batch rolls back on any failure. |
| T-03-01-03 | Repudiation | stale `generating` row silently retries | mitigate | reapInterruptedOnStartup converts to `interrupted`; no code path auto-transitions `interrupted->generating` (CONTEXT-locked). UI requires explicit click. |
| T-03-01-04 | Elevation of Privilege | future code adds direct `gmail.users.messages.send` call site bypassing gate | mitigate | tests/static/single-send-call-site.test.ts asserts matches.length <= 1 AND path equals send.ts; runs in CI. |
| T-03-01-05 | Tampering | direct SQL write to approval_path='explicit' from compromised renderer | accept | Renderer cannot reach SQLCipher; main owns key; documented in CONTEXT trust posture. |
| T-03-01-06 | Information Disclosure | approval body contains PII surfaced in renderer log | mitigate | Reuse Phase 1 pino redact sink (XCUT-03 cross-cutting); no console.log of body fields in IPC handler. |
| T-03-01-07 | Denial of Service | malformed migration crashes on existing Phase 2 DB | mitigate | Migration uses IF NOT EXISTS + additive columns only; tested against fresh DB AND Phase 2 fixture in persist.test.ts setup. |
</threat_model>

<verification>
- APPR-01 (no send without approval): static grep test asserts zero `gmail.users.messages.send` call sites in this plan; plan 03-04 will add exactly one inside `assertApproved`-gated send.ts.
- APPR-03 (card shows recipients/subject/body/diff): ApprovalCard renders all four; e2e visible.
- APPR-04 (approve/edit-then-approve/reject + rejections recorded): IPC contracts + rejection_reason column + state.test transitions.
- APPR-05 (queue survives restart; interrupted on crash): tests/e2e/approval-crash-recovery.spec.ts.
- APPR-06 (tier schema enforced; always-confirm default): tier.test.ts + seed row + getTier fallback.
- Forced-explicit infra (used by APPR-07 in plan 03-02): approval_path column + assertApproved branch unit-tested in gate.test.ts.
</verification>

<success_criteria>
- All unit tests under tests/unit/approvals green
- tests/static/single-send-call-site.test.ts green
- Crash-recovery e2e green on Windows dev env
- Migration 006 applies cleanly to fresh and Phase-2 DBs
- /approvals route accessible; briefing inline preview visible when approvals exist
- ROADMAP plan 1 marked complete; APPR-01/03/04/05/06 success-criteria items 1, 4, 7 (partial — schema present) demonstrably met
</success_criteria>

<output>
After completion: `.planning/phases/03-approval-queue-sensitivity-router-email-triage-drafting-send/03-01-SUMMARY.md`
</output>
