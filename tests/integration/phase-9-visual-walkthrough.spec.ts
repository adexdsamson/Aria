// PHASE-9 PRE-RELEASE: un-skip and run against packaged build.
/**
 * Plan 09-06 Task 2 — Phase 9 Playwright `_electron` visual walkthrough.
 *
 * AUTHORED AS .SKIP per Phase 9 close-out authorization (option 2,
 * 2026-05-20): the packaged-build + test-vault-fixture + entitlement-
 * override harness required to drive this spec live is not yet stood up
 * in this repo. We follow the exact same pattern as plan 08-04 Task 8
 * (`tests/integration/phase8-happy-path.spec.ts`): commit the spec body
 * as a `.skip` so the intent is encoded and merge-blockable as a future
 * checkpoint, without falsely claiming green.
 *
 * The walkthrough (per plan 09-06 <action>):
 *   1. Launch `_electron` against out/main/index.js (packaged dev build).
 *   2. Unlock the test vault (existing fixture, or create fresh).
 *   3. For each route in [
 *        '/briefing', '/approvals', '/calendar', '/meetings', '/tasks',
 *        '/scheduling', '/ask', '/recap', '/routing-log', '/settings',
 *        '/settings/frontier-key', '/settings/integrations',
 *        '/settings/subscription', '/settings/diagnostics'
 *      ]:
 *      a. Navigate and wait for Topbar display title.
 *      b. Capture `console.error` since previous step; assert empty.
 *      c. Assert at least one element has computed font-family containing
 *         "Playfair Display" OR "Source Sans 3" OR "IBM Plex Mono".
 *      d. Take screenshot to `test-results/phase-9-{route}.png`.
 *   4. Walk entitlement states by toggling the dev fixture entitlement-
 *      override IPC: 'trial-active-day0', 'trial-locked', 'pro-active',
 *      'pro-locked'. For each, assert TrialBanner / PaywallScreen render
 *      the documented copy and a Playfair italic title.
 *   5. Marked @slow → excluded from default CI; run via
 *      `pnpm test:e2e:phase-9` (script lands with the packaged-build
 *      harness in a follow-up wave).
 *
 * Un-skip checklist (Phase 10 / release-prep):
 *   [ ] Packaged dev build emits out/main/index.js.
 *   [ ] Test vault fixture file exists at tests/fixtures/test-vault.dat
 *       with a known passphrase exported via ARIA_TEST_VAULT_PASS.
 *   [ ] Renderer exposes an entitlement-override IPC handler gated by
 *       ARIA_E2E_ALLOW_ENTITLEMENT_OVERRIDE=true.
 *   [ ] `pnpm test:e2e:phase-9` script added to package.json.
 */
import { test, expect } from '@playwright/test';

const ROUTES = [
  '/briefing',
  '/approvals',
  '/calendar',
  '/meetings',
  '/tasks',
  '/scheduling',
  '/ask',
  '/recap',
  '/routing-log',
  '/settings',
  '/settings/frontier-key',
  '/settings/integrations',
  '/settings/subscription',
  '/settings/diagnostics',
] as const;

const ENTITLEMENT_STATES = [
  'trial-active-day0',
  'trial-locked',
  'pro-active',
  'pro-locked',
] as const;

const EDITORIAL_FONT_NEEDLES = [
  'Playfair Display',
  'Source Sans 3',
  'IBM Plex Mono',
] as const;

test.describe.skip('Plan 09-06 Phase 9 visual walkthrough — every route', () => {
  for (const route of ROUTES) {
    test(`route ${route} mounts cleanly with editorial fonts`, () => {
      // 1. launch _electron (out/main/index.js).
      // 2. unlock vault.
      // 3. navigate to {route}; wait for Topbar title.
      // 4. assert no console.error since previous step.
      // 5. assert at least one element computed font-family matches one of
      //    EDITORIAL_FONT_NEEDLES.
      // 6. screenshot to test-results/phase-9-{route}.png.
      void route;
      void EDITORIAL_FONT_NEEDLES;
      expect(true).toBe(true);
    });
  }
});

test.describe.skip('Plan 09-06 Phase 9 visual walkthrough — entitlement states', () => {
  for (const state of ENTITLEMENT_STATES) {
    test(`entitlement override ${state} renders correctly`, () => {
      // 1. set entitlement override via test-only IPC.
      // 2. navigate to a screen that surfaces TrialBanner / PaywallScreen.
      // 3. assert documented copy + Playfair italic title present.
      void state;
      expect(true).toBe(true);
    });
  }
});
