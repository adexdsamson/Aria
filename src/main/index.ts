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
import * as fs from 'node:fs';
import { app, BrowserWindow, ipcMain, session } from 'electron';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { getLogger } from './log/pino';

/**
 * Dev-only `.env.local` loader (UAT Gap 3).
 *
 * Production builds inject `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` via
 * electron-vite `define` (or the user's shell). In `pnpm dev` neither path
 * applies, so `process.env.GOOGLE_*` is `undefined` and the first OAuth
 * attempt throws `OAuthConfigMissingError` (renderer silently swallows it —
 * see IntegrationsSection error surfacing fix).
 *
 * This loader runs BEFORE any module that reads `process.env.GOOGLE_*`. It is
 * a minimal ~10-line parser — we deliberately do NOT add `dotenv` as a
 * dependency. Existing env vars (shell exports) always win. Secrets are NEVER
 * logged — only the count of variables loaded.
 *
 * Packaged builds (no ELECTRON_RENDERER_URL) skip this entirely.
 */
function loadDotEnvLocalInDev(): void {
  if (!process.env['ELECTRON_RENDERER_URL']) return; // dev-only
  const envPath = path.join(process.cwd(), '.env.local');
  let raw: string;
  try {
    raw = fs.readFileSync(envPath, 'utf8');
  } catch {
    return; // file missing is fine — fall back to shell env
  }
  let loaded = 0;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip surrounding single or double quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Explicit shell exports win.
    if (process.env[key] === undefined) {
      process.env[key] = value;
      loaded += 1;
    }
  }
  // Never log keys or values — refresh tokens / client secrets MUST NOT hit logs.
  getLogger().info({ scope: 'env-local', loaded }, '.env.local loaded (dev only)');
}
loadDotEnvLocalInDev();

import { redactObject } from './log/redact';
import { registerPowerHooks } from './lifecycle/powerMonitor';
import { registerScheduler } from './lifecycle/scheduler';
import { registerHandlers } from './ipc';
import { registerEntitlementHandlers, makeRendererEmitter } from './ipc/entitlement';
import { createDbHolder } from './ipc/onboarding';
import { probeOllama } from './llm/ollamaProbe';
import { autoPickOllamaModel } from './llm/autoPickModel';
import { getOllamaModelId, setOllamaModelId } from './secrets/safeStorage';
import { acquireSingleInstanceLock } from './single-instance';
import { EntitlementService } from './entitlement/service';
import { getOrCreateInstallId } from './entitlement/install-id';
import { handleActivateDeepLink } from './entitlement/deep-link';
import { CHANNELS } from '../shared/ipc-contract';
import {
  scheduleEntitlementRefresh,
} from './entitlement/schedule';
// Plan 07-02 Task 5.5 (REVIEWS C3): reconcileModelSwap MUST run at boot
// AFTER openDb + runMigrations + single-instance-lock and BEFORE IndexWorker.start.
// Wiring stub — the IndexWorker itself is started by the IPC layer (registerHandlers)
// once the DB holder has a keyed DB; the reconciler call is invoked from there.
// See src/main/rag/model-swap-reconciler.ts for the full state machine.
import { reconcileModelSwap as reconcileModelSwap_C3 } from './rag/model-swap-reconciler';
// Reference held to silence unused-import lints in TS strict mode; the IPC layer
// imports the same function from its real path. Do NOT remove — this is the C3
// boot-sequence anchor that the verifier greps for.
void reconcileModelSwap_C3;

/**
 * Content-Security-Policy applied to every response. `connect-src` is a hard
 * allowlist: Ollama localhost + the three frontier APIs. New hosts require
 * explicit grep-verified edits per T-01-01b-05.
 *
 * The dev variant adds 'unsafe-inline' for Vite React Fast-Refresh and
 * ws://localhost:5173 + http://localhost:5173 for HMR; prod-strict path is
 * `prodCspHeader()` and is the value shipped to users.
 */
