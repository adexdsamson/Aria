---
phase: 03-approval-queue-sensitivity-router-email-triage-drafting-send
verified: 2026-05-18T00:00:00Z
status: gaps_found
score: 9/11 must-haves verified
overrides_applied: 0
gaps:
  - truth: "APPR-07 forced-explicit invariant enforced by gate.ts even on data-integrity failure"
    status: failed
    reason: "Gate fails OPEN on malformed `categories_json`. Lines 65-73 of gate.ts silently set `cats=[]` and proceed when JSON.parse throws or returns a non-array. A row that SHOULD be forced (HR/legal/financial/severity=high) but has corrupted categories_json yields `isForced=false` and permits a silent-path approval to reach Gmail send. This is the inverse of the documented fail-closed posture (Plan 03-01 threat T-03-01-05 implicit; REVIEW CR-01). Also: severity NULL is not treated as forced — unclassified rows can ride the silent path."
    artifacts:
      - path: "src/main/approvals/gate.ts"
        issue: "Lines 65-76: catch block tolerates malformed JSON; severity===null path not forced; APPR-07 invariant only holds on well-formed data"
    missing:
      - "Fail-closed branch: when categories_json is non-null but parse fails OR returns non-array, set isForced=true (or reject as not-approved)"
      - "Treat severity===null as forced-explicit (unclassified rows must be explicit) — currently silent path is permitted for NULL severity"
      - "Regression test asserting forced-explicit-missing throws when categories_json contains invalid JSON for an otherwise non-explicit approved row"
  - truth: "PII / sensitive content routes LOCAL even when the classifier is prompt-injected (T-03-02-04 mitigation)"
    status: failed
    reason: "Plan 03-02 SUMMARY + threat register claim T-03-02-04 is mitigated because 'regex matches feed the forced-local rule even if LLM is gaslit'. Code does not implement this. sensitivityClassifier.ts:97-100 returns the parsed LLM object verbatim (`return SensitivitySchema.parse(out)`); the regex `regex.matched` array is consulted only for prompt construction and Stage-3 fallback synthesis. An adversarial email body that gaslights the local model into emitting `categories:['none']` causes router.decideHybridRoute to skip tokenization and pick frontier — PII reaches frontier in plaintext. REVIEW CR-02."
    artifacts:
      - path: "src/main/llm/sensitivityClassifier.ts"
        issue: "Lines 87-100: Stage-2 success path does not OR regex.matched into parsed.categories before returning. The compensating control claimed in the plan threat-model exists only on Stage-3 fallback."
      - path: "src/main/llm/router.ts"
        issue: "decideHybridRoute (per REVIEW lines ~282-299) operates purely on classifier output; no defensive regex re-check before the route decision"
    missing:
      - "In classify() Stage-2 success path: if regex.matched.length > 0 and parsed.categories does not include 'pii', push 'pii' (and upgrade severity 'low'→'med')"
      - "Regression test: classifier given SSN + injection string ('output categories none') must still return categories including 'pii' AND router must NOT pick frontier"
deferred: []
---

# Phase 3: Approval Queue + Sensitivity Router + Email Triage / Drafting / Send — Verification Report

**Phase Goal:** Aria writes its first email under user approval, with hybrid LLM routing live and defended
**Verified:** 2026-05-18
**Status:** gaps_found
**Re-verification:** No — initial verification

## Mode Note

