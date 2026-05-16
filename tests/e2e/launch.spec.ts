import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'node:path';

/**
 * Smoke E2E: launch the packaged main process from `out/main/index.js`,
 * assert the window title and the three side-nav items are visible, and
 * that the default `/briefing` route renders "Aria is alive".
 *
 * Build the app with `npm run build` before running this test:
 *   npm run build && npm run test:e2e
 */
test.setTimeout(60_000);

test('Aria launches with onboarding gate on a fresh user-data dir', async () => {
  // Plan 02 introduced a vault/db gate. On a fresh user-data dir the app shows
  // the onboarding wizard rather than the side-nav-+-briefing layout. The
  // full onboarding flow is exercised in tests/e2e/onboarding.spec.ts; this
  // launch smoke just confirms the binary boots and reaches the gate.
  const mainEntry = path.resolve(__dirname, '../../out/main/index.js');
  const os = await import('node:os');
  const fs = await import('node:fs');
  const crypto = await import('node:crypto');
  const userDataDir = path.join(
    os.tmpdir(),
    `aria-launch-smoke-${crypto.randomBytes(6).toString('hex')}`,
  );
  fs.mkdirSync(userDataDir, { recursive: true });

  const app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, ARIA_E2E: '1' },
    timeout: 30_000,
  });

  app.process().stdout?.on('data', (d) => process.stdout.write(`[main:out] ${d}`));
  app.process().stderr?.on('data', (d) => process.stderr.write(`[main:err] ${d}`));

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  await expect.poll(async () => await window.title(), { timeout: 15_000 }).toBe('Aria');
  await expect(window.getByTestId('gate-onboarding')).toBeVisible({ timeout: 20_000 });
  await expect(window.getByTestId('mnemonic-grid')).toBeVisible({ timeout: 15_000 });

  await app.close();
});