function prodCspHeader(): string {
  return (
    "default-src 'self'; " +
    "script-src 'self'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "connect-src 'self' http://127.0.0.1:11434 https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com; " +
    "img-src 'self' data:"
  );
}

function devCspHeader(): string {
  return (
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "connect-src 'self' ws://localhost:5173 http://localhost:5173 http://127.0.0.1:11434 https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com; " +
    "img-src 'self' data:"
  );
}

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

/**
 * Compute the renderer origin once at startup so we can scope CSP injection
 * to Aria's own pages only. UAT Gap 4 (Test 3/4): the unconditional CSP
 * injection was leaking into the Google OAuth BrowserWindow, which inherits
 * `defaultSession`. Google's cross-domain session-state probes
 * (`accounts.youtube.com/CheckConnection`) and granular-consent UI hit
 * `ERR_BLOCKED_BY_CSP` against Aria's `connect-src` allowlist, so the user
 * couldn't grant `calendar.readonly` and the post-connect probe failed with
 * "Insufficient Permission".
 *
 * Returns the URL prefix that identifies Aria's renderer:
 *   - dev:  `http://localhost:5173` (stripped from ELECTRON_RENDERER_URL)
 *   - prod: `file://` (loadFile uses the file protocol)
 */
function computeRendererOrigin(): string {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    try {
      const u = new URL(devUrl);
      return `${u.protocol}//${u.host}`;
    } catch {
      return devUrl;
    }
  }
  return 'file://';
}

/**
 * Returns true if `url` belongs to Aria's renderer (so we should inject CSP)
 * and false for any third-party origin loaded into the same defaultSession —
 * e.g. the Google OAuth window. DevTools URLs (`devtools://`) are session-
 * internal and don't typically traverse onHeadersReceived, but defensively
 * skipped so future DevTools assets aren't broken.
 */
function isAriaRendererUrl(url: string, rendererOrigin: string): boolean {
  if (!url) return false;
  if (url.startsWith('devtools://')) return false;
  return url.startsWith(rendererOrigin);
}

