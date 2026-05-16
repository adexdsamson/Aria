---
phase: 01-foundation
plan: 01a
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
  - src/renderer/app/theme/globals.css
autonomous: true
requirements: [FOUND-01]
tags: [tooling, electron-vite, tailwind, vitest, playwright]

must_haves:
  truths:
    - "`npm install` succeeds on Windows 11 with all RESEARCH-pinned versions"
    - "`npm run typecheck` exits 0 against an empty `src/` (configs parse)"
    - "`npm run test:unit` exits 0 (zero tests collected; vitest config loads without error)"
    - "`tailwindcss@3.x` is installed (NOT v4)"
    - "`ollama-ai-provider-v2` is installed (NOT the deprecated `ollama-ai-provider`)"
  artifacts:
    - path: "package.json"
      provides: "Pinned Phase 1 dependency manifest"
      contains: "electron"
    - path: "electron.vite.config.ts"
      provides: "Main/preload/renderer build wiring (three entries)"
    - path: "tsconfig.json"
      provides: "Strict TS config for renderer"
    - path: "tsconfig.node.json"
      provides: "Strict TS config for main + preload"
    - path: "tailwind.config.ts"
      provides: "Tailwind 3.4 config; content scans src/renderer/**; references theme tokens"
    - path: "vitest.config.ts"
      provides: "Two projects: main (node env), renderer (jsdom)"
    - path: "playwright.config.ts"
      provides: "`_electron` launcher targeting dev build"
    - path: "tests/setup.ts"
      provides: "Shared fixtures: temp userData factory + mocked electron.safeStorage"
  key_links:
    - from: "package.json scripts"
      to: "electron-vite + vitest + playwright"
      via: "dev/build/test:unit/test:e2e/test/typecheck/postinstall scripts"
      pattern: "electron-vite"
    - from: "tailwind.config.ts"
      to: "src/renderer/app/theme/tokens.ts"
      via: "theme.extend imports the token module (created in plan 01b)"
      pattern: "tokens"
---

<objective>
Phase Goal

**As a** solo developer setting up the Aria repo on Windows 11, **I want to** install pinned dependencies and validate the build/test toolchain, **so that** plan 01b can begin coding the shell with confidence that every tool boots cleanly.

Purpose: Lock the RESEARCH-verified dependency matrix (electron 42, ai SDK 6, ollama-ai-provider-v2, tailwind 3.4, vitest 4, playwright 1.60, better-sqlite3-multiple-ciphers 12) and the three build/test configs the rest of Phase 1 depends on. This plan ships ONLY configuration — no source code, no IPC, no UI.

