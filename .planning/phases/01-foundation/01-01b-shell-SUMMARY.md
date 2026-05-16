---
phase: 01-foundation
plan: 01b
subsystem: shell
tags: [electron, react, preload, ipc, pino, csp, scaffold, security]
requires: [01-foundation/01a]
provides: [ipc-contract, preload-bridge, redact-pii, pino-logger, renderer-shell, tokens-d13, e2e-smoke]
affects: [02, 03, 04]
tech_stack:
  added:
    - "@electron/fuses@1.x (dev dep — for hardening config block)"
    - "react-router-dom@6 (newly installed at npm install time; pinned in plan 01a package.json)"
  patterns:
    - "Single source-of-truth IPC contract: CHANNELS + CHANNEL_METHODS + AriaApi exported from src/shared/ipc-contract.ts"
    - "Preload bridge auto-built by mapping every CHANNELS entry to ipcRenderer.invoke against AriaApi method names"
    - "Pino redaction at formatters.log hook — PII never reaches disk regardless of caller hygiene"
    - "MemoryRouter (not BrowserRouter) for Electron renderer loaded from file://"
    - "Electron Fuses config block kept adjacent to BrowserWindow webPreferences for review by Plan 08 packaging"
key_files:
  created:
    - "src/shared/ipc-contract.ts"
    - "src/main/index.ts"
    - "src/main/ipc/index.ts"
    - "src/main/log/pino.ts"
    - "src/main/log/redact.ts"
    - "src/main/lifecycle/powerMonitor.ts"
    - "src/main/lifecycle/scheduler.ts"
    - "src/preload/index.ts"
    - "src/renderer/index.html"
    - "src/renderer/main.tsx"
    - "src/renderer/global.d.ts"
    - "src/renderer/app/App.tsx"
    - "src/renderer/app/routes.tsx"
    - "src/renderer/components/SideNav.tsx"
    - "src/renderer/features/briefing/BriefingScreen.tsx"
    - "src/renderer/features/approvals/ApprovalsPlaceholder.tsx"
    - "tests/unit/main/log/redact.spec.ts"
    - "tests/unit/main/ipc/index.spec.ts"
    - "tests/e2e/launch.spec.ts"
  modified:
    - "src/renderer/app/theme/tokens.ts (stub → real D-13 palette)"
    - "src/renderer/app/theme/globals.css (CSS variables for all tokens, system + data-theme dark variants)"
    - "package.json + package-lock.json (added @electron/fuses dev dep)"
decisions:
  - "Accent color #5b8def: passes WCAG AA against both light (#fafafa..#ffffff) and dark (#0b0b0d..#18181b) neutrals; reads professional rather than playful; visually distinct from system blue."
  - "ELECTRON_FUSES_CONFIG exported (not invoked) at main entry — Plan 08 packaging step calls flipFuses with this object. Keeps the security policy reviewable next to webPreferences."
  - "MemoryRouter chosen over BrowserRouter to avoid history-API quirks when the renderer is served from file:// in production builds."
  - "Stub IPC handlers return frozen { error: 'NOT_IMPLEMENTED' } and log enter/exit with redacted payloads — gives plans 02/03/04 a working observability + redaction baseline before they replace bodies."
metrics:
  duration: "~75 min"
  completed: "2026-05-16"
  commits: 2
---

# Phase 1 Plan 01b: Shell — Summary

One-liner: Secure Electron + React shell with sandboxed renderer, contextBridge-only IPC surface, pino + redaction log sink, three-section side-nav UI, and Playwright `_electron` smoke E2E — the foundation every later Phase-1 plan plugs into.

## What Shipped

Two task commits on `worktree-agent-abc7dfd97a67269c7`:

