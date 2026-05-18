---
phase: 03-approval-queue-sensitivity-router-email-triage-drafting-send
plan: 05
subsystem: approvals + llm
tags: [security, gap-closure, fail-closed, prompt-injection, regression]
gap_closure: true
requirements: [APPR-07, LLM-02]
dependency_graph:
  requires:
    - 03-01-approval-queue-tier-config (gate.ts, FORCED_CATEGORIES, ApprovalGateError)
    - 03-02-sensitivity-classifier-redaction-audit (sensitivityClassifier.ts, SensitivitySchema, classifier.ts regex tokens)
  provides:
    - "Fail-closed gate behavior on malformed/NULL classifier rows (APPR-07 invariant restored)"
    - "Stage-2 regex-OR compensating control enforcing T-03-02-04 prompt-injection mitigation"
    - "32-entry pii-regression fixture (added pii-injection-01)"
  affects:
    - src/main/integrations/google/send.ts (gate stricter; no API change)
    - src/main/llm/router.ts (forced-local rule now reliably fires on adversarial PII payloads)
tech_stack:
  added: []
  patterns:
    - "fail-closed parse + null-check (gate.ts isForced)"
    - "non-exported helper (mergeRegexFloor) layered between LLM output and Zod validation"
key_files:
  created:
    - .planning/phases/03-approval-queue-sensitivity-router-email-triage-drafting-send/03-05-gate-and-classifier-hardening-SUMMARY.md
  modified:
    - src/main/approvals/gate.ts
    - tests/unit/main/approvals/gate.test.ts
    - src/main/llm/sensitivityClassifier.ts
    - tests/unit/main/llm/sensitivityClassifier.test.ts
    - tests/fixtures/pii-regression.json
decisions:
  - "Treat severity===null as forced (unclassified rows must be explicit-approved). Aligns with REVIEW CR-01 fix sketch."
  - "Exclude 'currency' token from PII-floor signal set; LLM owns the 'financial' label. Identity-only tokens (email/ssn/phone/bearer/oauth-code) drive the floor."
  - "Severity floor stops at low->med (no double-bump beyond med); never downgrade an already-higher severity."
  - "Drop 'none' from categories when adding real labels, preserving SensitivitySchema.min(1)."
metrics:
  duration_minutes: ~25
  completed_date: 2026-05-18
  tasks: 2
  files_modified: 5
---

# Phase 3 Plan 5: Gate and Classifier Hardening Summary

**One-liner:** Closed the two BLOCKER gaps from 03-VERIFICATION — gate.ts now fails closed on malformed `categories_json` and NULL `severity`, and sensitivityClassifier Stage-2 success now OR's the regex prefilter into final categories so prompt-injection cannot bypass forced-local routing.

## Goal Achievement

- **CR-01 / APPR-07:** `src/main/approvals/gate.ts` now fails closed when `categories_json` is non-null but parse-throws or yields a non-array, AND when `row.severity === null` on a non-explicit path. Error code `forced-explicit-missing` preserved; reason suffix added for audit clarity. Pre-existing `not-found` / `not-approved` / silent-low / explicit-high / forced-category branches untouched.
- **CR-02 / LLM-02 / T-03-02-04:** `src/main/llm/sensitivityClassifier.ts` Stage-2 success now passes the parsed LLM result through a new non-exported `mergeRegexFloor(parsed, regex.matched)` helper before re-validating with `SensitivitySchema.parse`. PII-token signals (email/ssn/phone/bearer/oauth-code; currency excluded) cause `pii` to be OR'd into categories and severity floored at `med`. Stage-3 fallback path untouched.
- **Adversarial regression fixture:** `tests/fixtures/pii-regression.json` grew from 31 → 32 entries via the new `pii-injection-01` case (SSN + injection string asserting `categories ⊇ {pii}` and `severity ≥ med`).

## Task Map

| Task | Name                                                                 | Commit  | Files                                                                                              |
| ---- | -------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| 1-RED  | Failing tests for gate fail-closed (CR-01)                        | cad5c11 | tests/unit/main/approvals/gate.test.ts                                                             |
| 1-GREEN| gate.ts fail-closed on malformed JSON + NULL severity (CR-01)     | d7c8277 | src/main/approvals/gate.ts                                                                         |
| 2-RED  | Failing classifier tests + adversarial fixture (CR-02)            | a06e87c | tests/unit/main/llm/sensitivityClassifier.test.ts, tests/fixtures/pii-regression.json              |
| 2-GREEN| `mergeRegexFloor` Stage-2 compensating control (CR-02)            | 252cb9d | src/main/llm/sensitivityClassifier.ts                                                              |

## Verification Results

