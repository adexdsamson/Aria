---
phase: 01-foundation
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - package-lock.json
  - .gitignore
  - .npmrc
  - electron.vite.config.ts
  - tsconfig.json
  - tsconfig.node.json
  - tailwind.config.ts
  - postcss.config.js
  - vitest.config.ts
  - playwright.config.ts
  - tests/setup.ts
  - src/main/index.ts
  - src/main/ipc/index.ts
  - src/main/log/pino.ts
  - src/main/log/redact.ts
  - src/main/lifecycle/powerMonitor.ts
  - src/main/lifecycle/scheduler.ts
  - src/preload/index.ts
  - src/renderer/index.html
  - src/renderer/main.tsx
  - src/renderer/app/App.tsx
  - src/renderer/app/routes.tsx
  - src/renderer/app/theme/tokens.ts
  - src/renderer/app/theme/globals.css
  - src/renderer/components/SideNav.tsx
  - src/renderer/features/briefing/BriefingScreen.tsx
  - src/renderer/features/approvals/ApprovalsPlaceholder.tsx
  - src/renderer/features/settings/SettingsScreen.tsx
  - src/shared/ipc-contract.ts
autonomous: true
requirements: [FOUND-01, FOUND-07]
tags: [electron, electron-vite, react, typescript, tailwind, scaffold]

must_haves:
  truths:
    - "Running `npm run dev` on Windows 11 launches a single Electron window showing the Aria side nav (Briefing / Approvals / Settings)"
    - "Renderer runs with contextIsolation=true, sandbox=true, nodeIntegration=false"
    - "Pino log sink emits structured JSON to `userData/logs/aria.log` with PII redaction applied at the sink"
    - "Vitest and Playwright `_electron` smoke tests both pass"
  artifacts:
    - path: "package.json"
      provides: "Pinned Phase 1 dependency manifest"
      contains: "electron"
    - path: "electron.vite.config.ts"
      provides: "Main/preload/renderer build wiring"
    - path: "src/main/index.ts"
      provides: "App lifecycle, BrowserWindow with secure webPreferences, IPC handler registration, pino bootstrap"
    - path: "src/preload/index.ts"
      provides: "contextBridge.exposeInMainWorld('aria', { ... }) typed surface"
    - path: "src/shared/ipc-contract.ts"
      provides: "Typed IPC channel + payload contracts shared across main/preload/renderer"
    - path: "src/main/log/pino.ts"
      provides: "Pino logger with pino-roll transport and redaction"
    - path: "src/renderer/app/theme/tokens.ts"
      provides: "D-13 design token set (palette, type scale, radii, spacing, system light/dark)"
    - path: "vitest.config.ts"
      provides: "jsdom env for renderer tests, node env for main tests"
    - path: "playwright.config.ts"
      provides: "`_electron` launcher pointed at packaged dev build"
  key_links:
    - from: "src/main/index.ts"
      to: "src/main/ipc/index.ts"
      via: "registerHandlers(ipcMain) called after app.whenReady()"
      pattern: "registerHandlers\\("
    - from: "src/preload/index.ts"
      to: "src/shared/ipc-contract.ts"
      via: "imports CHANNELS constant and AriaApi type"
      pattern: "from ['\"]\\.\\./shared/ipc-contract['\"]"
    - from: "src/renderer/app/App.tsx"
      to: "window.aria"
      via: "renderer calls window.aria.* exposed by preload"
      pattern: "window\\.aria"
---

<objective>
Phase Goal

**As a** solo developer dogfooding Aria on Windows 11, **I want to** launch a secure Electron + React + TypeScript app shell with side-nav routing, **so that** every later plan and phase has a working, secure, observable surface to plug into.

Purpose: Establish the irreversible architectural choices (Electron 42 + electron-vite 5, contextIsolation/sandbox ON, React 18 + Tailwind 3.4 + shadcn, pino + pino-roll logging, vitest + playwright). Every later plan in Phase 1 (DB, secrets, router) imports from this scaffold.

Output: Runnable dev build on Windows 11, typed preload bridge, pino redacted log sink, vitest + playwright `_electron` smoke tests, design tokens.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@CLAUDE.md
@.planning/phases/01-foundation/01-CONTEXT.md
@.planning/phases/01-foundation/01-RESEARCH.md
@.planning/phases/01-foundation/01-VALIDATION.md
@.planning/phases/01-foundation/SKELETON.md