1. **`21462cb` — feat(01-01b): main process, secure preload bridge, IPC contract, pino redacted log sink**
   - `src/shared/ipc-contract.ts`: `CHANNELS` (16 channels), `CHANNEL_METHODS` (camelCase mapping), `AriaApi` interface, payload types (`AskRequest/Response`, `RoutingLogEntry`, `OllamaStatus`, `DiagnosticsStatus`, onboarding/secrets shapes), `IpcError` envelope.
   - `src/main/log/redact.ts`: `DEFAULT_PII_PATTERNS` (email RFC5322-lite, SSN, NANP/E.164 phone, currency `$N`/`$N,NNN.NN`), `redactString`, `redactObject` (cycle-safe deep walk).
   - `src/main/log/pino.ts`: singleton logger with `pino-roll` daily-rotating transport at `<userData>/logs/aria.log` (max 30 files), `formatters.log` runs `redactObject` BEFORE serialization (T-01-01b-03).
   - `src/main/lifecycle/{powerMonitor,scheduler}.ts`: scaffolds — `registerPowerHooks` subscribes to `suspend`/`resume`/`lock-screen`/`unlock-screen` and emits log lines; `registerScheduler` returns a `p-queue` (concurrency 1) + empty `node-cron` registry for Phase 2.
   - `src/main/ipc/index.ts`: `registerHandlers(ipcMain, deps)` iterates `Object.values(CHANNELS)` and registers a no-op handler returning frozen `{ error: 'NOT_IMPLEMENTED' }`. Every handler logs `ipc.enter`/`ipc.exit` with redacted payload + `latency_ms`.
   - `src/main/index.ts`: `app.whenReady()` bootstrap initializes logger, logs `dataDir = app.getPath('userData')` (D-16), applies CSP via `session.defaultSession.webRequest.onHeadersReceived` with the exact `connect-src` allowlist (Ollama localhost + Anthropic + OpenAI + Google), registers power + scheduler + IPC, creates a 1280×800 `BrowserWindow` with `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. `ELECTRON_FUSES_CONFIG` exported with `RunAsNode: false` and `EnableNodeOptionsEnvironmentVariable: false` (RESOLVED Open Q 6).
   - `src/preload/index.ts`: `contextBridge.exposeInMainWorld('aria', api)` where `api` is built by mapping every `CHANNELS` entry to `ipcRenderer.invoke` via `CHANNEL_METHODS`.
   - **Tests:** 12/12 pass — `redact.spec.ts` (8 cases: email, phone, currency, SSN, non-match passthrough, empty/undefined guard, DEFAULT_PII_PATTERNS shape, nested object + cycle) + `ipc/index.spec.ts` (4 cases: exact handler count, every stub returns NOT_IMPLEMENTED, redaction in log payload, channel coverage).

2. **`6ea3a4d` — feat(01-01b): renderer shell (tokens, side nav, Briefing + Approvals) + Playwright smoke E2E**
   - `src/renderer/app/theme/tokens.ts`: real D-13 token set — neutral palette `gray-50..gray-950` (zinc-derived), accent `#5b8def` (light) / `#7aa2f7` (dark), `accent-fg`/`bg`/`fg`/`muted-fg`/`border`, type scale (`xs`..`3xl` px), radii (`sm`..`xl`), spacing (`xs`..`xl`). Both `tokens.light` and `tokens.dark` exported.
   - `src/renderer/app/theme/globals.css`: CSS variables for every token on `:root` and `:root[data-theme='dark']`, plus `@media (prefers-color-scheme: dark)` for system follow.
   - `src/renderer/index.html`: defense-in-depth meta CSP, single `#root` div, module script to `main.tsx`.
   - `src/renderer/main.tsx`: `createRoot` + `StrictMode`, asserts `window.aria` is present (logs error if preload bridge missing).
   - `src/renderer/global.d.ts`: `Window.aria: AriaApi` type augmentation.
   - `src/renderer/app/App.tsx`: `MemoryRouter` + flex layout (220 px fixed `SideNav` + scrollable `<main>`).
   - `src/renderer/app/routes.tsx`: `/` → `<Navigate to="/briefing">`, `/briefing` → `BriefingScreen`, `/approvals` → `ApprovalsPlaceholder`, `/settings/*` → minimal placeholder (Plan 03 replaces).
   - `src/renderer/components/SideNav.tsx`: `NavLink`s for Briefing/Approvals/Settings; active state uses accent token.
   - `src/renderer/features/briefing/BriefingScreen.tsx`: literal `<h1>Aria is alive</h1>` + descriptive paragraph (D-12).
   - `src/renderer/features/approvals/ApprovalsPlaceholder.tsx`: literal text `"Approvals queue — coming in Phase 3"`.
   - `tests/e2e/launch.spec.ts`: Playwright `_electron.launch(out/main/index.js)` → asserts title is `"Aria"`, three nav links visible, briefing heading visible. **Passes in 4.0 s.**

## Acceptance Criteria Status

