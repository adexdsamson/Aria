/**
 * Playwright config — Electron smoke E2E.
 *
 * The `_electron` launcher target (out/main/index.js) is BUILT by plan 01b.
 * Until then `npm run test:e2e` is expected to fail. Plan 01a only requires
 * that this config parses without error.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  retries: process.env.CI ? 0 : 0,
  workers: 1, // Electron is single-instance
  reporter: 'list',
  timeout: 30_000,
});