<interfaces>
<!-- This plan CREATES the contracts below. Plans 02-04 import them. -->

`src/shared/ipc-contract.ts` exports:
```
export const CHANNELS = {
  ASK_ARIA: 'aria:ask',
  ONBOARDING_GEN_MNEMONIC: 'aria:onboarding:gen-mnemonic',
  ONBOARDING_CONFIRM: 'aria:onboarding:confirm',
  ONBOARDING_SEAL: 'aria:onboarding:seal',
  ONBOARDING_UNLOCK: 'aria:onboarding:unlock',
  ONBOARDING_STATUS: 'aria:onboarding:status',
  SECRETS_SET_FRONTIER_KEY: 'aria:secrets:set',
  SECRETS_HAS_FRONTIER_KEY: 'aria:secrets:has',
  SECRETS_CLEAR_FRONTIER_KEY: 'aria:secrets:clear',
  SECRETS_GET_ACTIVE_PROVIDER: 'aria:secrets:get-provider',
  SECRETS_SET_ACTIVE_PROVIDER: 'aria:secrets:set-provider',
  OLLAMA_STATUS: 'aria:ollama:status',
  DIAGNOSTICS_ROUTING_LOG: 'aria:diagnostics:routing-log',
  DIAGNOSTICS_STATUS: 'aria:diagnostics:status',
  BACKUP_CREATE: 'aria:backup:create',
  BACKUP_RESTORE: 'aria:backup:restore',
} as const;

export type ProviderId = 'anthropic' | 'openai' | 'google';
export type SourceTag = 'user-email' | 'user-calendar' | 'user-transcript' | 'generic';
export type Route = 'LOCAL' | 'FRONTIER';
export interface AskRequest { prompt: string; source: SourceTag }
export interface AskResponse { answer: string; route: Route; reason: string; latency_ms: number }
export interface RoutingLogEntry { id: number; ts: string; route: Route; reason: string; source: SourceTag; prompt_hash: string; model: string; latency_ms: number; ok: number }
export interface OllamaStatus { reachable: boolean; version?: string; models: string[]; error?: string }
export interface DiagnosticsStatus { ollama: OllamaStatus; frontierConfigured: boolean; activeProvider: ProviderId | null; mode: 'LOCAL_ONLY' | 'HYBRID'; dataDir: string }
export interface AriaApi { /* matches CHANNELS surface 1:1 */ }
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Initialize npm project, pin dependencies, and configure tooling</name>
  <files>package.json, package-lock.json, .gitignore, .npmrc, tsconfig.json, tsconfig.node.json, electron.vite.config.ts, tailwind.config.ts, postcss.config.js, src/renderer/app/theme/globals.css, vitest.config.ts, playwright.config.ts, tests/setup.ts</files>
  <read_first>
    - CLAUDE.md (Technology Stack section — locked stack)
    - .planning/phases/01-foundation/01-RESEARCH.md lines 100-160 (Core dependency table + Installation block — RESEARCH overrides CLAUDE.md version pins; SDK 6 not 5; electron 42 not 33; ollama-ai-provider-v2 not ollama-ai-provider; pino 10, node-cron 4, p-queue 9, vitest 4, playwright 1.60)
    - .planning/phases/01-foundation/01-VALIDATION.md (Wave 0 Requirements — installs vitest + @vitest/coverage-v8, playwright + @playwright/test, configs, tests/setup.ts)
  </read_first>
  <behavior>
    - `npm run dev` invokes electron-vite dev with main/preload/renderer build targets
    - `npm test:unit` runs `vitest run --changed` and exits 0 on a clean tree
    - `npm test:e2e` runs `playwright test` against the packaged dev build
    - `npm test` runs both
    - TypeScript builds with strict mode against tsconfig.json (renderer) and tsconfig.node.json (main/preload)
    - Tailwind 3.4 + PostCSS pipeline transforms `globals.css` and is loaded by the renderer entry
  </behavior>
  <action>
    Initialize repo with `npm init -y`, then install RESEARCH-verified versions exactly as specified in `.planning/phases/01-foundation/01-RESEARCH.md` lines 142-155. Pin majors: electron@^42, electron-vite@^5, react@^18, react-dom@^18, better-sqlite3-multiple-ciphers@^12, ai@^6, @ai-sdk/anthropic@^3, @ai-sdk/openai@^3, @ai-sdk/google@^3, ollama-ai-provider-v2@^3, zod@^4, @scure/bip39@^2, pino@^10, pino-roll@^4, node-cron@^4, p-queue@^9, @electron-toolkit/preload. Dev deps: typescript@^5, vite@^5, tailwindcss@^3 (NOT 4 — RESEARCH explicit), @electron/rebuild@^4, electron-builder@^26, vitest@^4, @vitest/coverage-v8, playwright@^1.60, @playwright/test, @types/react, @types/react-dom, @types/node, autoprefixer, postcss, jsdom.

    Add npm scripts: `dev` = `electron-vite dev`, `build` = `electron-vite build`, `start` = `electron-vite preview`, `test:unit` = `vitest run`, `test:e2e` = `playwright test`, `test` = `npm run test:unit && npm run test:e2e`, `typecheck` = `tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json`, `postinstall` = `electron-rebuild -f -w better-sqlite3-multiple-ciphers` (per RESEARCH Pitfall 2 — guards Windows ABI rebuild for plan-02 native dep).

    Create `electron.vite.config.ts` with three entries: main → `src/main/index.ts`, preload → `src/preload/index.ts`, renderer → `src/renderer/index.html`. Renderer plugins: `@vitejs/plugin-react`. Build targets: ES2022 for main/preload, ES2022 + DOM for renderer.

    Create `tsconfig.json` (renderer): target ES2022, lib `["ES2022","DOM","DOM.Iterable"]`, jsx `react-jsx`, strict true, moduleResolution `bundler`, paths `@shared/* → src/shared/*`, `@renderer/* → src/renderer/*`. Create `tsconfig.node.json` (main + preload + configs): target ES2022, module `ESNext`, moduleResolution `bundler`, strict true, types `["node","electron"]`, includes main/preload/shared/electron.vite.config.ts.

    Create `tailwind.config.ts` with content `["./src/renderer/**/*.{ts,tsx,html}"]`, darkMode `"media"` (system light/dark per D-13), and a `theme.extend` block that **imports the design tokens from `src/renderer/app/theme/tokens.ts`** so palette/type-scale/radii/spacing live in one source-of-truth file. Create `postcss.config.js` with tailwindcss + autoprefixer.

    Create `vitest.config.ts` with two projects per VALIDATION.md Wave 0: project `main` env `node`, project `renderer` env `jsdom`. setupFiles → `tests/setup.ts`. Coverage provider `v8`.

    Create `playwright.config.ts` per VALIDATION.md: testDir `tests/e2e`, use `_electron` launcher that boots the dev build (`out/main/index.js`), retries 0 in CI, workers 1 (Electron single instance), reporter `list`.

    Create `tests/setup.ts` with the shared fixtures listed in VALIDATION.md Wave 0: a temp `userData` dir factory (uses `os.tmpdir()` + random uuid), a mocked `electron.safeStorage` (`isEncryptionAvailable: () => true`, `encryptString` = `Buffer.from`, `decryptString` = `(buf) => buf.toString('utf8')`) registered via `vi.mock('electron', ...)`. Export both factories.

    Create `.gitignore` covering `node_modules/`, `out/`, `dist/`, `*.log`, `.DS_Store`, `coverage/`, `test-results/`, `playwright-report/`, `userData/`, `*.ariabackup`, `.env`, `.env.*`. Create `.npmrc` with `node-linker=hoisted` (npm default) and `auto-install-peers=true` to keep AI SDK 6 peer-dep resolution clean.
  </action>
  <verify>
    <automated>npm install && npm run typecheck && npm run test:unit</automated>
  </verify>
  <acceptance_criteria>
    - `npm install` exits 0 and `node_modules/electron` package.json `version` starts with `42.`
    - `npm install` exits 0 and `node_modules/ai` package.json `version` starts with `6.`
    - `node_modules/ollama-ai-provider-v2/package.json` exists (NOT `node_modules/ollama-ai-provider/`)
    - `node_modules/tailwindcss/package.json` `version` starts with `3.` (NOT `4.`)
    - `npm run typecheck` exits 0
    - `npm run test:unit` exits 0 (zero tests is acceptable at this task; vitest runs without config errors)
    - `electron.vite.config.ts` contains three entries: `main`, `preload`, `renderer`
    - `tailwind.config.ts` references `src/renderer/app/theme/tokens.ts` via import
    - `.gitignore` contains `node_modules/`, `userData/`, and `*.ariabackup` literal lines
    - `package.json` scripts include `postinstall` with `electron-rebuild -f -w better-sqlite3-multiple-ciphers`
  </acceptance_criteria>
  <done>Repository scaffolded with pinned RESEARCH-verified versions; typecheck and unit-test runner both functional; Tailwind/PostCSS pipeline ready; e2e launcher configured.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Main process, secure preload bridge, IPC contract, and pino redacted log sink</name>
  <files>src/shared/ipc-contract.ts, src/main/index.ts, src/main/ipc/index.ts, src/main/log/pino.ts, src/main/log/redact.ts, src/main/lifecycle/powerMonitor.ts, src/main/lifecycle/scheduler.ts, src/preload/index.ts, tests/unit/main/log/redact.spec.ts, tests/unit/main/ipc/index.spec.ts</files>
  <read_first>
    - .planning/phases/01-foundation/01-RESEARCH.md lines 159-270 (architecture diagram + project structure)
    - .planning/phases/01-foundation/01-RESEARCH.md lines 580-640 (logging pattern with pino + pino-roll + redaction)
    - .planning/phases/01-foundation/01-CONTEXT.md (D-11 single-window + side nav; D-16 userData + pino redaction from day 1)
    - src/shared/ipc-contract.ts (creating in this task — interfaces declared in this plan's <context> block)
  </read_first>
  <behavior>
    - BrowserWindow is created with `webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: <preload path> }`
    - Renderer cannot access `require`, `process`, `electron`, or `Buffer` directly (verified by smoke test)
    - `window.aria` is the only renderer-exposed surface and matches `AriaApi` type
    - `tests/unit/main/log/redact.spec.ts` proves the redactor replaces emails, phone numbers, dollar amounts, and SSN-shaped strings with `[REDACTED]` before pino formats the line
    - All IPC handler names registered match the `CHANNELS` constant exactly (no string drift)
    - On macOS / Linux the app logs a warning and continues; only Windows path is asserted in tests
  </behavior>
  <action>
    Create `src/shared/ipc-contract.ts` exporting the `CHANNELS` const, `ProviderId`, `SourceTag`, `Route`, `AskRequest`, `AskResponse`, `RoutingLogEntry`, `OllamaStatus`, `DiagnosticsStatus`, and `AriaApi` types EXACTLY as listed in this plan's `<interfaces>` block. `AriaApi` is a typed object where each method name is a camelCase version of a channel and each takes/returns the inferred payload types (e.g. `askAria(req: AskRequest): Promise<AskResponse>`). Plans 02/03/04 import from this file ONLY — no string-literal IPC names anywhere else in the codebase.

    Create `src/main/log/redact.ts` exporting `DEFAULT_PII_PATTERNS` (regex array: email RFC5322-lite, E.164/NANP phone, currency `\\$[\\d,]+(?:\\.\\d+)?`, SSN `\\b\\d{3}-\\d{2}-\\d{4}\\b`) and `redactString(s: string): string` that replaces each match with `[REDACTED]`. Also export `redactObject(obj: unknown): unknown` (deep walk; redact string leaves). This file is THE single source-of-truth for log redaction (plan-04 routing-log writer imports from it).

    Create `src/main/log/pino.ts` exporting a singleton `logger` configured per RESEARCH §Logging: pino transport `pino-roll` writing to `<userData>/logs/aria.log`, daily rotation, max 30 files. Use pino's `formatters.log` hook to call `redactObject(obj)` BEFORE serialization. Resolve `userData` via `app.getPath('userData')` and lazily create the `logs/` subdir on first write (use `fs.mkdirSync({recursive:true})`).

    Create `src/main/lifecycle/powerMonitor.ts` exporting `registerPowerHooks(logger)` that subscribes to `powerMonitor.on('suspend' | 'resume' | 'lock-screen' | 'unlock-screen')` and emits a redacted log line each. No-op behavior for Phase 1; sets up the contract for Phase 2 cron coalescing.

    Create `src/main/lifecycle/scheduler.ts` exporting `registerScheduler(logger)` that constructs (but does not start) a `p-queue` instance with concurrency 1 and exports it; constructs a `node-cron` registry holder. Phase 1 only validates these modules load.

    Create `src/main/ipc/index.ts` exporting `registerHandlers(ipcMain, deps)`. Deps interface: `{ logger, db?, secrets?, router?, ollama?, vault? }`. In Phase 1 task 2 the function ONLY registers a no-op stub for EVERY channel in `CHANNELS` that resolves to `{ error: 'NOT_IMPLEMENTED' }`. Plans 02/03/04 replace stubs by passing real `deps` and conditionally registering real handlers. The function logs every IPC call entry/exit with `latency_ms` after redacting payload via `redactObject`.

    Create `src/main/index.ts`: on `app.whenReady()`, (a) initialize logger from `src/main/log/pino.ts`, (b) log `dataDir = app.getPath('userData')` at info level (D-16), (c) call `registerPowerHooks(logger)` and `registerScheduler(logger)`, (d) call `registerHandlers(ipcMain, { logger })`, (e) create BrowserWindow with `webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(__dirname, '../preload/index.js') }`, width 1280, height 800, autoHideMenuBar true, (f) set CSP via `session.defaultSession.webRequest.onHeadersReceived` to `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:11434 https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com; img-src 'self' data:` (mitigates THREAT T-01 below — keeps frontier + Ollama hosts in the allowlist; expanded only in future phases). On `window-all-closed` quit on non-darwin.

    Create `src/preload/index.ts` using `contextBridge.exposeInMainWorld('aria', api)` where `api` is constructed by mapping every channel in `CHANNELS` to an `ipcRenderer.invoke` call, typed against `AriaApi`. Renderer never imports from `electron`; it goes through `window.aria` only.

    Create `tests/unit/main/log/redact.spec.ts` with vitest tests proving: email `foo@bar.com` → `[REDACTED]`; phone `+1-415-555-0100` → `[REDACTED]`; `$1,234.56` → `[REDACTED]`; SSN `123-45-6789` → `[REDACTED]`; non-matching string passes through; nested object leaves all redacted.

    Create `tests/unit/main/ipc/index.spec.ts` with a vitest test that mocks `ipcMain.handle` and asserts `registerHandlers` registers exactly one handler per `CHANNELS` value and that calling each stub resolves to `{ error: 'NOT_IMPLEMENTED' }` until Plans 02/03/04 wire dependencies.
  </action>
  <verify>
    <automated>npm run test:unit -- tests/unit/main/log/redact.spec.ts tests/unit/main/ipc/index.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - `tests/unit/main/log/redact.spec.ts` passes
    - `tests/unit/main/ipc/index.spec.ts` passes and asserts exactly `Object.keys(CHANNELS).length` handlers registered
    - `src/main/index.ts` `BrowserWindow` constructor literal contains the substrings `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
    - `src/main/index.ts` CSP `connect-src` literal contains `http://127.0.0.1:11434`, `https://api.anthropic.com`, `https://api.openai.com`, `https://generativelanguage.googleapis.com`
    - `src/preload/index.ts` `exposeInMainWorld` argument is the literal `'aria'`
    - `src/shared/ipc-contract.ts` exports `CHANNELS`, `AriaApi`, `AskRequest`, `AskResponse`, `RoutingLogEntry`, `OllamaStatus`, `DiagnosticsStatus`
    - `grep -v '^//' src/preload/index.ts | grep -c "require\\b"` returns `0`
    - `grep -v '^//' src/renderer | grep -rc "from 'electron'" src/renderer || true` returns `0` (renderer never imports from electron)
  </acceptance_criteria>
  <done>Secure main process up; preload bridge exposes typed `window.aria`; IPC channel constants are the single source-of-truth; pino redacts PII at sink; logs land under userData; CSP locks renderer down.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Renderer shell (side-nav, design tokens, three section screens) and Electron smoke E2E</name>
  <files>src/renderer/index.html, src/renderer/main.tsx, src/renderer/app/App.tsx, src/renderer/app/routes.tsx, src/renderer/app/theme/tokens.ts, src/renderer/app/theme/globals.css, src/renderer/components/SideNav.tsx, src/renderer/features/briefing/BriefingScreen.tsx, src/renderer/features/approvals/ApprovalsPlaceholder.tsx, src/renderer/features/settings/SettingsScreen.tsx, tests/e2e/launch.spec.ts</files>
  <read_first>
    - .planning/phases/01-foundation/01-CONTEXT.md (D-11 single window + side nav; D-12 briefing is "Aria is alive" status screen; D-13 token set; D-14 Windows-first)
    - src/shared/ipc-contract.ts (created task 2)
    - src/preload/index.ts (created task 2 — defines `window.aria` typed surface)
  </read_first>
  <behavior>
    - The dev build launches a single window 1280×800 with a left side nav listing three items: "Briefing", "Approvals", "Settings"
    - Default route is `/briefing` and shows the literal heading "Aria is alive" (D-12 dogfood-loop placeholder; the real Ask Aria box arrives in plan-04)
    - Approvals route shows literal text "Approvals queue — coming in Phase 3" (D-11 placeholder)
    - Settings route shows placeholder sections titled "Onboarding", "Frontier API key", "Ollama", "Diagnostics" (filled by plans 02/03/04)
    - Theme tokens from `tokens.ts` are surfaced as CSS variables in `:root` and `:root[data-theme="dark"]` via `globals.css`
    - Playwright `_electron` smoke test launches the app, asserts the window title is "Aria", and the three nav items are visible
  </behavior>
  <action>
    Create `src/renderer/app/theme/tokens.ts` exporting `tokens` per D-13 with neutral palette (gray-50..gray-950), one accent (use `#5b8def` indigo; document the choice in a top-of-file comment), type scale (xs/sm/base/lg/xl/2xl/3xl px values), radii (sm/md/lg/xl), spacing (xs/sm/md/lg/xl). Export both light and dark variants under `tokens.light` and `tokens.dark`.

    Create `src/renderer/app/theme/globals.css` with `@tailwind base; @tailwind components; @tailwind utilities;` plus `:root` and `@media (prefers-color-scheme: dark) :root` blocks emitting CSS variables for every token. Import it from `main.tsx`.

    Create `src/renderer/components/SideNav.tsx` rendering nav links for the three sections using React Router 6 `NavLink` (install `react-router-dom@^6` in this task; add to package.json deps). Active link uses accent color.

    Create `src/renderer/app/routes.tsx` exporting `<Routes>` with three Route entries: `/briefing` → `<BriefingScreen/>`, `/approvals` → `<ApprovalsPlaceholder/>`, `/settings/*` → `<SettingsScreen/>`. Default redirect from `/` to `/briefing`.

    Create `src/renderer/app/App.tsx` wrapping `<BrowserRouter>` + flex layout: `<SideNav/>` left fixed width, `<main>` right scrollable. Use MemoryRouter inside Electron for renderer per Electron best practice.

    Create the three feature screens. `BriefingScreen.tsx` renders `<h1>Aria is alive</h1>` plus a `<p>` describing it as the Phase 1 placeholder. `ApprovalsPlaceholder.tsx` renders the exact string "Approvals queue — coming in Phase 3". `SettingsScreen.tsx` renders nested routes for `onboarding`, `frontier-key`, `ollama`, `diagnostics` and a sidebar selector — concrete content for each subsection is rendered by plans 02/03/04 (placeholders for now, each with a `<section data-testid="settings-...">` so later plans have stable hooks).

    Create `src/renderer/main.tsx` mounting `<App/>` into `#root` and asserting `window.aria` is present (`if (!window.aria) console.error('Preload bridge missing — aborting');`).

    Update `src/renderer/index.html` with `<div id="root"></div>`, `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'">` (defense-in-depth alongside main-process CSP).

    Create `tests/e2e/launch.spec.ts` using `_electron` to launch from `out/main/index.js`, wait for window, assert title === "Aria", assert nav items "Briefing" / "Approvals" / "Settings" visible, assert `/briefing` heading is "Aria is alive". Run `npm run build` before the test in a Playwright `globalSetup` (or document running `npm run build` in CI before `npm run test:e2e`).
  </action>
  <verify>
    <automated>npm run build && npm run test:e2e</automated>
  </verify>
  <acceptance_criteria>
    - `npm run build` exits 0 and produces `out/main/index.js`, `out/preload/index.js`, `out/renderer/index.html`
    - `npm run test:e2e -- tests/e2e/launch.spec.ts` passes
    - `grep -c "data-testid=\"settings-" src/renderer/features/settings/SettingsScreen.tsx` returns at least `4` (one per subsection: onboarding, frontier-key, ollama, diagnostics)
    - `src/renderer/features/briefing/BriefingScreen.tsx` contains literal string `"Aria is alive"`
    - `src/renderer/features/approvals/ApprovalsPlaceholder.tsx` contains literal string `"coming in Phase 3"`
    - `src/renderer/app/theme/tokens.ts` exports both `tokens.light` and `tokens.dark`
  </acceptance_criteria>
  <done>Single-window app with three-section side nav running on Windows 11; design tokens are the single source-of-truth for palette/type/radii/spacing; e2e smoke test exercises the full main+preload+renderer stack.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Renderer → Main (IPC) | Renderer is sandboxed/contextIsolation'd; main is full-trust. All renderer requests cross via `contextBridge` |
| Main → Disk (userData) | Main writes logs and (in later plans) DB; disk is user-trust |
| Main → Network | Outbound only to allowlisted hosts (Ollama localhost + frontier APIs) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-01-01 | Elevation of Privilege | BrowserWindow webPreferences | mitigate (HIGH) | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`; preload uses contextBridge only; CSP locks `script-src` to `'self'` and `connect-src` to Ollama localhost + the three frontier API origins (no `'unsafe-inline'` or `'unsafe-eval'` on scripts) |
| T-01-01-02 | Information Disclosure | pino log files in userData | mitigate (HIGH) | `redactObject` runs on every formatter.log call; default patterns cover email/phone/$$/SSN; covered by `redact.spec.ts` unit tests |
| T-01-01-03 | Tampering | Renderer imports from `electron` to escape sandbox | mitigate (MEDIUM) | Grep gate on renderer source forbids `from 'electron'` imports; preload bridge is the only typed surface |
| T-01-01-04 | Information Disclosure | CSP `connect-src` wildcards | mitigate (MEDIUM) | Hard allowlist of four origins (ollama localhost + anthropic + openai + google); no wildcard; future hosts (Gmail/Graph) added per-phase via explicit grep-verified entry |
| T-01-01-05 | Denial of Service | Native dep rebuild fails on Windows | accept (LOW) | `postinstall` runs `electron-rebuild`; if VS Build Tools missing on a fresh machine the install fails loudly — surfaced as a dev-setup task in SKELETON.md rather than a runtime risk |
</threat_model>

<verification>
- All three tasks' automated commands pass on Windows 11 dev box
- `npm run dev` opens a single window with three nav items; `/briefing` shows "Aria is alive"
- `out/renderer/index.html` exists after `npm run build` (proves electron-vite three-target build works)
- No `require(`, `process.`, or `electron` reference in any `src/renderer/**/*.tsx` file (`grep -rc "from 'electron'" src/renderer || true` returns 0)
</verification>

<success_criteria>
Plan 01 satisfies Phase-1 success criteria #1 (working app window) and partially #3 (status surface — Settings → Diagnostics placeholder exists). Other success criteria are completed by Plans 02 (DB + backup + restore), 03 (API key in keychain + Ollama warning), and 04 (routing decision logged).
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation/01-01-SUMMARY.md` describing:
- Exact pinned versions installed (from `package-lock.json`)
- Resolved `app.getPath('userData')` value on the dev machine (logged at first launch)
- Any deviations from RESEARCH version table with rationale
- Confirmation that `contextIsolation`/`sandbox`/`nodeIntegration` flags match the threat-model literal strings
</output>
