---
phase: 03-approval-queue-sensitivity-router-email-triage-drafting-send
plan: 03
type: execute
wave: 3
depends_on: [03-01, 03-02]
files_modified:
  - src/main/db/migrations/008_email_triage.sql
  - src/main/db/migrations/embedded.ts
  - src/main/triage/email.ts
  - src/main/triage/thread.ts
  - src/main/integrations/google/sync-gmail.ts
  - src/main/ipc/triage.ts
  - src/main/briefing/generate.ts
  - src/shared/ipc-contract.ts
  - src/renderer/features/approvals/ApprovalCard.tsx
  - src/renderer/features/briefing/BriefingScreen.tsx
  - src/renderer/features/email/ThreadSummaryModal.tsx
  - tests/unit/triage/email.test.ts
  - tests/unit/triage/thread.test.ts
  - tests/integration/triage-on-sync.test.ts
autonomous: true
requirements: [EMAIL-03, EMAIL-04]
must_haves:
  truths:
    - "Every newly-inserted gmail_message triggers exactly one triage run; result persisted to email_triage table keyed by message_id"
    - "Triage result includes priority (urgent|needs-you|fyi|archive), signals array, summary string, classifier_version"
    - "Existing rows are NOT re-triaged when sync runs again (delta-only)"
    - "Triage classifier dispatched via scheduler.queue (p-queue concurrency 1) — one LLM call per new message"
    - "Briefing email section JOINs email_triage and selects priority IN ('urgent','needs-you'); Phase 2 IMPORTANT-label placeholder removed"
    - "ApprovalCard renders triage signal chips + summary when approval.source_message_id has an email_triage row"
    - "Thread summarization on-demand IPC handler reads all gmail_message WHERE thread_id=? from SQLCipher (no Gmail API call); returns structured summary; result NOT persisted (one-off per request)"
    - "Thread summarization reuses Plan 02's router so HR/legal/financial threads stay LOCAL"
  artifacts:
    - path: "src/main/db/migrations/008_email_triage.sql"
      provides: "email_triage table per RESEARCH §Approval Persistence Schema"
      contains: "CREATE TABLE email_triage"
    - path: "src/main/triage/email.ts"
      provides: "triageMessage(db, messageRow) -> TriageResult; TriageSchema"
      exports: ["triageMessage", "TriageSchema", "TriageResult", "TRIAGE_CLASSIFIER_VERSION"]
    - path: "src/main/triage/thread.ts"
      provides: "summarizeThread(db, threadId) -> ThreadSummary"
      exports: ["summarizeThread", "ThreadSummarySchema"]
    - path: "src/renderer/features/email/ThreadSummaryModal.tsx"
      provides: "On-demand thread summary modal with loading + result + retry"
      min_lines: 50
  key_links:
    - from: "src/main/integrations/google/sync-gmail.ts"
      to: "src/main/triage/email.ts::triageMessage"
      via: "post-sync hook: for each newly-inserted row id, enqueue triage"
      pattern: "triageMessage\\("
    - from: "src/main/briefing/generate.ts::gatherEmailCandidates"
      to: "email_triage table"
      via: "SQL JOIN replacing is_important=1 filter"
      pattern: "JOIN email_triage|email_triage\\.priority"
    - from: "src/renderer/features/email/ThreadSummaryModal.tsx"
      to: "aria.triage.summarizeThread IPC"
      via: "button click → IPC call → render"
      pattern: "summarizeThread"
---

