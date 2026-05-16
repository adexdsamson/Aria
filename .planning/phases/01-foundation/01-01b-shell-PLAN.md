---
phase: 01-foundation
plan: 01b
type: execute
wave: 2
depends_on: ["01-foundation/01a"]
files_modified:
  - src/shared/ipc-contract.ts
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
  - tests/unit/main/log/redact.spec.ts
  - tests/unit/main/ipc/index.spec.ts
  - tests/e2e/launch.spec.ts
autonomous: true
requirements: [FOUND-01, FOUND-07]
tags: [electron, react, preload, ipc, pino, csp, scaffold]

must_haves:
  truths:
    - "`npm run dev` on Windows 11 launches a single Electron window with the Aria side nav (Briefing / Approvals / Settings)"
    - "Renderer runs with contextIsolation=true, sandbox=true, nodeIntegration=false"
    - "Pino log sink emits structured JSON to `<userData>/logs/aria.log` with PII redaction applied at the sink"
    - "Vitest unit tests (redact + IPC registration) and Playwright `_electron` smoke test all pass"
    - "Electron Fuses harden the binary: `RunAsNode` and `EnableNodeOptionsEnvironmentVariable` disabled (per RESOLVED Open Question 6)"
  artifacts:
    - path: "src/shared/ipc-contract.ts"
      provides: "Typed IPC CHANNELS + AriaApi + payload types — single source-of-truth"
    - path: "src/main/index.ts"
      provides: "App lifecycle, BrowserWindow with secure webPreferences, IPC handler registration, pino bootstrap, CSP, hardening Fuses"
    - path: "src/main/log/pino.ts"
      provides: "Pino logger with pino-roll transport and redaction at formatters.log"
    - path: "src/main/log/redact.ts"
      provides: "DEFAULT_PII_PATTERNS + redactString + redactObject — reused by plan 04 classifier"
    - path: "src/main/ipc/index.ts"
      provides: "registerHandlers(ipcMain, deps) — registers no-op stubs for every CHANNELS entry; plans 02/03/04 replace stubs by passing real deps"
    - path: "src/preload/index.ts"
      provides: "contextBridge.exposeInMainWorld('aria', api) — typed surface; renderer never imports from 'electron'"
    - path: "src/renderer/app/theme/tokens.ts"
      provides: "D-13 token set: neutral palette, accent, type scale, radii, spacing; light + dark variants"
    - path: "tests/e2e/launch.spec.ts"
      provides: "`_electron` smoke test asserting title and three nav items"
  key_links:
    - from: "src/main/index.ts"
      to: "src/main/ipc/index.ts"
      via: "registerHandlers(ipcMain, { logger }) called after app.whenReady()"
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

**As a** solo developer dogfooding Aria on Windows 11, **I want to** launch a secure Electron + React + TypeScript shell with side-nav routing, **so that** plans 02/03/04 have a working, secure, observable surface to plug into.

Purpose: Implement the irreversible architectural choices (contextIsolation + sandbox + Fuses; pino + redact; React + Tailwind; typed IPC contract). Every later Phase 1 plan imports from this scaffold.

Output: Runnable dev build on Windows 11; typed preload bridge; pino redacted log sink; vitest unit tests for redact + IPC; Playwright `_electron` smoke test; tokens.ts (real palette); SettingsScreen.tsx is created with a minimal nested-route shell that Plan 03 will populate.
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
@.planning/phases/01-foundation/01-01a-SUMMARY.md