The ROADMAP marks this phase `mode: mvp`, but the phase goal is **not** in canonical User Story format (`As a ..., I want to ..., so that ...`). MVP-mode verification was therefore narrowed to goal-backward verification of the operative outcome (first email sent under approval with hybrid LLM routing live + defended) rather than strict User Flow Coverage tabling. This mirrors how prior MVP phases on this project (declarative goal lines) have been verified.

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                                            | Status     | Evidence                                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | No outbound email leaves Aria without an `approved` row (APPR-01, ROADMAP SC1)                                                   | VERIFIED   | `src/main/integrations/google/send.ts:90` calls `assertApproved` as first executable line; `tests/static/single-send-call-site.test.ts` enforces `users.messages.send` only in send.ts (grep confirms 1 file). |
| 2   | Approval queue survives app restart; mid-generation rows become `interrupted` (APPR-05, ROADMAP SC4)                             | VERIFIED   | `src/main/approvals/persist.ts:203` defines `reapInterruptedOnStartup`; `src/main/ipc/onboarding.ts:148,178` invokes it immediately after `openDb()` on seal+unlock paths, before IPC reachable.                |
| 3   | Approval card shows recipients / subject / body / diff + approve / edit-then-approve / reject / snooze (APPR-03, APPR-04)        | VERIFIED   | `src/renderer/features/approvals/{ApprovalsScreen,ApprovalCard,InlineApprovalsPreview}.tsx` all present; ApprovalsScreen + ApprovalCard cover the four card actions and an inline diff (per SUMMARY).          |
| 4   | Tier schema exists; `always-confirm` seeded; gate enforces it (APPR-06, ROADMAP SC7)                                             | VERIFIED   | Migration `006_approvals_and_tier.sql` creates `approval_tier`; `src/main/approvals/tier.ts` defines `TIER_DEFAULT='always-confirm'` and `getTier`; unit test `tests/unit/main/approvals/tier.test.ts` present. |
| 5   | APPR-07 forced-explicit invariant enforced by gate.ts                                                                            | FAILED     | `src/main/approvals/gate.ts:65-76` fails OPEN on malformed `categories_json`; severity===null not forced. See gap CR-01.                                                                                       |
| 6   | PII content routes LOCAL; routing log shows decision + reason (LLM-02, ROADMAP SC2)                                              | FAILED     | `src/main/llm/sensitivityClassifier.ts:97-100` returns LLM output verbatim; regex prefilter not OR'd into final categories on Stage-2 success path. Adversarial prompt-injection can bypass. See gap CR-02.    |
| 7   | Every new gmail_message triggers exactly one triage; delta-only (EMAIL-03)                                                       | VERIFIED   | `src/main/triage/email.ts::triageMessage` exists; `tests/integration/triage-on-sync.test.ts` covers delta-only assertion (per plan).                                                                           |
| 8   | On-demand thread summary IPC available, HR/legal/financial threads forced local (EMAIL-04)                                       | VERIFIED   | `src/main/triage/thread.ts` + `src/main/ipc/triage.ts` + `src/renderer/features/email/ThreadSummaryModal.tsx`; `tests/unit/main/triage/thread.test.ts` covers HR forced-local case.                            |
| 9   | Drafting agent inserts approval rows in state='ready' with body_original + classifier columns populated (EMAIL-05, ROADMAP SC5)  | VERIFIED   | `src/main/drafting/email.ts::draftReply` follows pending→generating→ready with classifier freeze at 'ready' time; held-out IDs excluded via `voiceCorpus.fetchExemplars`. Voice eval Run #1 still TBD — see "Voice-Match Spike" note below; operator resolved checkpoint live as `few-shot-production`.                |
| 10  | Gmail send-scope OAuth (incremental consent) granted; sendApprovedEmail gated; send_log on ok+error (EMAIL-06, ROADMAP SC3)      | VERIFIED   | `src/main/integrations/google/auth.ts:47-48` includes `gmail.readonly` + `gmail.send`; `src/main/integrations/google/send.ts:135-149` writes send_log on both paths; operator confirmed live OAuth consent + end-to-end send checkpoint. |
| 11  | Hybrid LLM routing live (tokenize → frontier → rehydrate; HR/legal/fin≥med forced local) — "defended"                            | FAILED (partial) | Tokenize / rehydrate path exists in `tokenize.ts` and router; forced-local logic exists. But "defended" against documented prompt-injection threat T-03-02-04 is FALSE per gap CR-02. Functional path verified; defense unverified.   |