**Task 1**
- [x] `tests/unit/main/log/redact.spec.ts` passes (8 cases, ≥6 required)
- [x] `tests/unit/main/ipc/index.spec.ts` passes — asserts exactly `Object.keys(CHANNELS).length` (= 16) handlers registered
- [x] `src/main/index.ts` BrowserWindow constructor contains literal `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
- [x] `src/main/index.ts` CSP `connect-src` literal contains `http://127.0.0.1:11434`, `https://api.anthropic.com`, `https://api.openai.com`, `https://generativelanguage.googleapis.com`
- [x] `src/main/index.ts` references `RunAsNode` and `EnableNodeOptionsEnvironmentVariable` in `ELECTRON_FUSES_CONFIG`
- [x] `src/preload/index.ts` `exposeInMainWorld` argument is literal `'aria'`
- [x] `src/shared/ipc-contract.ts` exports `CHANNELS`, `AriaApi`, `AskRequest`, `AskResponse`, `RoutingLogEntry`, `OllamaStatus`, `DiagnosticsStatus`
- [x] `grep -v '^//' src/preload/index.ts | grep -c "require\b"` returns 0

**Task 2**
- [x] `npm run build` exits 0; produces `out/main/index.js`, `out/preload/index.js`, `out/renderer/index.html` (verified)
- [x] `npm run test:e2e -- tests/e2e/launch.spec.ts` passes (4.0 s)
- [x] `BriefingScreen.tsx` contains literal `"Aria is alive"`
- [x] `ApprovalsPlaceholder.tsx` contains literal `"coming in Phase 3"`
- [x] `tokens.ts` exports both `tokens.light` and `tokens.dark`

**Plan-level**
- [x] `grep -rc "from 'electron'" src/renderer` → total 0 (renderer never imports from electron)
- [x] `npm run typecheck` exits 0
- [x] Both `<automated>` commands pass on Windows 11 dev box

## Resolved Environment Values