<interfaces>
<!-- This plan CREATES the contracts below. Plans 02/03/04 import them. -->

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
  <name>Task 1: Main process, secure preload bridge, IPC contract, pino redacted log sink</name>
  <files>src/shared/ipc-contract.ts, src/main/index.ts, src/main/ipc/index.ts, src/main/log/pino.ts, src/main/log/redact.ts, src/main/lifecycle/powerMonitor.ts, src/main/lifecycle/scheduler.ts, src/preload/index.ts, tests/unit/main/log/redact.spec.ts, tests/unit/main/ipc/index.spec.ts</files>
  <read_first>
    - .planning/phases/01-foundation/01-RESEARCH.md lines 159-270 (architecture + project structure)
    - .planning/phases/01-foundation/01-RESEARCH.md lines 580-640 (pino + pino-roll + redaction pattern)
    - .planning/phases/01-foundation/01-RESEARCH.md lines 776-810 (RESOLVED Open Question 6 — Electron Fuses)
    - .planning/phases/01-foundation/01-CONTEXT.md (D-11 single window + side nav; D-16 userData + pino redaction from day 1)
  </read_first>
  <behavior>
    - BrowserWindow webPreferences: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `preload: <path>`
    - Electron Fuses applied at build time: `RunAsNode: false`, `EnableNodeOptionsEnvironmentVariable: false` (per RESOLVED Open Question 6)
    - CSP set via `session.defaultSession.webRequest.onHeadersReceived`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:11434 https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com; img-src 'self' data:`
    - Renderer cannot access `require`, `process`, `electron`, `Buffer` directly
    - `window.aria` is the only renderer-exposed surface and matches `AriaApi`
    - Pino redactor replaces email, phone, $$ amounts, SSN-shaped strings with `[REDACTED]` BEFORE serialization
    - All IPC handler names registered match the `CHANNELS` constant exactly
  </behavior>
  <action>
    Create `src/shared/ipc-contract.ts` exporting `CHANNELS`, `ProviderId`, `SourceTag`, `Route`, `AskRequest`, `AskResponse`, `RoutingLogEntry`, `OllamaStatus`, `DiagnosticsStatus`, and `AriaApi` EXACTLY as listed in this plan's `<interfaces>` block. `AriaApi` is a typed object where each method name is the camelCase form of a channel and takes/returns the inferred payload types (e.g. `askAria(req: AskRequest): Promise<AskResponse>`). Plans 02/03/04 import from this file ONLY — no string-literal IPC names anywhere else.

    Create `src/main/log/redact.ts` exporting `DEFAULT_PII_PATTERNS` (regex array: email RFC5322-lite, E.164/NANP phone, currency `\\$[\\d,]+(?:\\.\\d+)?`, SSN `\\b\\d{3}-\\d{2}-\\d{4}\\b`) and `redactString(s: string): string` that replaces each match with `[REDACTED]`. Also export `redactObject(obj: unknown): unknown` (deep walk; redact string leaves). This is THE single source-of-truth for log redaction — Plan 04 classifier re-exports `DEFAULT_PII_PATTERNS`.

    Create `src/main/log/pino.ts` exporting a singleton `logger` configured per RESEARCH §Logging: pino transport `pino-roll` writing to `<userData>/logs/aria.log`, daily rotation, max 30 files. Use pino's `formatters.log` hook to call `redactObject(obj)` BEFORE serialization. Resolve `userData` via `app.getPath('userData')` and lazily create the `logs/` subdir on first write via `fs.mkdirSync({ recursive: true })`.

    Create `src/main/lifecycle/powerMonitor.ts` exporting `registerPowerHooks(logger)` that subscribes to `powerMonitor.on('suspend' | 'resume' | 'lock-screen' | 'unlock-screen')` and emits a redacted log line each. No-op behavior in Phase 1; sets up the contract for Phase 2 cron coalescing.

    Create `src/main/lifecycle/scheduler.ts` exporting `registerScheduler(logger)` that constructs (but does not start) a `p-queue` instance with concurrency 1 and a `node-cron` registry holder. Phase 1 only validates these modules load.

    Create `src/main/ipc/index.ts` exporting `registerHandlers(ipcMain, deps)`. Deps interface: `{ logger, db?, secrets?, router?, ollama?, vault? }`. In this task the function ONLY registers a no-op stub for EVERY channel in `CHANNELS` that resolves to `{ error: 'NOT_IMPLEMENTED' }`. Plans 02/03/04 replace stubs by passing real `deps`. The function logs every IPC call entry/exit with `latency_ms` after redacting payload via `redactObject`.

    Create `src/main/index.ts`: on `app.whenReady()`, (a) initialize logger from `src/main/log/pino.ts`, (b) log `dataDir = app.getPath('userData')` at info level (D-16), (c) call `registerPowerHooks(logger)` and `registerScheduler(logger)`, (d) call `registerHandlers(ipcMain, { logger })`, (e) create BrowserWindow with `webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(__dirname, '../preload/index.js') }`, width 1280, height 800, `autoHideMenuBar: true`, (f) set CSP via `session.defaultSession.webRequest.onHeadersReceived` to the literal CSP listed in `<behavior>` above, (g) apply Electron Fuses via `@electron/fuses` (or document the electron-builder Fuses block) disabling `RunAsNode` and `EnableNodeOptionsEnvironmentVariable`. On `window-all-closed` quit on non-darwin.

    Create `src/preload/index.ts` using `contextBridge.exposeInMainWorld('aria', api)` where `api` is constructed by mapping every channel in `CHANNELS` to an `ipcRenderer.invoke` call, typed against `AriaApi`. Renderer never imports from `electron`; it goes through `window.aria` only.

    Create `tests/unit/main/log/redact.spec.ts` with vitest tests proving: email `foo@bar.com` → `[REDACTED]`; phone `+1-415-555-0100` → `[REDACTED]`; `$1,234.56` → `[REDACTED]`; SSN `123-45-6789` → `[REDACTED]`; non-matching string passes through; nested object leaves all redacted.

    Create `tests/unit/main/ipc/index.spec.ts` mocking `ipcMain.handle`; assert `registerHandlers` registers exactly one handler per `CHANNELS` value and that calling each stub resolves to `{ error: 'NOT_IMPLEMENTED' }`.
  </action>
  <verify>
    <automated>npm run test:unit -- tests/unit/main/log/redact.spec.ts tests/unit/main/ipc/index.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - `tests/unit/main/log/redact.spec.ts` passes (≥6 cases)
    - `tests/unit/main/ipc/index.spec.ts` passes and asserts exactly `Object.keys(CHANNELS).length` handlers registered
    - `src/main/index.ts` BrowserWindow constructor literal contains `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
    - `src/main/index.ts` CSP `connect-src` literal contains `http://127.0.0.1:11434`, `https://api.anthropic.com`, `https://api.openai.com`, `https://generativelanguage.googleapis.com`
    - `src/main/index.ts` references `RunAsNode` and `EnableNodeOptionsEnvironmentVariable` in a Fuses configuration block
    - `src/preload/index.ts` `exposeInMainWorld` argument is the literal `'aria'`
    - `src/shared/ipc-contract.ts` exports `CHANNELS`, `AriaApi`, `AskRequest`, `AskResponse`, `RoutingLogEntry`, `OllamaStatus`, `DiagnosticsStatus`
    - `grep -v '^//' src/preload/index.ts | grep -c "require\\b"` returns `0`
  </acceptance_criteria>
  <done>Secure main process up; preload bridge exposes typed `window.aria`; IPC channel constants are the single source-of-truth; pino redacts PII at sink; logs land under userData; CSP locks renderer down; Electron Fuses applied.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Renderer shell (tokens, side nav, Briefing + Approvals screens) + Playwright smoke E2E</name>
  <files>src/renderer/index.html, src/renderer/main.tsx, src/renderer/app/App.tsx, src/renderer/app/routes.tsx, src/renderer/app/theme/tokens.ts, src/renderer/app/theme/globals.css, src/renderer/components/SideNav.tsx, src/renderer/features/briefing/BriefingScreen.tsx, src/renderer/features/approvals/ApprovalsPlaceholder.tsx, tests/e2e/launch.spec.ts</files>
  <read_first>
    - .planning/phases/01-foundation/01-CONTEXT.md (D-11 single window + side nav; D-12 briefing is "Aria is alive" status screen; D-13 token set; D-14 Windows-first)
    - src/shared/ipc-contract.ts (created task 1)
    - src/preload/index.ts (created task 1 — defines `window.aria`)
  </read_first>
  <behavior>
    - Dev build launches a single window 1280×800 with a left side nav listing three items: "Briefing", "Approvals", "Settings"
    - Default route is `/briefing` and shows the literal heading "Aria is alive"
    - Approvals route shows literal text "Approvals queue — coming in Phase 3"
    - Settings route renders an empty placeholder shell (Plan 03 owns the full content) — a single `<h1>Settings</h1>` is sufficient for plan 01b
    - Theme tokens from `tokens.ts` are surfaced as CSS variables in `:root` and `:root[data-theme="dark"]` via `globals.css`
    - Playwright `_electron` smoke test launches the app, asserts window title is "Aria", and the three nav items are visible
  </behavior>
  <action>
    Overwrite the stub `src/renderer/app/theme/tokens.ts` (created in plan 01a) with the real D-13 token set: neutral palette (gray-50..gray-950), one accent (use `#5b8def` indigo; document choice in top-of-file comment), type scale (xs/sm/base/lg/xl/2xl/3xl px), radii (sm/md/lg/xl), spacing (xs/sm/md/lg/xl). Export both `tokens.light` and `tokens.dark`.

    Replace `src/renderer/app/theme/globals.css` to contain `@tailwind base; @tailwind components; @tailwind utilities;` plus `:root` and `@media (prefers-color-scheme: dark) :root` blocks emitting CSS variables for every token. Import it from `main.tsx`.

    Create `src/renderer/components/SideNav.tsx` rendering nav links for the three sections using React Router 6 `NavLink`. Active link uses accent color.

    Create `src/renderer/app/routes.tsx` exporting `<Routes>` with three Route entries: `/briefing` → `<BriefingScreen/>`, `/approvals` → `<ApprovalsPlaceholder/>`, `/settings/*` → a minimal placeholder `<h1>Settings</h1>` (Plan 03 replaces this with the real SettingsScreen.tsx). Default redirect from `/` to `/briefing`.

    Create `src/renderer/app/App.tsx` wrapping `<MemoryRouter>` + flex layout: `<SideNav/>` left fixed-width, `<main>` right scrollable.

    Create `src/renderer/features/briefing/BriefingScreen.tsx` rendering `<h1>Aria is alive</h1>` plus a `<p>` describing it as the Phase 1 placeholder.

    Create `src/renderer/features/approvals/ApprovalsPlaceholder.tsx` rendering the exact string `"Approvals queue — coming in Phase 3"`.

    Create `src/renderer/main.tsx` mounting `<App/>` into `#root` and asserting `window.aria` is present (`if (!window.aria) console.error('Preload bridge missing — aborting');`).

    Create `src/renderer/index.html` with `<div id="root"></div>`, `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'">` (defense-in-depth alongside main-process CSP).

    Create `tests/e2e/launch.spec.ts` using `_electron` to launch from `out/main/index.js`; wait for window; assert title === "Aria"; assert nav items "Briefing" / "Approvals" / "Settings" visible; assert `/briefing` heading is "Aria is alive". Run `npm run build` before the test (document in `playwright.config.ts` globalSetup or in CI).
  </action>
  <verify>
    <automated>npm run build && npm run test:e2e -- tests/e2e/launch.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - `npm run build` exits 0 and produces `out/main/index.js`, `out/preload/index.js`, `out/renderer/index.html`
    - `npm run test:e2e -- tests/e2e/launch.spec.ts` passes
    - `src/renderer/features/briefing/BriefingScreen.tsx` contains literal string `"Aria is alive"`
    - `src/renderer/features/approvals/ApprovalsPlaceholder.tsx` contains literal string `"coming in Phase 3"`
    - `src/renderer/app/theme/tokens.ts` exports both `tokens.light` and `tokens.dark`
  </acceptance_criteria>
  <done>Single-window app with three-section side nav running on Windows 11; design tokens are the single source-of-truth for palette/type/radii/spacing; e2e smoke test exercises the full main+preload+renderer stack. Settings screen is a minimal placeholder that Plan 03 populates.</done>
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
| T-01-01b-01 | Elevation of Privilege | BrowserWindow webPreferences | mitigate (HIGH) | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`; preload via contextBridge only; CSP locks `script-src` to `'self'` and `connect-src` to Ollama localhost + the three frontier API origins |
| T-01-01b-02 | Elevation of Privilege | `RunAsNode` / `NODE_OPTIONS` env exploits | mitigate (HIGH) | Electron Fuses disable both at build time (RESOLVED Open Question 6) |
| T-01-01b-03 | Information Disclosure | pino log files in userData | mitigate (HIGH) | `redactObject` runs on every `formatters.log` call; default patterns cover email/phone/$$/SSN; covered by `redact.spec.ts` |
| T-01-01b-04 | Tampering | Renderer imports from `electron` to escape sandbox | mitigate (MEDIUM) | Grep gate on renderer source forbids `from 'electron'` imports; preload bridge is the only typed surface |
| T-01-01b-05 | Information Disclosure | CSP `connect-src` wildcards | mitigate (MEDIUM) | Hard allowlist of four origins; future hosts added per-phase via explicit grep-verified entry |
</threat_model>

<verification>
- Both task `<automated>` commands pass on Windows 11 dev box
- `npm run dev` opens a single window with three nav items; `/briefing` shows "Aria is alive"
- `out/renderer/index.html` exists after `npm run build`
- `grep -rc "from 'electron'" src/renderer || true` returns 0 (renderer never imports from electron)
</verification>

<success_criteria>
Plan 01b satisfies Phase-1 ROADMAP success criterion #1 (working app window). Other success criteria are completed by Plans 02 (DB + backup + restore), 03 (frontier key in keychain + Ollama warning + Settings sections), and 04 (routing decision logged).
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation/01-01b-SUMMARY.md` describing:
- Resolved `app.getPath('userData')` value on the dev machine (logged at first launch)
- Confirmation that `contextIsolation`/`sandbox`/`nodeIntegration` literal strings match the threat-model
- Confirmation that Electron Fuses were applied and `RunAsNode` is disabled
- Any deviations from the original plan with rationale
</output>
