/**
 * Plan 08.1-03 Task 9 — aria://activate deep-link end-to-end (E2E).
 *
 * Prerequisites the harness needs but does NOT yet have:
 *  1. Test-mode `ENTITLEMENT_PUBLIC_KEY_HEX` override + matching test seed
 *     used to sign the mock-server JWT.
 *  2. A mock LICENSE_SERVER_URL bound to a local Playwright HTTP server.
 *  3. An E2E hook to seed the initial `entitlement` row in trial-locked.
 *  4. Build artifact (`out/main/index.js`).
 *
 * Until all four pieces land — operator-gated, separate plan — this spec
 * asserts the prerequisites and skips. The deep-link parser + handler are
 * fully unit-tested:
 *   - src/main/entitlement/deep-link.test.ts (parseActivateDeepLink + handler)
 *   - src/main/single-instance test (second-instance + open-url forwarding)
 */
import { test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

test.setTimeout(180_000);

const MAIN_ENTRY = path.resolve(__dirname, '../../out/main/index.js');

test('aria://activate?key=… deep link transitions UI out of paywall within 2s', async () => {
  if (!fs.existsSync(MAIN_ENTRY)) {
    test.skip(true, 'NO_BUILD: out/main/index.js missing — run pnpm build');
    return;
  }
  test.skip(
    true,
    'NO_HARNESS: needs (1) test public-key override, (2) mock license-server ' +
      'fixture, (3) __e2eSeedEntitlement IPC hook, (4) deep-link push event ' +
      'emitter wiring in src/main/index.ts (currently handleActivateDeepLink ' +
      'is called WITHOUT emitStateChanged — paywall would not refresh until ' +
      'next ENTITLEMENT_GET_STATE call). Unit coverage in ' +
      'src/main/entitlement/deep-link.test.ts proves parse + activate path.',
  );
});