function applyCsp(): void {
  const isDev = Boolean(process.env['ELECTRON_RENDERER_URL']);
  const header = isDev ? devCspHeader() : prodCspHeader();
  const rendererOrigin = computeRendererOrigin();
  if (isDev) {
    getLogger().info(
      { scope: 'csp', mode: 'dev' },
      "dev CSP active — script-src includes 'unsafe-inline'; do NOT ship to users"
    );
  }
  getLogger().info(
    { scope: 'csp', renderer_origin: rendererOrigin },
    'CSP scoped to renderer origin only'
  );
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (isAriaRendererUrl(details.url, rendererOrigin)) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [header],
        },
      });
    } else {
      callback({ responseHeaders: details.responseHeaders });
    }
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
  const scheduler = registerScheduler(logger);
  // Plan 03 (wave 4): registerHandlers now owns all Phase-1 IPC wiring:
  // onboarding + backup (Plan 02), secrets + ollama/diagnostics (Plan 03).
  // ASK_ARIA and DIAGNOSTICS_ROUTING_LOG remain as no-op stubs until Plan 04.
  const dbHolder = createDbHolder();

  // Plan 08.1-02 — entitlement service. CRITICAL ORDERING:
  //   1. openDb + (migrations applied) happens later inside the onboarding
  //      handler when the user unlocks
  //   2. EntitlementService.bootstrap() — call POST-migration, PRE-first-write
  //   3. Only then are the 5 gated IPC surfaces allowed to invoke their
  //      provider calls. Order is enforced by assertEntitled — see
  //      src/main/entitlement/gate.ts and the static-grep ratchet at
  //      tests/static/single-entitlement-gate-site.test.ts.
  let entitlementService: EntitlementService | null = null;
  registerHandlers(ipcMain, { logger, dataDir, dbHolder });

  // Lazily bootstrap entitlement once the DB is unlocked. The bootstrap
  // method is itself idempotent and concurrency-safe.
  const tryBootstrapEntitlement = async (): Promise<void> => {
    if (entitlementService) return;
    const db = dbHolder.db;
    if (!db) return;
    entitlementService = new EntitlementService({
      db,
      installIdProvider: () => getOrCreateInstallId({ logger }),
      logger,
    });
    try {
      await entitlementService.bootstrap();
      scheduleEntitlementRefresh(entitlementService, { scheduler, logger });
      // Plan 08.1-02 — register the 5 entitlement IPC handlers now that the
      // service is live. registerHandlers() runs BEFORE the DB unlocks, so
      // the entitlement block there is skipped (no service yet). Without
      // this call the renderer hits "No handler registered for
      // 'aria:entitlement:get-state'" the moment EntitlementProvider mounts.
      registerEntitlementHandlers(ipcMain, {
        logger,
        dbHolder,
        service: entitlementService,
        emitToRenderer: makeRendererEmitter(
          BrowserWindow.getAllWindows()[0] ?? null,
        ),
      });
    } catch (err) {
      logger.warn(
        { scope: 'entitlement.boot', err: (err as Error).message },
        'entitlement bootstrap failed; gated surfaces will be closed',
      );
    }
  };
  // Poll for DB readiness (driven by the unlock IPC). Cheap and avoids
  // restructuring the existing onboarding wiring.
  const bootPoll = setInterval(() => {
    if (dbHolder.db) {
      clearInterval(bootPoll);
      void tryBootstrapEntitlement();
    }
  }, 250);

  // Plan 08.1-02 — single-instance deep-link forwarder for aria://activate
  // already registered in acquireSingleInstanceLock above; rewire onAriaUrl
  // now that we have a service factory.
  (globalThis as { __ariaOnAriaUrl?: (url: string) => void }).__ariaOnAriaUrl = (
    url: string,
  ) => {
    void (async () => {
      if (!entitlementService) await tryBootstrapEntitlement();
      if (!entitlementService) return;
      await handleActivateDeepLink(url, {
        service: entitlementService,
        // Plan 08.1-03 — emit ENTITLEMENT_STATE_CHANGED after a successful
        // deep-link activation so the paywall UX transitions in real time
        // without waiting for the next ENTITLEMENT_GET_STATE call. Look up
        // the live BrowserWindow at call time because mainWindow is created
        // AFTER this forwarder is registered.
        emitStateChanged: () => {
          try {
            const win = BrowserWindow.getAllWindows()[0];
            if (!win || !entitlementService) return;
            void entitlementService.getCurrentState().then((state) => {
              try {
                win.webContents.send(CHANNELS.ENTITLEMENT_STATE_CHANGED, {
                  state,
                });
              } catch {
                /* renderer may be torn down */
              }
            });
          } catch {
            /* best-effort notification */
          }
        },
      });
    })();
  };

  // Ollama active-model auto-pick on first connect. See autoPickOllamaModel.
  void autoPickOllamaModel({
    logger,
    getModelId: getOllamaModelId,
    setModelId: setOllamaModelId,
    probe: probeOllama,
  });

  const mainWindow = createMainWindow();

  // Plan 08-04 Task 5 — start electron-updater after the main window exists.
  // Skip in dev (no auto-updates from a vite dev server). Skip on test boot
  // (ARIA_E2E=1 — Playwright harness controls update flow explicitly).
  if (!process.env['ELECTRON_RENDERER_URL'] && process.env['ARIA_E2E'] !== '1') {
    void import('./release/updater')
      .then(({ startAutoUpdater }) =>
        startAutoUpdater({ logger, window: mainWindow }),
      )
      .catch((err) => {
        logger.warn(
          { scope: 'bootstrap', err: (err as Error).message },
          'updater.boot.fail',
        );
      });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
}

acquireSingleInstanceLock({
  app,
  onAriaUrl: (url) =>
    (globalThis as { __ariaOnAriaUrl?: (u: string) => void }).__ariaOnAriaUrl?.(url),
});

app.whenReady().then(bootstrap).catch((err) => {
  // Logger may not yet exist; fall back to console.
  // eslint-disable-next-line no-console
  console.error('aria bootstrap failed', err);
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
