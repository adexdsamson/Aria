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

test('Aria launches with three nav items and Briefing route', async () => {
  const mainEntry = path.resolve(__dirname, '../../out/main/index.js');
  const app = await electron.launch({
    args: [mainEntry],
    timeout: 30_000,
  });

  // Surface renderer / main process logs to ease debugging on CI.
  app.process().stdout?.on('data', (d) => process.stdout.write(`[main:out] ${d}`));
  app.process().stderr?.on('data', (d) => process.stderr.write(`[main:err] ${d}`));

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  // Title from BrowserWindow constructor + index.html <title>.
  await expect.poll(async () => await window.title(), { timeout: 15_000 }).toBe('Aria');

  // Side nav items.
  await expect(window.getByRole('link', { name: 'Briefing' })).toBeVisible({ timeout: 15_000 });
  await expect(window.getByRole('link', { name: 'Approvals' })).toBeVisible();
  await expect(window.getByRole('link', { name: 'Settings' })).toBeVisible();

  // Default route heading.
  await expect(window.getByRole('heading', { name: 'Aria is alive' })).toBeVisible();

  await app.close();
});
