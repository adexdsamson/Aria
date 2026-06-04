import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';

/**
 * Phase 15 / Plan 15-09 Task 3 — Packaged-launch E2E smoke (SC2).
 *
 * Scaffolded as .skip (mirroring tests/e2e/phase8-happy-path.spec.ts precedent).
 * Un-skip once:
 *   1. Per-platform binaries are staged under build/whisper/ (Task 2 complete).
 *   2. The app is built with `npm run build` on the target platform.
 *   3. The packaged artifact exists (electron-builder dist/).
 *
 * SC2 assertions (when un-skipped):
 *   - App launches and reaches the onboarding/main gate (no NODE_MODULE_VERSION crash).
 *   - Main-process logs do NOT contain "NODE_MODULE_VERSION" (ABI crash string).
 *   - The STT sidecar binary is resolvable at process.resourcesPath/whisper-cli[.exe].
 *     (Verified via a dedicated IPC smoke call, or by absence of sidecar spawn error
 *     in the main-process logs within the first 5 seconds.)
 *
 * Run manually after packaging:
 *   npm run build && npx playwright test tests/e2e/packaged-launch.spec.ts
 *
 * Platform notes:
 *   - Windows: the packaged build is in dist/win-unpacked/Aria.exe (unsigned dev build).
 *   - macOS: the packaged build is in dist/mac-arm64/Aria.app (unsigned dev build,
 *     CSC_IDENTITY_AUTO_DISCOVERY=false). Requires Task 2 (macOS binary procurement)
 *     and Apple Developer ID for signed/notarized build.
 *
 * SC2 is considered PASS when: app window appears (no ABI crash), title is "Aria",
 * and the onboarding gate is visible — identical to tests/e2e/launch.spec.ts but
 * run against the packaged artifact with the whisper-cli binary present.
 */

test.describe.skip('SC2 — packaged-launch smoke: no NODE_MODULE_VERSION ABI crash + STT sidecar spawns', () => {

  test.setTimeout(120_000);

  test('packaged app launches without ABI crash and STT sidecar binary is resolvable', async () => {
    // ── Locate the packaged main-process entry ──────────────────────────────
    // The packaged build resolves out/main/index.js (for electron.launch with args).
    // For a true packaged binary test, point electron.launch at the platform-specific
    // executable in dist/ instead. This scaffold uses the built out/main/index.js
    // (same as tests/e2e/launch.spec.ts) so the ABI check is reproducible in CI.
    const mainEntry = path.resolve(__dirname, '../../out/main/index.js');

    // ── Fresh user-data dir to avoid polluting dev profile ─────────────────
    const userDataDir = path.join(
      os.tmpdir(),
      `aria-packaged-launch-${crypto.randomBytes(6).toString('hex')}`,
    );
    fs.mkdirSync(userDataDir, { recursive: true });

    // ── Collect main-process log lines to scan for ABI crash string ─────────
    const logLines: string[] = [];

    const app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        ARIA_E2E: '1',
        // Disable auto-discovery of Apple Developer ID cert for local/CI dev builds.
        CSC_IDENTITY_AUTO_DISCOVERY: 'false',
      },
      timeout: 60_000,
    });

    app.process().stdout?.on('data', (chunk: Buffer) => {
      const line = chunk.toString();
      logLines.push(line);
      process.stdout.write(`[main:out] ${line}`);
    });
    app.process().stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString();
      logLines.push(line);
      process.stderr.write(`[main:err] ${line}`);
    });

    try {
      const window = await app.firstWindow();
      await window.waitForLoadState('domcontentloaded');

      // SC2 assertion 1: window title is "Aria" (app booted without crash)
      await expect
        .poll(async () => await window.title(), { timeout: 30_000 })
        .toBe('Aria');

      // SC2 assertion 2: onboarding gate is visible (app reached the UI gate)
      await expect(window.getByTestId('gate-onboarding')).toBeVisible({ timeout: 20_000 });

      // SC2 assertion 3: no NODE_MODULE_VERSION in main-process logs
      // Give the sidecar manager ~5 s to attempt binary resolution on startup
      await new Promise((r) => setTimeout(r, 5_000));

      const abiCrashLines = logLines.filter((l) =>
        l.includes('NODE_MODULE_VERSION'),
      );
      expect(
        abiCrashLines,
        'Main-process logs contain NODE_MODULE_VERSION — the STT sidecar path introduced an ABI coupling.\n' +
        'Verify sidecar-manager.ts uses child_process.spawn (not require()) and no .node addon was added.\n' +
        'ABI crash lines:\n' + abiCrashLines.join('\n'),
      ).toEqual([]);

      // SC2 assertion 4: no sidecar spawn error in logs (binary found at resourcesPath)
      const sidecarErrors = logLines.filter((l) =>
        l.includes('whisper-cli') && (l.includes('ENOENT') || l.includes('spawn error')),
      );
      expect(
        sidecarErrors,
        'Main-process logs contain a sidecar spawn error — whisper-cli binary was not found at process.resourcesPath.\n' +
        'Ensure Task 2 (binary procurement) staged the binary under build/whisper/<platform>/ before packaging.\n' +
        'Sidecar errors:\n' + sidecarErrors.join('\n'),
      ).toEqual([]);

    } finally {
      await app.close();
      // Clean up temp user-data dir
      try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

});