- `npx vitest run tests/unit/main/approvals/gate.test.ts` — **15 passed** (4 new + 11 pre-existing).
- `npx vitest run tests/unit/main/llm/sensitivityClassifier.test.ts` — **14 passed** (4 new + 10 pre-existing, fixture loop now 32 cases).
- `npx vitest run tests/static/single-send-call-site.test.ts` — **passed** (assertApproved remains the sole send chokepoint).
- Full unit suite: **358 / 359 passing** (was 352 baseline + 6 new + 1 pre-existing flake — see Deferred Issues).
- Static grep acceptance:
  - `grep "catch {}" src/main/approvals/gate.ts` → 0 matches.
  - `grep "parseFailed" src/main/approvals/gate.ts` → present in isForced expression.
  - `grep "row.severity === null" src/main/approvals/gate.ts` → present.
  - `grep "mergeRegexFloor" src/main/llm/sensitivityClassifier.ts` → 3 matches (def + 2 call refs).
  - `grep '"id"' tests/fixtures/pii-regression.json` → 32 (was 31).
  - `SensitivitySchema = z.object` → 1 match, byte-equivalent to pre-existing definition.
- `ApprovalGateErrorCode` union unchanged; no new exports introduced in either module.

## Decisions Made

1. **NULL severity is forced-explicit.** REVIEW CR-01 explicitly recommended this; PLAN behavior table required it; the operative semantic is "unclassified rows cannot ride the silent path." Cheap to enforce; high defense-in-depth value.
2. **'currency' is NOT a PII signal.** classifier.ts emits 'currency' alongside identity tokens, but currency is a financial signal, not identity. mergeRegexFloor's `REGEX_PII_TOKENS` set is intentionally narrow (email, ssn, phone, bearer, oauth-code); the LLM owns the 'financial' label. Confirmed by added test "does not add pii when prefilter only matched currency".
3. **Severity floor caps at low→med.** A regex hit raises severity to at least `med`; it does not promote to `high`. This preserves separation of concerns (LLM still controls escalation to high) while ensuring the forced-local routing rule (≥med + forced category) can fire.
4. **`none` dropped when real labels added.** SensitivitySchema requires `.min(1)`; carrying both `'none'` and `'pii'` is semantically wrong. Tests pin this contract.
5. **Reason suffix is cosmetic, not a new error code.** REVIEW suggested possibly distinguishing malformed-JSON via a new code; we kept `forced-explicit-missing` and added an inline reason suffix per the plan's instruction. The frontmatter union stays a 3-element string literal; the static-grep test continues to pass.

## Deviations from Plan

**None.** Every action in the `<action>` blocks of both tasks was executed as written. One in-scope test was updated rather than added — the pre-existing `'tolerates malformed categories_json'` test in gate.test.ts encoded the OLD (defective) fail-OPEN behavior; the PLAN's behavior table explicitly inverts this. I replaced its body with the new fail-closed assertion ("fails closed when categories_json is invalid JSON") rather than adding a contradicting test. This is not a deviation — the plan's behavior table mandates the inversion.

## Auth Gates

None encountered. Plan ran fully autonomous as specified.

## Deferred Issues

| Issue | File | Notes |
|-------|------|-------|
| Flaky 5s timeout in `tests/unit/main/ipc/ask-local-handler.spec.ts > LOCAL path: writes one routing_log row with reason=frontier-not-configured` | tests/unit/main/ipc/ask-local-handler.spec.ts:52 | Times out opening real SQLCipher DB in CI. Unrelated to gate.ts / sensitivityClassifier.ts. Likely ABI-swap / DB-open contention on Windows; falls outside scope-boundary. Re-runs of the same file in isolation typically pass. |

The full-suite total briefly showed 4 failures on one run and 1 failure on the next; the variance was entirely in this Warning-D integration test, never in approvals or classifier tests. The targeted suite (gate + classifier + single-send-call-site) was deterministic and green on every run.

## Known Stubs

None introduced. mergeRegexFloor is fully wired and exercised by 4 new unit tests + the fixture loop.

## Threat Flags

None. All security-relevant surface introduced is in the threat register (T-03-05-01 + T-03-05-02), and both are now `mitigate` with regression tests.

## Re-verification Hooks

The Phase 3 verification truths #5, #6, and #11 should flip to VERIFIED on re-run:

- Truth #5 (APPR-07 enforced by gate.ts) — gate.test.ts now asserts both fail-closed branches and the explicit-path bypass. CR-01 closed.
- Truth #6 (PII routes LOCAL even under prompt injection) — sensitivityClassifier.test.ts now asserts SSN+injection → categories⊇{pii} ∧ severity≥med. CR-02 closed.
- Truth #11 ("hybrid LLM routing live AND defended") — defense leg now in code. router.ts is unchanged; the forced-local rule it already evaluates now receives a defended classification.

## Self-Check: PASSED

- src/main/approvals/gate.ts: FOUND (modified)
- src/main/llm/sensitivityClassifier.ts: FOUND (modified)
- tests/unit/main/approvals/gate.test.ts: FOUND (modified)
- tests/unit/main/llm/sensitivityClassifier.test.ts: FOUND (modified)
- tests/fixtures/pii-regression.json: FOUND (modified, 32 entries)
- Commit cad5c11 (test/gate RED): FOUND in git log
- Commit d7c8277 (fix/gate GREEN): FOUND in git log
- Commit a06e87c (test/classifier RED): FOUND in git log
- Commit 252cb9d (fix/classifier GREEN): FOUND in git log

## TDD Gate Compliance

Both tasks followed RED → GREEN. RED commits (cad5c11, a06e87c) precede their respective GREEN commits (d7c8277, 252cb9d) in `git log`. No REFACTOR gates needed — implementations were minimal and direct.
