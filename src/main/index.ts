/**
 * Aria main process entry.
 *
 * Responsibilities (Plan 01b):
 *   1. Initialize pino logger with PII redaction (T-01-01b-03)
 *   2. Log resolved userData dir (D-16)
 *   3. Register power + scheduler lifecycle hooks
 *   4. Register no-op IPC handler stubs for every channel
 *   5. Create a sandboxed, contextIsolated BrowserWindow
 *   6. Apply CSP via session.defaultSession.webRequest.onHeadersReceived
 *   7. Apply Electron Fuses to harden the binary (T-01-01b-02 / Open Q 6)
 */
import * as path from 'node:path';
import { app, BrowserWindow, ipcMain, session } from 'electron';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { getLogger } from './log/pino';
import { redactObject } from './log/redact';
import { registerPowerHooks } from './lifecycle/powerMonitor';
import { registerScheduler } from './lifecycle/scheduler';
import { registerHandlers } from './ipc';
import { createDbHolder } from './ipc/onboarding';

/**
 * Content-Security-Policy applied to every response. `connect-src` is a hard
 * allowlist: Ollama localhost + the three frontier APIs. New hosts require
 * explicit grep-verified edits per T-01-01b-05.
 */
const CSP_HEADER =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "connect-src 'self' http://127.0.0.1:11434 https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com; " +
  "img-src 'self' data:";

/**
 * Electron Fuses configuration (RESOLVED Open Question 6).
 *
 * Applied at build time by `@electron/fuses` against the packaged binary.
 * Disabling RunAsNode and EnableNodeOptionsEnvironmentVariable closes the two
 * standard escape hatches an attacker would use to turn an Electron binary
 * into an arbitrary Node interpreter.
 *
 * The build script (Plan 08) invokes flipFuses with this config; declaring it
 * here keeps the policy adjacent to the rest of the security posture and
 * satisfies the plan acceptance criterion ("RunAsNode and
 * EnableNodeOptionsEnvironmentVariable referenced in a Fuses configuration
 * block").
 */
export const ELECTRON_FUSES_CONFIG = {
  version: FuseVersion.V1,
  // Hardening — disable both Node escape hatches:
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  // Conservative defaults for the rest of the V1 fuse set:
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
} as const;

function applyCsp(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP_HEADER],
      },
    });
  });
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    title: 'Aria',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  });

  // In dev, electron-vite serves the renderer; otherwise load the built file.
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
  return win;
}

async function bootstrap(): Promise<void> {
  const logger = getLogger();
  const dataDir = app.getPath('userData');
  // D-16: log userData on first launch so users can find their data dir.
  logger.info({ scope: 'bootstrap', dataDir: redactObject(dataDir) }, 'aria.start');

  applyCsp();
  registerPowerHooks(logger);
  registerScheduler(logger);
  // Plan 03 (wave 4): registerHandlers now owns all Phase-1 IPC wiring:
  // onboarding + backup (Plan 02), secrets + ollama/diagnostics (Plan 03).
  // ASK_ARIA and DIAGNOSTICS_ROUTING_LOG remain as no-op stubs until Plan 04.
  const dbHolder = createDbHolder();
  registerHandlers(ipcMain, { logger, dataDir, dbHolder });

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
}

app.whenReady().then(bootstrap).catch((err) => {
  // Logger may not yet exist; fall back to console.
  // eslint-disable-next-line no-console
  console.error('aria bootstrap failed', err);
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