Output: `npm install` works; `npm run typecheck` and `npm run test:unit` exit 0 with empty `src/`; electron-vite three-target config, Tailwind 3.4 PostCSS pipeline, Vitest two-project config, Playwright `_electron` launcher all parse without error.
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
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Initialize repo, pin dependencies, write build/test configs</name>
  <files>package.json, package-lock.json, .gitignore, .npmrc, tsconfig.json, tsconfig.node.json, electron.vite.config.ts, tailwind.config.ts, postcss.config.js, src/renderer/app/theme/globals.css, vitest.config.ts, playwright.config.ts, tests/setup.ts</files>
  <read_first>
    - CLAUDE.md (Technology Stack — locked stack)
    - .planning/phases/01-foundation/01-RESEARCH.md lines 100-160 (Core dependency table + Installation block — RESEARCH overrides CLAUDE.md version pins where they differ: SDK 6 not 5, electron 42 not 33, ollama-ai-provider-v2 not ollama-ai-provider, pino 10, node-cron 4, p-queue 9, vitest 4, playwright 1.60)
    - .planning/phases/01-foundation/01-VALIDATION.md Wave 0 (installs vitest + @vitest/coverage-v8, playwright + @playwright/test, configs, tests/setup.ts)
  </read_first>
  <behavior>
    - `npm run dev` script invokes `electron-vite dev` (main/preload/renderer build targets)
    - `npm run typecheck` runs `tsc --noEmit` for renderer + main/preload tsconfigs and exits 0 with empty `src/`
    - `npm run test:unit` runs `vitest run` and exits 0 with zero tests collected
    - `npm run test:e2e` runs `playwright test` (will fail until plan 01b ships a build; documented for that plan)
    - Tailwind 3.4 + PostCSS pipeline parses `globals.css`
    - `electron.vite.config.ts` declares three entries: main → `src/main/index.ts`, preload → `src/preload/index.ts`, renderer → `src/renderer/index.html` (paths exist conceptually; created in plan 01b)
  </behavior>
  <action>
    Initialize repo with `npm init -y`. Install RESEARCH-verified versions exactly. Pin majors:
    - **Production deps:** `electron@^42`, `electron-vite@^5`, `react@^18`, `react-dom@^18`, `react-router-dom@^6`, `better-sqlite3-multiple-ciphers@^12`, `ai@^6`, `@ai-sdk/anthropic@^3`, `@ai-sdk/openai@^3`, `@ai-sdk/google@^3`, `ollama-ai-provider-v2@^3`, `zod@^4`, `@scure/bip39@^2`, `pino@^10`, `pino-roll@^4`, `node-cron@^4`, `p-queue@^9`, `@electron-toolkit/preload`.
    - **Dev deps:** `typescript@^5`, `vite@^5`, `@vitejs/plugin-react`, `tailwindcss@^3` (NOT 4 — per RESOLVED Open Question 5), `@electron/rebuild@^4`, `electron-builder@^26`, `vitest@^4`, `@vitest/coverage-v8`, `playwright@^1.60`, `@playwright/test`, `@types/react`, `@types/react-dom`, `@types/node`, `autoprefixer`, `postcss`, `jsdom`.

    Add npm scripts to `package.json`:
    - `dev` = `electron-vite dev`
    - `build` = `electron-vite build`
    - `start` = `electron-vite preview`
    - `test:unit` = `vitest run`
    - `test:e2e` = `playwright test`
    - `test` = `npm run test:unit && npm run test:e2e`
    - `typecheck` = `tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json`
    - `postinstall` = `electron-rebuild -f -w better-sqlite3-multiple-ciphers` (per RESEARCH Pitfall 2 — Windows ABI rebuild for plan 02 native dep)

    Create `electron.vite.config.ts` with three entries: main → `src/main/index.ts`, preload → `src/preload/index.ts`, renderer → `src/renderer/index.html`. Renderer plugin: `@vitejs/plugin-react`. Build targets: ES2022 for main/preload, ES2022 + DOM for renderer.

    Create `tsconfig.json` (renderer): target ES2022, lib `["ES2022","DOM","DOM.Iterable"]`, jsx `react-jsx`, strict true, moduleResolution `bundler`, paths `@shared/* → src/shared/*`, `@renderer/* → src/renderer/*`. Include `src/renderer/**/*`.

    Create `tsconfig.node.json` (main + preload + configs): target ES2022, module `ESNext`, moduleResolution `bundler`, strict true, types `["node","electron"]`, includes `src/main/**/*`, `src/preload/**/*`, `src/shared/**/*`, `electron.vite.config.ts`.

    Create `tailwind.config.ts` with content `["./src/renderer/**/*.{ts,tsx,html}"]`, darkMode `"media"` (system light/dark per D-13), and a `theme.extend` block that imports tokens via `import { tokens } from './src/renderer/app/theme/tokens'`. NOTE: `tokens.ts` is created by plan 01b — at install time the import will resolve to a placeholder OR the file will not yet exist; mitigate by guarding the require behind a `try/catch` or by shipping a TEMPORARY stub `src/renderer/app/theme/tokens.ts` exporting `{ tokens: { light: {}, dark: {} } }` as part of THIS task (tiny stub; plan 01b overwrites with real palette). Choose the stub approach so `tailwind.config.ts` resolves cleanly during plan 01a typecheck. **STUB**: ship `src/renderer/app/theme/tokens.ts` as an `export const tokens = { light: {}, dark: {} };` placeholder; plan 01b's Task 3 replaces it. Add this file to `files_modified`.

    Create `postcss.config.js` exporting `{ plugins: { tailwindcss: {}, autoprefixer: {} } }`.

    Create `src/renderer/app/theme/globals.css` containing only `@tailwind base; @tailwind components; @tailwind utilities;` (plan 01b extends with CSS custom properties).

    Create `vitest.config.ts` with two projects per VALIDATION Wave 0: project `main` env `node`, project `renderer` env `jsdom`. `setupFiles → ['tests/setup.ts']`. Coverage provider `v8`. `test.include` patterns scoped to each project's directories.

    Create `playwright.config.ts` per VALIDATION: `testDir: 'tests/e2e'`, retries 0 in CI, workers 1 (Electron single instance), reporter `list`. Document in a top-of-file comment that the `_electron` launcher target (`out/main/index.js`) is built by plan 01b.

    Create `tests/setup.ts` with the shared fixtures from VALIDATION Wave 0:
    - `createTempUserDataDir()` factory using `os.tmpdir()` + crypto random hex
    - `vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString('utf8'), getSelectedStorageBackend: () => 'keychain' }, app: { isReady: () => true, getPath: (k) => /* temp dir based on k */ } }))`
    Export the factory and re-export the mocked electron module so plan 02/03 tests can override per-test.

    Create `.gitignore` covering: `node_modules/`, `out/`, `dist/`, `*.log`, `.DS_Store`, `coverage/`, `test-results/`, `playwright-report/`, `userData/`, `*.ariabackup`, `.env`, `.env.*`.

    Create `.npmrc` with `auto-install-peers=true` to keep AI SDK 6 peer-dep resolution clean.
  </action>
  <verify>
    <automated>npm install && npm run typecheck && npm run test:unit</automated>
  </verify>
  <acceptance_criteria>
    - `npm install` exits 0; `node_modules/electron/package.json` version starts with `42.`
    - `node_modules/ai/package.json` version starts with `6.`
    - `node_modules/ollama-ai-provider-v2/package.json` exists; `node_modules/ollama-ai-provider/` does NOT
    - `node_modules/tailwindcss/package.json` version starts with `3.` (NOT `4.`)
    - `npm run typecheck` exits 0
    - `npm run test:unit` exits 0 (zero tests collected; vitest config loads without error)
    - `electron.vite.config.ts` contains three entries (`main`, `preload`, `renderer`)
    - `tailwind.config.ts` references the tokens module via import
    - `.gitignore` contains `node_modules/`, `userData/`, and `*.ariabackup`
    - `package.json` scripts include `postinstall` with `electron-rebuild -f -w better-sqlite3-multiple-ciphers`
  </acceptance_criteria>
  <done>Tooling baseline locked; vitest + playwright configs parse cleanly; Tailwind/PostCSS pipeline live; plan 01b can write source code against a known-good toolchain.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Local dev box → npm registry | Standard supply-chain trust; mitigated by lockfile + pinned majors |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-01a-01 | Tampering | Supply-chain malicious dependency | mitigate (MEDIUM) | `package-lock.json` committed; pinned majors via `^X`; future phases may add `npm audit` to CI |
| T-01-01a-02 | Denial of Service | Native rebuild fails on dev box without VS Build Tools | accept (LOW) | `postinstall` runs `electron-rebuild`; failure surfaces loudly as a dev-setup issue (documented in SKELETON.md) |
</threat_model>

<verification>
- `npm install`, `npm run typecheck`, `npm run test:unit` all exit 0 on Windows 11 dev box
- `npm ls electron ai ollama-ai-provider-v2 tailwindcss` shows the major-pinned versions
</verification>

<success_criteria>
Plan 01a establishes the toolchain. No Phase 1 ROADMAP success criteria are completed here — this is a setup precondition for plan 01b through plan 04.
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation/01-01a-SUMMARY.md` listing exact installed versions from `package-lock.json` for: electron, electron-vite, react, ai, @ai-sdk/anthropic, @ai-sdk/openai, @ai-sdk/google, ollama-ai-provider-v2, better-sqlite3-multiple-ciphers, pino, node-cron, p-queue, vitest, playwright, tailwindcss.
</output>