- **`app.getPath('userData')`** (resolved at first launch on dev box): Windows default — `%APPDATA%\Aria\` (concretely `C:\Users\HomePC\AppData\Roaming\Aria`). Logged at `info` level on bootstrap as `aria.start` with `scope: 'bootstrap'`. Pino log file: `<userData>\logs\aria.log` (created on first write).
- **`contextIsolation` / `sandbox` / `nodeIntegration`**: Confirmed literal `true`, `true`, `false` in `src/main/index.ts` line range covering the `webPreferences` block — matches threat model T-01-01b-01 mitigation exactly.
- **Electron Fuses**: `ELECTRON_FUSES_CONFIG` in `src/main/index.ts` sets `RunAsNode: false` and `EnableNodeOptionsEnvironmentVariable: false`. Plan 08 (packaging) will pass this config object to `@electron/fuses` `flipFuses` against the packaged binary; runtime application requires the packaging step and is therefore out of scope for Plan 01b's "secure renderer in dev" goal. The config block is reviewable and grep-verifiable today.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] p-queue v9 CJS default-export interop**
- **Found during:** Task 2 verification (manual electron launch after first e2e timeout)
- **Issue:** `p-queue@9.3.0` is ESM-only. After electron-vite bundles `src/main/index.ts` to CJS, `import PQueue from 'p-queue'` resolves to the namespace object, and the actual constructor lands on `.default`. `new PQueue({...})` threw `TypeError: PQueue is not a constructor` inside `bootstrap`, killing the app before the window ever opened. Playwright `firstWindow()` then waited 30 s and timed out with no specific assertion failure.
- **Fix:** In `src/main/lifecycle/scheduler.ts`, normalize the import: `const PQueue = (PQueueImport as any).default ?? PQueueImport;`. Build re-ran clean and app launches in <1 s. Playwright e2e then passed in 4.0 s.
- **Files modified:** `src/main/lifecycle/scheduler.ts`
- **Commit:** `6ea3a4d` (folded into the Task 2 commit since the bug only surfaced via the Task 2 e2e run)

**2. [Rule 3 - Blocking] `@electron/fuses` not in plan-01a dep matrix**
- **Found during:** Task 1 implementation
- **Issue:** The plan's `<behavior>` requires `RunAsNode` and `EnableNodeOptionsEnvironmentVariable` to be referenced in a Fuses configuration block. Plan 01a's pinned deps did not include `@electron/fuses`. Without it the Fuses configuration cannot use typed `FuseV1Options`/`FuseVersion` enums and the acceptance grep ("references `RunAsNode` and `EnableNodeOptionsEnvironmentVariable` in a Fuses configuration block") would only be satisfied via raw string constants — fragile and easy to drift.
- **Fix:** `npm install --save-dev @electron/fuses` (resolves to 1.x). `package.json` + `package-lock.json` updated. Plan 08 packaging will use the same dep to invoke `flipFuses` at sign time.
- **Files modified:** `package.json`, `package-lock.json`
- **Commit:** `21462cb`

**3. [Rule 3 - Blocking] Renderer `Window.aria` type augmentation**
- **Found during:** Task 2 typecheck after writing `main.tsx`
- **Issue:** Plan instructed `main.tsx` to read `window.aria` defensively. With `tsconfig.json` `strict: true`, the preload-side `declare global { interface Window { aria: AriaApi } }` is not visible to the renderer project — `Property 'aria' does not exist on type 'Window'` (`error TS2339`).
- **Fix:** Added `src/renderer/global.d.ts` with a renderer-side type-only `interface Window { aria: AriaApi }` augmentation, imported from `@shared/ipc-contract`. Typecheck clean.
- **Files added:** `src/renderer/global.d.ts`
- **Commit:** `6ea3a4d`

**4. [Rule 1 - Bug] Trivial comment grep false-positive on `from 'electron'`**
- **Found during:** Task 2 verification grep
- **Issue:** A comment in `src/renderer/main.tsx` contained the literal substring `from 'electron'` (in an explanatory clause), causing the plan's grep gate to count 1 occurrence.
- **Fix:** Rephrased the comment to `the electron module` so the gate returns 0. No semantic change.
- **Commit:** `6ea3a4d`

## Known Stubs

| File | Stub | Resolved by |
|---|---|---|
| `src/main/ipc/index.ts` | Every handler returns `{ error: 'NOT_IMPLEMENTED' }` | Plans 02/03/04 replace bodies by passing real deps |
| `src/renderer/app/routes.tsx` `SettingsPlaceholder` | Minimal `<h1>Settings</h1>` only | Plan 03 ships real `SettingsScreen.tsx` (frontier key, Ollama health, sections) |
| `src/main/index.ts` `ELECTRON_FUSES_CONFIG` | Config block exported but not yet applied to a packaged binary (no packaging step in Phase 1) | Plan 08 packaging invokes `flipFuses(binPath, ELECTRON_FUSES_CONFIG)` |

Both `IPC` and `Settings` stubs are intentional and tracked by the plans noted above. The Fuses application is deferred per Phase 8's scope; the policy is reviewable and grep-verifiable today.

## Threat Flags

None new beyond the plan's `<threat_model>`. The IPC stub return shape `{ error: 'NOT_IMPLEMENTED' }` is a uniform, side-effect-free response that does not leak environment data — safe to ship without further mitigation.

## Authentication Gates

None encountered.

## Self-Check: PASSED

**Files verified present:**
- `src/shared/ipc-contract.ts`, `src/main/index.ts`, `src/main/ipc/index.ts`, `src/main/log/pino.ts`, `src/main/log/redact.ts`, `src/main/lifecycle/powerMonitor.ts`, `src/main/lifecycle/scheduler.ts`
- `src/preload/index.ts`
- `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/global.d.ts`
- `src/renderer/app/App.tsx`, `src/renderer/app/routes.tsx`, `src/renderer/app/theme/tokens.ts`, `src/renderer/app/theme/globals.css`
- `src/renderer/components/SideNav.tsx`, `src/renderer/features/briefing/BriefingScreen.tsx`, `src/renderer/features/approvals/ApprovalsPlaceholder.tsx`
- `tests/unit/main/log/redact.spec.ts`, `tests/unit/main/ipc/index.spec.ts`, `tests/e2e/launch.spec.ts`

**Commits verified present on `worktree-agent-abc7dfd97a67269c7`:**
- `21462cb` (Task 1)
- `6ea3a4d` (Task 2)

**Gates:**
- `npm run typecheck` → exit 0
- `npm run test:unit` → 12/12 pass
- `npm run build` → exit 0; all three `out/` artifacts present
- `npm run test:e2e` → 1/1 pass (4.0 s)
- `grep -rc "from 'electron'" src/renderer` → total 0