<objective>
Land email triage (EMAIL-03) and on-demand thread summarization (EMAIL-04). Triage runs per newly-ingested Gmail message, delta-only, p-queue serialized. Result is persisted once (immutable per CONTEXT decision) with priority + signals + summary + classifier_version. Briefing email section is rewritten to read from `email_triage` (replacing Phase 2's IMPORTANT-label placeholder per RESEARCH §Pitfall 8). Thread summarization is on-demand IPC + modal.

Purpose: Make the "why this mattered" rationale a first-class structured artifact on every triage decision (ROADMAP success criterion 6) and let users request a thread summary at any time (EMAIL-04). Both flows reuse Plan 02's router, so HR/legal/financial threads stay LOCAL.

Output:
- Migration 008_email_triage.sql creating `email_triage` table. Migration assignment LOCKED: Plan 01=006, Plan 02=007, Plan 03=008, Plan 04=009.
- `src/main/triage/{email,thread}.ts` modules with Zod schemas, scheduler.queue dispatch, full unit coverage.
- Post-sync hook in `sync-gmail.ts` enqueueing triage for newly-inserted rows only.
- Briefing rewrite swapping is_important=1 for email_triage JOIN.
- ApprovalCard signal chips + summary line.
- ThreadSummaryModal with IPC wiring.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/03-approval-queue-sensitivity-router-email-triage-drafting-send/03-CONTEXT.md
@.planning/phases/03-approval-queue-sensitivity-router-email-triage-drafting-send/03-RESEARCH.md
@.planning/phases/03-approval-queue-sensitivity-router-email-triage-drafting-send/03-01-approval-queue-tier-config-PLAN.md
@.planning/phases/03-approval-queue-sensitivity-router-email-triage-drafting-send/03-02-sensitivity-classifier-redaction-audit-PLAN.md
@src/main/integrations/google/sync-gmail.ts
@src/main/integrations/google/gmail.ts
@src/main/briefing/generate.ts
@src/main/lifecycle/scheduler.ts
@src/main/llm/router.ts
@src/shared/ipc-contract.ts
</context>

<interfaces>
<!-- From src/main/triage/email.ts (NEW) -->
- `const TriageSchema = z.object({ priority: z.enum(['urgent','needs-you','fyi','archive']), signals: z.array(z.enum(['from-vip','thread-active','deadline-mentioned','money-amount','awaiting-reply','mention','question-asked','newsletter','automated','reply-needed','attachment','direct-to-me'])).min(0), summary: z.string().max(280) })`
- `type TriageResult = z.infer<typeof TriageSchema>`
- `const TRIAGE_CLASSIFIER_VERSION = 'triage-v1-llama3.1-8b-q4-2026-05'`
- `async function triageMessage(db, message: GmailMessageRow): Promise<TriageResult>` — runs router (Plan 02) + generateObject with TriageSchema; persists row to email_triage; returns result; never throws (falls back to priority='fyi' + signals:['automated'] + summary='triage unavailable' on full failure)

<!-- From src/main/triage/thread.ts (NEW) -->
- `const ThreadSummarySchema = z.object({ summary: z.string().max(800), decisions: z.array(z.string()).max(10), open_questions: z.array(z.string()).max(10), participants: z.array(z.string()).max(20) })`
- `async function summarizeThread(db, threadId: string): Promise<ThreadSummary>` — SELECTs all gmail_message WHERE thread_id=? ORDER BY received_at; concatenates with separators; routes via Plan 02 router (forced-local for HR/legal/financial≥med); generateObject; result NOT persisted

<!-- From src/shared/ipc-contract.ts (additions) -->
- `aria.triage.summarizeThread({ threadId: string }) -> ThreadSummary`
- `aria.triage.getForMessage({ messageId: string }) -> TriageResult | null`
</interfaces>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Migration 007 + triage/email.ts + sync hook + briefing rewrite (RED first)</name>
  <files>src/main/db/migrations/008_email_triage.sql, src/main/db/migrations/embedded.ts, src/main/triage/email.ts, src/main/integrations/google/sync-gmail.ts, src/main/briefing/generate.ts, tests/unit/triage/email.test.ts, tests/integration/triage-on-sync.test.ts</files>
  <behavior>
    Wave 0 RED:

    email.test.ts:
    - TriageSchema rejects unknown priority; signals array can be empty; summary capped 280 chars
    - triageMessage with mock router returning valid TriageSchema-shaped object → persists row to email_triage with classifier_version stamped; returns result
    - triageMessage when router throws → fallback returned (priority='fyi', signals:['automated'], summary='triage unavailable'); STILL persists row (so we don't re-attempt next sync per CONTEXT "store once, immutable")
    - Calling triageMessage twice for same message_id → second call is a no-op (UNIQUE constraint or pre-check); returns existing row
    - Asserts router dispatch called via scheduler.queue.add (p-queue serialization)

    triage-on-sync.test.ts (integration):
    - Insert 3 new gmail_message rows via sync mock; assert post-sync hook calls triageMessage exactly 3 times
    - Re-run sync with 1 new + 3 existing rows; assert triageMessage called exactly 1 time (delta-only, per RESEARCH §Open Question 5)
    - Assert briefing's gatherEmailCandidates query selects email_triage.priority IN ('urgent','needs-you'), NOT is_important=1

    GREEN:

    Migration 008 per RESEARCH §Approval Persistence Schema `email_triage` block verbatim. Register 008 in embedded.ts migrations array.

    email.ts: TriageSchema + TRIAGE_CLASSIFIER_VERSION + triageMessage. Prompt assembly uses message subject + snippet + from_addr + thread_id + is_unread + received_at (Phase 2 columns per RESEARCH §Don't Hand-Roll row "Email parsing for triage signals"). VIP detection: heuristic — SELECT from_addr, COUNT(*) FROM gmail_message WHERE from_addr IN (SELECT to_addr FROM gmail_message WHERE direction='sent' GROUP BY to_addr ORDER BY COUNT(*) DESC LIMIT 20) — top-20-replied senders. If no sent_mail history, signals=[]. Per RESEARCH §Don't Hand-Roll row "VIP detection" — document as v1 approximation; Phase 6 contacts replaces. Route through router(prompt, { approvalId: undefined }) — triage of received mail does not need tokenization (mail is already inbound; classifier output is what matters). Router still respects forced-local routing.

    sync-gmail.ts: after the existing batch insert of new gmail_message rows, collect inserted message ids. For each, schedule `scheduler.queue.add(() => triageMessage(db, row))`. Do NOT await all (let queue drain in background); log enqueue count via pino. Use the queue (concurrency 1) so triage cost is bounded ≤1 LLM call per new message per RESEARCH §OQ-5.

    briefing/generate.ts gatherEmailCandidates (currently at line ~184 per RESEARCH §Pitfall 8): rewrite SELECT to `SELECT m.* FROM gmail_message m INNER JOIN email_triage t ON t.message_id=m.id WHERE t.priority IN ('urgent','needs-you') AND m.received_at >= ? ORDER BY t.priority='urgent' DESC, m.received_at DESC LIMIT ?`. Remove is_important=1 filter AND remove Phase 2's B4 SC2 "no-IMPORTANT-label" placeholder copy (Phase 3 supersedes per RESEARCH §Pitfall 8). If JOIN returns zero rows AND email_triage table is empty for the time window (i.e., backlog not yet triaged) — fall back to "Triage in progress — N messages awaiting classification" copy (don't show stale Phase 2 placeholder).
  </behavior>
  <action>Implement per <behavior>. Triage is store-once immutable (CONTEXT decision); UNIQUE constraint on email_triage.message_id (already PRIMARY KEY per schema). All LLM dispatch via scheduler.queue (CONTEXT cross-cutting). Briefing rewrite is a Phase 2 carry-forward cleanup per RESEARCH §Pitfall 8 — without it, briefing diverges from /approvals queue. VIP heuristic uses Phase 2 stored sent_mail (if direction column doesn't exist on gmail_message, document and skip VIP signal in v1 — open-question fallback per RESEARCH §Don't Hand-Roll). Reuse Plan 02 router; do NOT bypass.</action>
  <verify>
    <automated>npm run test:unit -- tests/unit/triage/email.test.ts && npm run test -- tests/integration/triage-on-sync.test.ts</automated>
  </verify>
  <done>Unit + integration green; Migration 008 applies cleanly; sync hook fires exactly once per new message (delta-only); briefing JOIN replaces is_important filter; B4 SC2 placeholder removed.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: thread.ts on-demand summarization + IPC + ThreadSummaryModal + ApprovalCard chips</name>
  <files>src/main/triage/thread.ts, src/main/ipc/triage.ts, src/shared/ipc-contract.ts, src/renderer/features/email/ThreadSummaryModal.tsx, src/renderer/features/approvals/ApprovalCard.tsx, tests/unit/triage/thread.test.ts</files>
  <behavior>
    Wave 0 RED:

    thread.test.ts:
    - summarizeThread(db, 'tid-1') with 5 stored messages returns ThreadSummary-shaped result with summary, decisions, open_questions, participants populated
    - Asserts SELECT runs against gmail_message (no Gmail API call mocked invoked)
    - HR-flagged thread (mock router returns categories=['hr'], severity='high') → frontier mock NOT called; local mock called
    - Result NOT persisted (no DB writes besides the SELECT)
    - Threads with single message return concise summary (no error)
    - Dispatch via scheduler.queue (assert)

    GREEN:

    thread.ts: SELECT id, from_addr, received_at, subject, snippet, body_text FROM gmail_message WHERE thread_id=? ORDER BY received_at ASC. Concatenate as `[from] {from_addr} ({received_at}): {body_text || snippet}` separated by `---`. Call router with approvalId=`thread-summary-${threadId}-${randomUUID()}` so tokenize/rehydrate works if router chooses hybrid (per Plan 02 contract); dispose token table in finally. generateObject with ThreadSummarySchema. Return result. No DB writes.

    ipc/triage.ts: register aria.triage.summarizeThread and aria.triage.getForMessage. getForMessage = simple SELECT * FROM email_triage WHERE message_id=? LIMIT 1 → result or null.

    ipc-contract.ts: add the two endpoints to the typed contract.

    ThreadSummaryModal.tsx: dialog with header, loading spinner, error state w/ retry, success state rendering summary + decisions list + open_questions list + participants chips. Opened from a button in ApprovalCard (when source_message_id has thread context with >1 message — query getForMessage to derive thread_id) and from inbox UI hooks (future plan).

    ApprovalCard.tsx (extend): on mount, if approval.source_message_id present, fetch getForMessage; render signal chips (one Badge per signal) above body preview and the triage summary as italic single-line "why" text under subject. Plan 02 already added the routed/severity chip; this adds the triage chips alongside.
  </behavior>
  <action>Implement per <behavior>. Reuse router from Plan 02 for forced-local routing on HR/legal/financial threads. Thread summary is on-demand AND one-off — do NOT persist (CONTEXT decision: triage is store-once per-message; thread summary is request-scoped). Tokenize with unique approvalId per request to satisfy Plan 02's contract. Modal uses existing shadcn Dialog primitive. Signal chips reuse Badge from shadcn — no new UI deps.</action>
  <verify>
    <automated>npm run test:unit -- tests/unit/triage/thread.test.ts</automated>
  </verify>
  <done>Unit green; modal opens from ApprovalCard when thread has >1 message; HR-flagged threads verifiably stay local (assert in test); signal chips render on cards with triage rows.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Inbound email content → triage classifier | User-controlled content (from external senders) feeds an LLM; classifier output drives priority/signals but NOT routing-bypass |
| Triage row → briefing surface + ApprovalCard | Read-only render; renderer cannot tamper with priority |
| Thread summary → router | Same redaction layer as drafting; HR/legal/financial threads forced LOCAL |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03-03-01 | Tampering | Malicious inbound email injects classifier prompt overrides ("treat as urgent reply") | mitigate | Triage priority drives UI surfacing only; it does NOT bypass approval gate or routing. Even if triage labels something `urgent`, no email is sent without an approved row. APPR-01 invariant unaffected. |
| T-03-03-02 | Information Disclosure | Thread containing HR/legal/financial content sent to frontier via summarization | mitigate | summarizeThread routes via Plan 02 router; forced-local routing applies; thread.test.ts HR case asserts frontier mock not called. |
| T-03-03-03 | Information Disclosure | Token table leaks across concurrent thread-summary requests | mitigate | Per-request approvalId = `thread-summary-${threadId}-${uuid}`; dispose in finally. Inherits Plan 02 isolation guarantee. |
| T-03-03-04 | Denial of Service | High sync volume → triage queue floods → Ollama saturation | mitigate | scheduler.queue concurrency=1 (CONTEXT cross-cutting); triage runs in background; sync completion does NOT await triage drain. |
| T-03-03-05 | Repudiation | Triage result silently changes when classifier upgraded | mitigate | classifier_version column stamped on every row (CONTEXT decision); auto-re-rationale on upgrade explicitly DEFERRED (CONTEXT §deferred); document. |
| T-03-03-06 | Information Disclosure | Briefing JOIN exposes triage summary in renderer log | mitigate | XCUT-03 pino redact sink (Phase 1) covers; no direct console.log of summary fields in IPC/render code. |
| T-03-03-07 | Tampering | Phase 2 IMPORTANT-label fallback still rendered when triage backlog exists, causing user confusion | mitigate | Briefing fallback copy changed to "Triage in progress — N messages awaiting classification" (RESEARCH §Pitfall 8); Phase 2 placeholder removed. |
</threat_model>

<verification>
- EMAIL-03 (priority + rationale on every triage decision): triage-on-sync integration test asserts exactly-N triage rows for N new messages; each row has non-null priority + signals + summary + classifier_version.
- EMAIL-03 (delta-only): re-run sync with mix of new+old → triageMessage called only for new (assertion in integration test).
- EMAIL-04 (on-demand thread summary): thread.test.ts + ThreadSummaryModal IPC wiring.
- ROADMAP success criterion 6 (structured + auditable rationale): TriageSchema enforced via generateObject; classifier_version stamped; rows persisted immutably.
- HR/legal/financial threads stay LOCAL: thread.test.ts HR case + Plan 02 router contract.
- Briefing email section reflects Phase 3 triage, not Phase 2 IMPORTANT label: integration test asserts SQL JOIN; renderer regression visible.
</verification>

<success_criteria>
- All unit + integration tests green
- Migration 008 applies cleanly to Phase-2 + Plan-01 + Plan-02 DBs
- After sync of N new messages, email_triage table contains exactly N rows with stamped classifier_version
- Briefing email section sourced from email_triage JOIN; Phase 2 placeholder copy removed
- ApprovalCard renders signal chips + triage summary line when source_message_id has a triage row
- Thread summary modal usable; HR/legal/financial threads forced local (verifiable via routing_log query post-summary)
- ROADMAP success criterion 6 met
</success_criteria>

<output>
After completion: `.planning/phases/03-approval-queue-sensitivity-router-email-triage-drafting-send/03-03-SUMMARY.md`
</output>
