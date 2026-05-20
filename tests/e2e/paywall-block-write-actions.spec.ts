/**
 * Plan 08.1-03 Task 8 — Paywall blocks write-action routes (E2E).
 *
 * Prerequisites the harness needs but does NOT yet have:
 *  1. A test-mode override for `ENTITLEMENT_PUBLIC_KEY_HEX` so the renderer
 *     accepts JWTs signed by a test seed instead of the production key.
 *  2. An E2E IPC hook to seed the `entitlement` row directly with a locked-
 *     state JWT (analogous to the `__e2eSeedReady` approval hook).
 *  3. Build artifact (`out/main/index.js`) — produced by `pnpm build`.
 *
 * Until (1) and (2) land — they would be a separate operator-gated plan —
 * this spec asserts the prerequisites it needs and skips with a clear
 * NO_HARNESS reason. The skip is loud (the spec line shows in CI output)
 * so the gap is visible.
 *
 * The behavior under test is otherwise fully covered at the unit layer:
 *   - LockedGuard renders PaywallScreen for non-allow-listed routes
 *     (src/renderer/app/locked-guard.test.tsx)
 *   - 5-surface chokepoint enforces server-side
 *     (tests/static/single-entitlement-gate-site.test.ts,
 *      tests/unit/main/entitlement/enforcement.test.ts)
 */
import { test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

test.setTimeout(180_000);

const MAIN_ENTRY = path.resolve(__dirname, '../../out/main/index.js');

test('paywall replaces write-action routes when entitlement is trial-locked', async () => {
  if (!fs.existsSync(MAIN_ENTRY)) {
    test.skip(true, 'NO_BUILD: out/main/index.js missing — run pnpm build');
    return;
  }
  // Two missing harness pieces gate live E2E; both are operator-gated.
  test.skip(
    true,
    'NO_HARNESS: needs (1) ENTITLEMENT_PUBLIC_KEY_HEX test-override and ' +
      '(2) __e2eSeedEntitlement IPC hook to inject a locked-state JWT. ' +
      'Unit coverage in src/renderer/app/locked-guard.test.tsx + ' +
      'tests/unit/main/entitlement/enforcement.test.ts covers the same ' +
      'invariants at the renderer + IPC layers.',
  );
});

test('Settings and Briefing remain reachable under trial-locked', async () => {
  if (!fs.existsSync(MAIN_ENTRY)) {
    test.skip(true, 'NO_BUILD: out/main/index.js missing — run pnpm build');
    return;
  }
  test.skip(
    true,
    'NO_HARNESS: same prerequisite gap as the paywall-block test above. ' +
      'Allow-list coverage lives in src/renderer/app/locked-guard.test.tsx > ' +
      'isReadOnlyAllowed unit checks.',
  );
});
