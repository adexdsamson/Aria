// PHASE-8 PRE-RELEASE: un-skip and run against packaged build
/**
 * Plan 08-04 Task 3 — RAG_ASK Playwright `_electron` smoke spec.
 *
 * AUTHORED AS .SKIP BY USER DIRECTIVE (Phase-8 execution authorization
 * 2026-05-20, Option A): the live Playwright + packaged-build pipeline is
 * not yet stood up. Un-skip this file as part of the final release-
 * verification human checkpoint (see plan 08-04 trailing
 * checkpoint:human-verify gate). Until then this file exists as a
 * placeholder so the verifier can locate it and so the path is
 * reserved in git history.
 *
 * Mode A — CI pass (default; mocked LLM):
 *   1. launch packaged app via _electron
 *   2. seed DB with at least one indexed chunk
 *   3. open /ask UI; type a question whose entity matches a chunk
 *   4. assert response kind ∈ {answer, refusal, disambiguation}; NEVER
 *      'Q&A service not ready'
 *   5. assert citations.length >= 1
 *   6. (B-2 round 2 log-line ratchet REPLACES closure spy) parse pino
 *      stream and assert exactly ONE entry with
 *      scope==='answer-service' && event==='factory.constructed'
 *   7. click citation → asserts in-app navigation OR shell.openExternal
 *
 * Mode B — Local pre-release (gated by env ARIA_E2E_REAL_LLM=true):
 *   8. tests 1-3 with real local Ollama (no LlmInvocation mock)
 *   9. assert non-empty answer with length >= 20, NOT 'I don't know' /
 *      'N/A' / 'undefined' / 'null'
 *
 * Cross-reference Task 9 — Mode B is a REQUIRED pre-tag step.
 */
import { test } from '@playwright/test';

test.describe.skip('Plan 08-04 RAG_ASK smoke (Mode A — mocked LLM)', () => {
  test('TODO: launch packaged build and assert factory.constructed log-line', () => {
    // Implemented in Phase-8 pre-release pass — see file header.
  });
});

test.describe.skip('Plan 08-04 RAG_ASK smoke (Mode B — real Ollama)', () => {
  test('TODO: real local-LLM round-trip with non-empty answer assertion', () => {
    // Implemented in Phase-8 pre-release pass — see file header.
  });
});