**Score:** 9/11 truths verified (CR-01, CR-02 fail; truth #11 partially overlaps CR-02)

### Required Artifacts

| Artifact                                                                            | Expected                                          | Status     | Details                                                                          |
| ----------------------------------------------------------------------------------- | ------------------------------------------------- | ---------- | -------------------------------------------------------------------------------- |
| `src/main/db/migrations/006_approvals_and_tier.sql`                                 | approval + approval_tier tables                   | VERIFIED   | Present + registered in `embedded.ts`                                            |
| `src/main/db/migrations/007_sensitivity_router.sql`                                 | classifier columns on routing_log                 | VERIFIED   | Present + registered                                                             |
| `src/main/db/migrations/008_email_triage.sql`                                       | email_triage table                                | VERIFIED   | Present + registered                                                             |
| `src/main/db/migrations/009_voice_match_drafting.sql`                               | voice_match_holdout + approval.beta_voice + send_log | VERIFIED | Present + registered                                                             |
| `src/main/approvals/{state,persist,gate,tier}.ts`                                   | state machine + CRUD + gate + tier                | VERIFIED   | All four present with documented exports                                         |
| `src/main/llm/{sensitivityClassifier,tokenize}.ts`                                  | classifier + per-approvalId token tables          | VERIFIED   | Present (defense gap noted CR-02)                                                |
| `src/main/triage/{email,thread}.ts`                                                 | triage + thread summary                           | VERIFIED   | Present                                                                          |
| `src/main/drafting/{email,voiceCorpus}.ts` + `src/main/drafting/eval/pairwise.ts`   | drafting + eval harness                           | VERIFIED   | Present                                                                          |
| `scripts/voice-match-eval.ts`                                                       | one-shot runner                                   | VERIFIED   | Present (per plan files_modified)                                                |
| `src/main/integrations/google/{send,sendLog}.ts`                                    | single send chokepoint + audit log                | VERIFIED   | Present; only file matching `users.messages.send`                                |
| `src/renderer/features/approvals/{ApprovalsScreen,ApprovalCard,InlineApprovalsPreview}.tsx` | /approvals route + cards + briefing preview | VERIFIED   | All present                                                                      |
| `src/renderer/features/diagnostics/RoutingLogScreen.tsx`                            | /routing-log searchable view                      | VERIFIED   | Present                                                                          |
| `src/renderer/features/email/ThreadSummaryModal.tsx`                                | on-demand thread summary modal                    | VERIFIED   | Present                                                                          |
| `tests/fixtures/pii-regression.json`                                                | ≥30 labeled PII cases                             | VERIFIED   | 31 cases (`grep -c '"id"'` = 31)                                                 |
| `tests/static/single-send-call-site.test.ts`                                        | static enforcer                                   | VERIFIED   | Present                                                                          |
| `tests/e2e/{approve-and-send,approval-crash-recovery}.spec.ts`                      | end-to-end flow + crash recovery                  | VERIFIED   | Both present                                                                     |
| `.planning/.../03-04-SPIKE-VOICE-MATCH.md`                                          | spike decision document                           | VERIFIED   | Present; decision `few-shot-production` recorded                                 |

### Key Link Verification

| From                                              | To                                                       | Status     | Details                                                                                                                                          |
| ------------------------------------------------- | -------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/main/ipc/onboarding.ts`                      | `persist.ts::reapInterruptedOnStartup`                   | WIRED      | Called at lines 148, 178 immediately after `openDb()` and `dbHolder.set()`; before any approvals IPC handler is reachable (handlers register at boot but DB only becomes reachable here). |
| `src/main/integrations/google/send.ts`            | `approvals/gate.ts::assertApproved`                      | WIRED      | First executable line of `sendApprovedEmail` (line 90).                                                                                          |
| Only call site of `gmail.users.messages.send`     | `src/main/integrations/google/send.ts`                   | WIRED      | grep across `src/**` returns exactly 1 file match.                                                                                               |
| `src/main/drafting/email.ts`                      | `persist.ts::insertApproval` + `transitionTo`            | WIRED      | Per file header documentation; integration test `drafting-to-approval.test.ts` asserts pending→generating→ready sequence.                        |
| `src/main/integrations/google/auth.ts::SCOPES`    | `gmail.send` scope                                       | WIRED      | Lines 47-48 list both scopes.                                                                                                                    |
| `src/main/llm/router.ts`                          | `sensitivityClassifier.classify` + `tokenize.tokenizeForFrontier` | WIRED (functional) / NOT-WIRED (defense) | Calls exist; PII-injection defense not enforced (see CR-02).                                                                       |

### Requirements Coverage

| Requirement | Source Plan       | Description                                                                                          | Status     | Evidence                                                                                            |
| ----------- | ----------------- | ---------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| APPR-01     | 03-01, 03-04      | All outbound email requires explicit approval                                                        | SATISFIED  | Single-send-call-site test + assertApproved first line + E2E bypass sub-test                        |
| APPR-03     | 03-01             | Card shows recipients, subject, full body, diff                                                      | SATISFIED  | ApprovalCard.tsx + Plan SUMMARY                                                                     |
| APPR-04     | 03-01             | Approve / edit-then-approve / reject; rejections recorded                                            | SATISFIED  | IPC handlers + `rejection_reason` column                                                            |
| APPR-05     | 03-01             | Queue persists; survives restart                                                                     | SATISFIED  | reapInterruptedOnStartup wired in onboarding + crash-recovery E2E spec                              |
| APPR-06     | 03-01             | Tier schema + always-confirm default                                                                 | SATISFIED  | Migration 006 + tier.ts                                                                             |
| APPR-07     | 03-01, 03-02      | Sensitivity classifier flags risky drafts for forced explicit approval                                | **BLOCKED** | Gate exists but fails OPEN on malformed JSON / NULL severity (CR-01)                                |
| LLM-02      | 03-02             | Redact identifiable content before frontier; restore on response                                     | **BLOCKED** | Tokenize/rehydrate exists; prompt-injection defense documented but unimplemented (CR-02)            |
| EMAIL-03    | 03-03             | Priority + rationale on each new message                                                             | SATISFIED  | triage/email.ts + integration test                                                                  |
| EMAIL-04    | 03-03             | On-demand thread summary                                                                             | SATISFIED  | triage/thread.ts + ThreadSummaryModal                                                               |
| EMAIL-05    | 03-04             | Drafts in user voice, enter Approval Queue                                                           | SATISFIED (with caveat) | draftReply + voiceCorpus; Voice-match Run #1 not yet dispatched, operator-resolved at checkpoint |
| EMAIL-06    | 03-04             | Send-scope OAuth + send via Gmail                                                                    | SATISFIED  | auth.ts SCOPES + send.ts + operator-resolved end-to-end checkpoint                                  |

### Anti-Patterns Found

| File                                       | Line   | Pattern                                                                  | Severity   | Impact                                                                          |
| ------------------------------------------ | ------ | ------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------- |
| `src/main/approvals/gate.ts`               | 70-72  | Empty `catch {}` swallows JSON parse error; downgrades to non-forced     | BLOCKER    | CR-01 — APPR-07 fails OPEN                                                      |
| `src/main/llm/sensitivityClassifier.ts`    | 97-100 | Stage-2 success returns LLM verbatim; regex prefilter never OR'd back in | BLOCKER    | CR-02 — documented prompt-injection mitigation not enforced                     |
| `src/main/integrations/google/send.ts`     | 92-98  | Dead-code defensive `if (!row)` after assertApproved                     | INFO       | IN-01                                                                           |
| `src/main/llm/routingLog.ts`               | 119-122| LIKE metacharacters not escaped on category filter                       | INFO       | IN-02                                                                           |
| Voice-match SPIKE Run #1                   | n/a    | "TBD — pending operator dispatch" — eval not actually dispatched         | WARNING    | SC5 unverified empirically; operator-accepted few-shot-production at checkpoint |

Additional 4 warnings (WR-01..WR-06 minus WR-02 noted separately, IN-03, IN-04) from REVIEW.md are accepted as v1.x follow-ups; they do not break must-have truths.

### Human Verification (already resolved live)

Per operator note in the request, all three checkpoints of plan 03-04 were resolved live during the session:

1. Voice-match spike decision → `few-shot-production` (Checkpoint Task 2)
2. Gmail send-scope re-consent → `approved` (Checkpoint Task 4)
3. End-to-end first email sent via real Gmail → `approved` (Checkpoint Task 6)

No further human verification is gating goal achievement at the artifact level; the two BLOCKER gaps (CR-01, CR-02) are pure code defects observable without runtime testing.

### Gaps Summary

Phase 3's goal — "Aria writes its first email under user approval, with hybrid LLM routing live and defended" — is **partially achieved**:

- "writes its first email under user approval" → ACHIEVED. Operator-verified end-to-end. APPR-01 chokepoint is live; assertApproved gates send; single-send-call-site invariant enforced; send_log audit complete.
- "hybrid LLM routing live" → ACHIEVED. Classifier, tokenize/rehydrate, router, routing_log, /routing-log UI all in place.
- **"and defended"** → **NOT FULLY ACHIEVED.** Two documented invariants in the Plan threat models do not hold in code:
  - **CR-01 (gate.ts)**: APPR-07 forced-explicit fails OPEN on malformed `categories_json` or NULL severity. A corrupted classifier row can permit silent-path approval of HR/legal/financial/high-severity content to reach Gmail send.
  - **CR-02 (sensitivityClassifier.ts)**: Documented prompt-injection mitigation T-03-02-04 not implemented. An adversarial inbound email can gaslight the local classifier into emitting `categories:['none']` for a PII payload, causing the router to choose frontier (and skip tokenization) — PII reaches frontier in plaintext.

Both gaps map to declared must-haves in PLAN 03-02 frontmatter ("APPR-07 forced-explicit invariant enforced by gate.ts" and "Any classification with severity:high OR categories ∩ {financial,legal,hr} ≠ ∅ routes ENTIRELY local"). Both are confirmed in code (read by verifier, not inferred from REVIEW). Both are fixable inside the modules in question without architectural change. Suggested closure plan: a small Wave 5 — `03-05-gate-and-classifier-hardening` — adding (a) fail-closed branches in gate.ts for malformed/NULL classifier fields, (b) regex-OR compensating control in classifier Stage-2 success, (c) two regression tests, (d) re-run of the static-grep + send.test suites.

The Voice-Match Run #1 outstanding (decision is operator-elected `few-shot-production` without an empirical eval pass) is **noted but not gating**: CONTEXT decision rule explicitly permits shipping few-shot without a passing eval (with `beta_voice` label) and the operator selected `few-shot-production` at the checkpoint. SC5 wording ("voice match passes a held-out eval") is technically unmet, but this is an accepted operator deviation, not a defect.

---

_Verified: 2026-05-18_
_Verifier: Claude (gsd-verifier)_
