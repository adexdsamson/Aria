import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  launchAria,
  runOnboarding,
  DEFAULT_DAILY_PW,
} from './fixtures/onboarded';

test.setTimeout(120_000);

test('first-launch onboarding seals vault + opens DB; unlock works on restart', async () => {
  const { electronApp, userDataDir } = await launchAria();

  // Surface main-process logs.
  electronApp.process().stdout?.on('data', (d) => process.stdout.write(`[main:out] ${d}`));
  electronApp.process().stderr?.on('data', (d) => process.stderr.write(`[main:err] ${d}`));

  const w = await electronApp.firstWindow();
  await w.waitForLoadState('domcontentloaded');

  // Onboarding gate must be visible on a fresh userData.
  await expect(w.getByTestId('gate-onboarding')).toBeVisible({ timeout: 20_000 });

  await runOnboarding(electronApp, DEFAULT_DAILY_PW);

  // After onboarding, the briefing screen renders (Plan 02 replaced the
  // 'Aria is alive' hello-stub with BriefingScreen as the post-seal landing).
  await expect(w.getByTestId('briefing-screen')).toBeVisible({ timeout: 15_000 });

  // vault.json + aria.db must both exist; aria.db must NOT start with the
  // plaintext "SQLite format 3" magic header.
  const vaultPath = path.join(userDataDir, 'vault.json');
  const dbPath = path.join(userDataDir, 'aria.db');
  expect(fs.existsSync(vaultPath)).toBe(true);
  expect(fs.existsSync(dbPath)).toBe(true);
  const header = fs.readFileSync(dbPath).subarray(0, 16);
  expect(header.toString('utf8').startsWith('SQLite format 3')).toBe(false);

  const vaultJson = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
  expect(typeof vaultJson.appSalt).toBe('string');
  expect(vaultJson.cipher.algo).toBe('aes-256-gcm');

  await electronApp.close();

  // Second launch with the same userData → locked gate, then unlock.
  const { electronApp: app2 } = await launchAria({ userDataDir });
  const w2 = await app2.firstWindow();
  await w2.waitForLoadState('domcontentloaded');
  await expect(w2.getByTestId('gate-locked')).toBeVisible({ timeout: 20_000 });
  await w2.getByTestId('unlock-input').fill(DEFAULT_DAILY_PW);
  await w2.getByTestId('unlock-submit').click();
  await expect(w2.getByTestId('gate-unlocked')).toBeVisible({ timeout: 20_000 });
  await expect(w2.getByTestId('briefing-screen')).toBeVisible({ timeout: 15_000 });
  await app2.close();
});
