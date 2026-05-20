// PHASE-8 PRE-RELEASE: un-skip and run against packaged build
/**
 * Plan 08-04 Task 8 — Phase 8 happy-path E2E ("I used Aria today").
 *
 * AUTHORED AS .SKIP BY USER DIRECTIVE (Phase-8 execution authorization
 * 2026-05-20, Option A): the full packaged-build + stubbed-OAuth +
 * test-mode harness is not yet stood up. Un-skip this file as part of
 * the final release-verification human checkpoint (see plan 08-04
 * trailing checkpoint:human-verify gate).
 *
 * The 9-step spec (per plan 08-04 <behavior>):
 *   1. Connect Google account (stubbed OAuth).
 *   2. Connect Outlook account (stubbed Phase 5 OAuth harness).
 *   3. Ingest mail; briefing renders sections + (if 14d seeded) insights.
 *   4. Draft an email → approve → mocked Gmail send returns 200 →
 *      send_log row written.
 *   5. Schedule a meeting via NL command → approve → mocked Calendar
 *      accepts → calendar_action_log row.
 *   6. Paste a transcript → approve task batch → mocked Todoist push
 *      returns task IDs → meeting_action_task_link rows.
 *   7. Run RAG query → assert NOT 'Q&A service not ready' → click
 *      citation.
 *   8. View weekly recap, edit one section → weekly_recap_section_edit row.
 *   9. (M-3 round 2 — migration-failure restore) Mount the fixture
 *      tests/fixtures/999_force_fail.sql via the test-only injection
 *      helper, gated by ARIA_E2E_FORCE_MIGRATION_FAIL=true. Relaunch the
 *      app; assert (a) recovery dialog appears, (b) clicking Restore
 *      invokes restoreFromBackup, (c) post-relaunch DB content matches
 *      the pre-migration snapshot, (d) prior approval / send_log /
 *      recap rows are intact.
 *
 *   ALWAYS, in Step 9, assert that src/main/db/migrations/embedded.ts
 *   does NOT reference `999_force_fail` — proof the fixture cannot
 *   leak into prod.
 *
 * Whole-spec assertion: `action_audit_log` VIEW reflects every action
 * taken (T-08-23 fixture-leak guard + cross-stream invariant).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.describe.skip('Plan 08-04 phase8-happy-path (Step 1..8)', () => {
  test('TODO: connect → ingest → draft → schedule → transcript → ask → recap', () => {
    // Implemented in Phase-8 pre-release pass — see file header.
  });
});

test.describe.skip('Plan 08-04 phase8-happy-path Step 9 — migration-failure restore', () => {
  test('TODO: ARIA_E2E_FORCE_MIGRATION_FAIL=true → recovery dialog → Restore → data intact', () => {
    // Implemented in Phase-8 pre-release pass — see file header.
  });
});

// ACTIVE: M-3 round 2 fixture-leak guard runs unconditionally even while
// the rest of Step 9 is deferred. Proves the fixture cannot reach prod
// via embedded.ts. Runs as a Playwright test for now; will be exercised
// by the lint:guard ratchet pass as well (see scripts/grep-no-fixture-
// leak.mjs candidate work below — not yet wired).
test('M-3 round 2 fixture leak guard — embedded.ts does NOT reference 999_force_fail', () => {
  const embedded = readFileSync(
    resolve(process.cwd(), 'src/main/db/migrations/embedded.ts'),
    'utf8',
  );
  expect(embedded).not.toMatch(/999_force_fail/);
});
