/**
 * Plan 04 Task 3 — hello-Aria e2e.
 *
 * Launches Aria in a freshly-onboarded userData, navigates to
 * Settings → Diagnostics, asks "What is the capital of France?" with
 * source=generic, and asserts:
 *   - answer panel appears
 *   - route badge = LOCAL
 *   - reason = 'frontier-not-configured' (no API key in this test)
 *   - routing-log table has ≥1 row
 *
 * Pre-flight: if Ollama is unreachable, skip with OLLAMA_REQUIRED. The full
 * handler chain is independently proven by `tests/unit/main/ipc/ask-local-handler.spec.ts`.
 */
import { test, expect } from '@playwright/test';
import {
  launchAria,
  runOnboarding,
  DEFAULT_DAILY_PW,
} from './fixtures/onboarded';

test.setTimeout(180_000);

test('hello-Aria: LOCAL route with reason=frontier-not-configured + routing-log row', async () => {
  const { electronApp } = await launchAria();
  electronApp.process().stdout?.on('data', (d) => process.stdout.write(`[main:out] ${d}`));
  electronApp.process().stderr?.on('data', (d) => process.stderr.write(`[main:err] ${d}`));

  const w = await electronApp.firstWindow();
  await w.waitForLoadState('domcontentloaded');

  await runOnboarding(electronApp, DEFAULT_DAILY_PW);

  // Pre-flight: probe Ollama via the existing IPC channel. Skip if unreachable.
  const ollama = await w.evaluate(async () => {
    // @ts-expect-error window.aria injected by preload bridge
    return (await window.aria.ollamaStatus()) as { reachable: boolean };
  });
  if (!ollama || !ollama.reachable) {
    test.skip(true, 'OLLAMA_REQUIRED: hello-Aria e2e requires Ollama on 127.0.0.1:11434');
    return;
  }

  // Navigate to Settings → Diagnostics via real SideNav clicks. The app uses
  // MemoryRouter (App.tsx), which does not observe window.location.hash, so
  // hash writes are no-ops. Click the stable testids instead.
  await w.getByTestId('sidenav-settings').click();
  await w.getByTestId('settings-nav-diagnostics').click();

  await w.getByTestId('settings-diagnostics').waitFor({ timeout: 15_000 });
  await w.getByTestId('ask-aria-box').waitFor({ timeout: 5_000 });

  // Type the prompt + select source + submit.
  await w.getByTestId('ask-prompt').fill('What is the capital of France?');
  await w.getByTestId('ask-source').selectOption('generic');
  await w.getByTestId('ask-submit').click();

  // Wait for the answer panel (first local-model call can be slow).
  await w.getByTestId('ask-result').waitFor({ timeout: 60_000 });

  // Route badge = LOCAL (no frontier key configured in this test).
  await expect(w.getByTestId('route-badge-LOCAL')).toBeVisible();

  // Reason = frontier-not-configured.
  await expect(w.getByTestId('ask-reason')).toHaveText('frontier-not-configured');

  // Routing-log panel has at least one row.
  await w.getByTestId('routing-log-table').waitFor({ timeout: 5_000 });
  const rowCount = await w.locator('[data-testid^="routing-log-row-"]').count();
  expect(rowCount).toBeGreaterThanOrEqual(1);

  await electronApp.close();
});
