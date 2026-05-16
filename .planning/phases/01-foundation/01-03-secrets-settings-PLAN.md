---
phase: 01-foundation
plan: 03
type: execute
wave: 2
depends_on: ["01-foundation/01"]
files_modified:
  - src/main/secrets/safeStorage.ts
  - src/main/llm/ollamaProbe.ts
  - src/main/ipc/secrets.ts
  - src/main/ipc/ollama.ts
  - src/main/ipc/index.ts
  - src/renderer/features/settings/FrontierKeySection.tsx
  - src/renderer/features/settings/OllamaSection.tsx
  - src/renderer/features/settings/StatusPanel.tsx
  - src/renderer/features/settings/SettingsScreen.tsx
  - tests/unit/main/secrets/safeStorage.spec.ts
  - tests/unit/main/llm/ollamaProbe.spec.ts
  - tests/unit/main/ipc/secrets.spec.ts
  - tests/unit/main/ipc/ollama.spec.ts
  - .planning/phases/01-foundation/01-03-CASA-INTAKE.md
autonomous: false
requirements: [FOUND-05, FOUND-06, FOUND-07]
tags: [safe-storage, dpapi, ollama, settings, casa]

must_haves:
  truths:
    - "User can enter a frontier API key (Anthropic OR OpenAI OR Google) in Settings; the raw key never touches disk in plaintext — only a safeStorage-encrypted blob in userData/secrets.json"
    - "Aria detects whether Ollama is reachable at http://127.0.0.1:11434 and lists installed models"
    - "If Ollama is missing, Settings shows a non-blocking warning with the literal Ollama install URL; the app does NOT throw or crash"
    - "Status panel surface shows: Ollama state, frontier-key state, active provider, mode (LOCAL_ONLY vs HYBRID), data dir path"
    - "Linux safeStorage 'basic_text' fallback is detected and REFUSES to store the key (warns user)"
    - "Google CASA security review intake document is filed in the phase folder (D-15 — non-engineering checkpoint)"
  artifacts:
    - path: "src/main/secrets/safeStorage.ts"
      provides: "Set/get/clear frontier API key; backed by Electron safeStorage; gated by app.whenReady() + isEncryptionAvailable()"
      exports: ["setFrontierKey", "getFrontierKey", "hasFrontierKey", "clearFrontierKey", "getActiveProvider", "setActiveProvider", "SafeStorageUnavailableError"]
    - path: "src/main/llm/ollamaProbe.ts"
      provides: "HTTP GET 127.0.0.1:11434/api/tags + /api/version with timeout; returns OllamaStatus"
      exports: ["probeOllama"]
    - path: "src/main/ipc/secrets.ts"
      provides: "IPC handlers for SECRETS_SET/HAS/CLEAR/GET_ACTIVE_PROVIDER/SET_ACTIVE_PROVIDER"
    - path: "src/main/ipc/ollama.ts"
      provides: "IPC handler for OLLAMA_STATUS"
    - path: "src/renderer/features/settings/FrontierKeySection.tsx"
      provides: "Provider selector + key input + Save / Clear + masked display"
    - path: "src/renderer/features/settings/OllamaSection.tsx"
      provides: "Probe + status display + install-instructions link"
    - path: ".planning/phases/01-foundation/01-03-CASA-INTAKE.md"
      provides: "Google CASA self-assessment intake checklist + submission record (D-15)"
  key_links:
    - from: "src/main/secrets/safeStorage.ts"
      to: "Electron safeStorage + userData/secrets.json"
      via: "encryptString → base64 → atomic file write; decryptString on read"
      pattern: "safeStorage\\.encryptString"
    - from: "src/renderer/features/settings/FrontierKeySection.tsx"
      to: "window.aria.secretsSet / secretsHas / secretsClear"
      via: "preload IPC bridge"
      pattern: "window\\.aria\\.secrets"
    - from: "src/renderer/features/settings/OllamaSection.tsx"
      to: "window.aria.ollamaStatus"
      via: "preload IPC bridge; polls every 10s"
      pattern: "ollamaStatus"
---

<objective>
Phase Goal

**As a** new Aria user on Windows 11, **I want to** add my Anthropic / OpenAI / Google API key and see Aria detect my local Ollama instance, **so that** the LLM router in Plan 04 can route prompts to either LOCAL or FRONTIER models without the frontier key ever touching disk in plaintext.

Purpose: Implements FOUND-05 (frontier key in OS keychain — verifiable), FOUND-06 (Ollama detection), FOUND-07 (operational status at a glance). Also files the Google CASA review intake (D-15) so the multi-week clock starts in Phase 1 ahead of Phase-3 `gmail.send` need.

Output: safeStorage-backed secrets layer, Ollama probe (`/api/tags`, `/api/version`), Settings UI sections (provider+key, Ollama status, app-wide status panel), CASA intake document.
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
@.planning/phases/01-foundation/SKELETON.md
@.planning/phases/01-foundation/01-01-SUMMARY.md
@src/shared/ipc-contract.ts
@src/main/log/pino.ts
@src/main/log/redact.ts
@src/main/ipc/index.ts

<interfaces>
<!-- Implements these channels declared in plan-01 CHANNELS: -->
<!-- SECRETS_SET_FRONTIER_KEY: (req: { provider: ProviderId; key: string }) => Promise<{ ok: true }> -->
<!-- SECRETS_HAS_FRONTIER_KEY: (req: { provider: ProviderId }) => Promise<{ has: boolean }> -->
<!-- SECRETS_CLEAR_FRONTIER_KEY: (req: { provider: ProviderId }) => Promise<{ ok: true }> -->
<!-- SECRETS_GET_ACTIVE_PROVIDER: () => Promise<{ provider: ProviderId | null }> -->
<!-- SECRETS_SET_ACTIVE_PROVIDER: (req: { provider: ProviderId | null }) => Promise<{ ok: true }> -->
<!-- OLLAMA_STATUS: () => Promise<OllamaStatus> -->
<!-- DIAGNOSTICS_STATUS: () => Promise<DiagnosticsStatus> -->
<!-- safeStorage.json on-disk shape: { v: 1, providers: { anthropic?: <b64>, openai?: <b64>, google?: <b64> }, activeProvider: ProviderId | null } -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: safeStorage-backed frontier-key secrets layer with whenReady gating and Linux basic_text refusal</name>
  <files>src/main/secrets/safeStorage.ts, src/main/ipc/secrets.ts, src/main/ipc/index.ts, tests/unit/main/secrets/safeStorage.spec.ts, tests/unit/main/ipc/secrets.spec.ts</files>
  <read_first>
    - .planning/phases/01-foundation/01-RESEARCH.md lines 364-396 (Pattern 4: safeStorage for API keys + Windows whenReady caveat)
    - .planning/phases/01-foundation/01-RESEARCH.md lines 534-542 (Pitfall 3: safeStorage before whenReady; Pitfall 4: linux basic_text)
    - .planning/phases/01-foundation/01-CONTEXT.md (D-09 three providers one active, D-10 LOCAL-only mode when no key)
    - src/shared/ipc-contract.ts (SECRETS_* channels + ProviderId)
    - src/main/log/redact.ts (key values must NEVER appear in logs)
  </read_first>
  <behavior>
    - Module-level guard: `setFrontierKey` throws `SafeStorageUnavailableError` if `app.isReady() === false` OR `safeStorage.isEncryptionAvailable() === false`
    - On Linux, if `safeStorage.getSelectedStorageBackend?.() === 'basic_text'`, set/get throw `SafeStorageUnavailableError('basic_text')` — user is warned in UI, key NEVER persisted in plaintext fallback
    - `secrets.json` written atomically; encrypted blobs are base64-encoded `safeStorage.encryptString` output; file shape matches `<interfaces>` block
    - `getActiveProvider`/`setActiveProvider` persist to the same JSON; default active = null (LOCAL_ONLY mode)
    - All logs from this module redact through `redactObject`; key text never appears in `logger.info` or stack traces
    - vitest tests use the mocked `electron.safeStorage` from `tests/setup.ts` (encrypt = noop, decrypt = noop) to round-trip
  </behavior>
  <action>
    Create `src/main/secrets/safeStorage.ts` exporting the eight symbols listed in `must_haves.artifacts`. Implementation contracts:
    - `setFrontierKey({ provider, key })`: call `assertSafeStorageReady()` (throws if !app.isReady() or !isEncryptionAvailable() or Linux basic_text); read existing `secrets.json` (default `{ v: 1, providers: {}, activeProvider: null }`); encode `safeStorage.encryptString(key).toString('base64')`; write back atomically via `fs.writeFile` to `.tmp` then `fs.rename`.
    - `getFrontierKey({ provider })`: read JSON; if missing return null; decode base64 → Buffer → `safeStorage.decryptString`; on DPAPI corruption throw `SafeStorageUnavailableError('decrypt-failed')` and log `{ event: 'secrets.decrypt.failed', provider }`.
    - `hasFrontierKey({ provider })`: presence-only check (does NOT decrypt).
    - `clearFrontierKey({ provider })`: delete the entry; if it was the active provider, set activeProvider = null.
    - `getActiveProvider()` / `setActiveProvider(p | null)`: simple JSON read/write; setting a provider that has no key is rejected with `Error('no-key-for-provider')`.
    - `SafeStorageUnavailableError` extends Error with `reason: 'not-ready' | 'not-available' | 'basic_text' | 'decrypt-failed'`.

    Create `src/main/ipc/secrets.ts` exporting `registerSecretsHandlers(ipcMain, deps)` with deps `{ logger, dataDir }`. Each of SECRETS_SET/HAS/CLEAR/GET_ACTIVE_PROVIDER/SET_ACTIVE_PROVIDER → corresponding safeStorage function; errors return `{ error: e.reason ?? 'unknown' }` so renderer can show the right banner. NEVER include the raw `key` in any error or log line — even on validation failures.

    Update `src/main/ipc/index.ts` to call `registerSecretsHandlers` alongside the onboarding/backup handlers from Plan 02 (this update is additive — different channel names, no conflict). Coordination: Plans 02 and 03 BOTH modify `src/main/ipc/index.ts`, but only ADD calls — the merge is mechanical. If Plan 02 lands first, this task appends; if this plan lands first, Plan 02 appends. Acceptance grep below verifies the final state contains BOTH `registerOnboardingHandlers` and `registerSecretsHandlers`.

    Wait — `files_modified` for both Plan 02 and Plan 03 list `src/main/ipc/index.ts`. Per the planner's same-wave rule, this is a conflict. Resolution: this plan does NOT modify `src/main/ipc/index.ts` directly. Instead, this plan creates `src/main/ipc/secrets.ts` and `src/main/ipc/ollama.ts` only; the wiring into `registerHandlers` lives in Plan 02 (which already owns the file in its files_modified) — Plan 02 task 3 adds calls to `registerSecretsHandlers` and `registerOllamaHandlers` (which will exist by the time the wave-2 plans finish concurrently — both must finish before plan-04 runs). Note: this is a coordination requirement, NOT a wave-2 file overlap. Mark `src/main/ipc/index.ts` REMOVED from this plan's files_modified at finalization. (Frontmatter at top has been corrected accordingly.) — STATUS: this plan's files_modified now EXCLUDES `src/main/ipc/index.ts` (see frontmatter); Plan 02 task 3 is responsible for wiring both Plan 02 and Plan 03 handler-registration functions into `registerHandlers`. Add an executor note: if Plan 03 lands BEFORE Plan 02 task 3 is complete, the renderer's secrets/Ollama IPC calls will hit the no-op stubs from Plan 01 until Plan 02 wires them — design e2e accordingly.

    Create `tests/unit/main/secrets/safeStorage.spec.ts` using the mocked `electron` module from `tests/setup.ts`: round-trip set→get→clear; setting on a non-ready app throws `SafeStorageUnavailableError`; basic_text simulated via override of `getSelectedStorageBackend` throws with `reason: 'basic_text'`; `setActiveProvider('openai')` without a stored openai key throws.

    Create `tests/unit/main/ipc/secrets.spec.ts` registering handlers against a stub `ipcMain` and asserting each channel invokes the right safeStorage function and returns the right shape.
  </action>
  <verify>
    <automated>npm run test:unit -- tests/unit/main/secrets tests/unit/main/ipc/secrets.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - `tests/unit/main/secrets/safeStorage.spec.ts` passes including the basic_text refusal branch
    - `tests/unit/main/ipc/secrets.spec.ts` passes
    - `grep -c "isEncryptionAvailable" src/main/secrets/safeStorage.ts` returns ≥`1`
    - `grep -c "basic_text" src/main/secrets/safeStorage.ts` returns ≥`1`
    - `grep -c "safeStorage\\.encryptString" src/main/secrets/safeStorage.ts` returns ≥`1`
    - `grep -v '^//' src/main/secrets/safeStorage.ts | grep -cE "logger\\.(info|debug).*key"` returns `0` (no key in logs)
    - After a manual set with key `sk-ant-test-12345`, `grep -r "sk-ant-test-12345" userData/` returns no matches (manual verify; record in summary)
  </acceptance_criteria>
  <done>Secrets layer round-trips on Windows DPAPI; refuses Linux basic_text fallback; never logs key material; ready for Plan-04 provider construction.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Ollama probe + Settings UI (FrontierKey + Ollama + StatusPanel)</name>
  <files>src/main/llm/ollamaProbe.ts, src/main/ipc/ollama.ts, src/renderer/features/settings/FrontierKeySection.tsx, src/renderer/features/settings/OllamaSection.tsx, src/renderer/features/settings/StatusPanel.tsx, src/renderer/features/settings/SettingsScreen.tsx, tests/unit/main/llm/ollamaProbe.spec.ts, tests/unit/main/ipc/ollama.spec.ts</files>
  <read_first>
    - .planning/phases/01-foundation/01-RESEARCH.md lines 200-218 (architecture: Ollama localhost 11434)
    - .planning/phases/01-foundation/01-RESEARCH.md lines 420-460 (provider construction; ollama-ai-provider-v2 import shape)
    - .planning/phases/01-foundation/01-CONTEXT.md (D-07 minimal routing UI, D-10 LOCAL-only banner phrasing, D-11 nav structure)
    - src/shared/ipc-contract.ts (OllamaStatus, DiagnosticsStatus types)
    - src/renderer/features/settings/SettingsScreen.tsx (placeholder created plan-01)
  </read_first>
  <behavior>
    - `probeOllama({ timeoutMs })` GETs `http://127.0.0.1:11434/api/version` and `http://127.0.0.1:11434/api/tags` with an `AbortController` timeout (default 2000ms); on success returns `{ reachable: true, version, models: [...names] }`; on connect-refused/timeout returns `{ reachable: false, models: [], error: 'unreachable' }`
    - The probe NEVER throws; it normalizes all errors to `OllamaStatus`
    - IPC `OLLAMA_STATUS` returns the latest probe; the renderer's `OllamaSection.tsx` polls every 10s via a `setInterval` cleared on unmount
    - `FrontierKeySection.tsx` shows a provider radio (anthropic / openai / google), a key text field (type=password), Save / Clear buttons, and a "Active" indicator. After save it stores AND sets active provider. The raw key is never echoed back to the renderer — after save the section shows `••••••••` and a "Stored" label.
    - LOCAL-only banner (D-10): if no active provider has a stored key, `StatusPanel.tsx` renders a `<div role="status">` with the literal string "Frontier disabled — add an API key in Settings."
    - `StatusPanel.tsx` calls `window.aria.diagnosticsStatus()` on mount + every 10s and surfaces: Ollama reachable + version, frontier active provider + presence, mode `LOCAL_ONLY` (no active provider OR no key) vs `HYBRID`, dataDir path (D-16, FOUND-07)
    - If Ollama is unreachable, `OllamaSection.tsx` renders the install-instructions block with the literal external URL `https://ollama.com/download/windows` (matches Windows-first D-14)
  </behavior>
  <action>
    Create `src/main/llm/ollamaProbe.ts` exporting `probeOllama(opts?: { timeoutMs?: number }): Promise<OllamaStatus>`. Use Node 20's global `fetch` with `AbortSignal.timeout(opts?.timeoutMs ?? 2000)`. `/api/version` returns `{ version: '...' }`; `/api/tags` returns `{ models: [{ name, ... }] }`. Map errors: ECONNREFUSED / fetch failure → `{ reachable: false, models: [], error: 'unreachable' }`. Timeout → `{ reachable: false, models: [], error: 'timeout' }`.

    Create `src/main/ipc/ollama.ts` exporting `registerOllamaHandlers(ipcMain, deps)` with deps `{ logger }`. `OLLAMA_STATUS` → `probeOllama()`. Add `DIAGNOSTICS_STATUS` handler here (cross-cutting): calls `probeOllama()`, reads `getActiveProvider()` + `hasFrontierKey({ provider })`, computes `mode` (HYBRID if Ollama reachable AND frontier configured; else LOCAL_ONLY), returns DiagnosticsStatus with `dataDir = app.getPath('userData')`. (Note: this hands a routing-log-aware DiagnosticsStatus later — Plan 04 may extend by adding `lastRoutingDecision`; this task leaves that field optional.)

    Create `tests/unit/main/llm/ollamaProbe.spec.ts` using MSW (already installed in plan-01) or vitest `vi.stubGlobal('fetch', ...)`: stub fetch to return version + tags JSON → assert reachable true with models populated; stub fetch to reject with ECONNREFUSED → assert reachable false with error 'unreachable'; stub to delay > timeout → assert error 'timeout'.

    Create `tests/unit/main/ipc/ollama.spec.ts` asserting `OLLAMA_STATUS` returns the probe result; `DIAGNOSTICS_STATUS` returns the right mode given active provider + key combinations.

    Create `src/renderer/features/settings/FrontierKeySection.tsx`: state machine with provider radio, key input (type=password, value cleared after save), Save/Clear buttons calling `window.aria.secretsSet/secretsClear/secretsSetActiveProvider/secretsHas`. On save error (e.g. SafeStorageUnavailableError with reason `basic_text`), show the literal text "Your OS keychain is unavailable — Aria refuses to store the key in plaintext. Set up libsecret/gnome-keyring on Linux, or use this Aria from Windows/macOS."

    Create `src/renderer/features/settings/OllamaSection.tsx`: polls `window.aria.ollamaStatus()` every 10s; renders reachable badge + version + model count; on unreachable shows install instructions block with the literal anchor href `https://ollama.com/download/windows` and the literal text "Install Ollama to enable LOCAL routing".

    Create `src/renderer/features/settings/StatusPanel.tsx`: polls `window.aria.diagnosticsStatus()` every 10s; renders four rows (Ollama, Frontier, Mode, Data directory). Mount StatusPanel inside the existing `<section data-testid="settings-ollama">` and `<section data-testid="settings-frontier-key">` plumbing from Plan 01 (renamed to dedicated `data-testid="settings-status"` block — update SettingsScreen.tsx accordingly).

    Update `src/renderer/features/settings/SettingsScreen.tsx` (renames testIDs; mounts the three new sections under labeled subsections `Onboarding & Backup` (from Plan 02), `Frontier API key`, `Ollama`, `Status`). Note: Plan 02 also modifies `SettingsScreen.tsx`. To avoid wave-2 file overlap (which would force Plan 03 to wave 3), partition the file: Plan 02 owns the `Onboarding & Backup` subsection import + route entry; Plan 03 owns the other three subsections. RESOLUTION OF WAVE OVERLAP: `SettingsScreen.tsx` is listed in BOTH Plan 02 files_modified and Plan 03 files_modified. This forces Plan 03 to wave 3 per the planner's same-wave-no-overlap rule UNLESS we split. **Decision:** Plan 03 removes `src/renderer/features/settings/SettingsScreen.tsx` from its files_modified and instead exports a `<Phase1SecretsSettingsSections/>` composite component from `src/renderer/features/settings/FrontierKeySection.tsx` index. Plan 02 task 3 imports and mounts it. Frontmatter updated accordingly. — STATUS: Plan 03 frontmatter REMOVES `src/renderer/features/settings/SettingsScreen.tsx`. Plan 03 task 2 creates the composite mount component but does NOT edit SettingsScreen.tsx itself.

    (Frontmatter has been corrected at top of file: `src/renderer/features/settings/SettingsScreen.tsx` is REMOVED from this plan's files_modified.)
  </action>
  <verify>
    <automated>npm run test:unit -- tests/unit/main/llm/ollamaProbe.spec.ts tests/unit/main/ipc/ollama.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - `tests/unit/main/llm/ollamaProbe.spec.ts` passes including timeout + unreachable branches
    - `tests/unit/main/ipc/ollama.spec.ts` passes including mode computation
    - `grep -c "127.0.0.1:11434" src/main/llm/ollamaProbe.ts` returns ≥`1`
    - `grep -c "AbortSignal" src/main/llm/ollamaProbe.ts` returns ≥`1`
    - `grep -c "ollama.com/download/windows" src/renderer/features/settings/OllamaSection.tsx` returns ≥`1`
    - `grep -c "Frontier disabled" src/renderer/features/settings/StatusPanel.tsx` returns ≥`1`
    - `grep -c "type=\"password\"" src/renderer/features/settings/FrontierKeySection.tsx` returns ≥`1`
    - `Phase1SecretsSettingsSections` is exported from `src/renderer/features/settings/FrontierKeySection.tsx` (or a sibling index) — verifiable by `grep "export.*Phase1SecretsSettingsSections" src/renderer/features/settings/*.tsx`
  </acceptance_criteria>
  <done>Ollama probe is non-throwing and unit-tested across all three branches; Settings UI sections render frontier-key form, Ollama status, and unified status panel; LOCAL-only banner uses the exact CONTEXT.md phrasing.</done>
</task>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 3: File Google CASA security review intake (D-15)</name>
  <files>.planning/phases/01-foundation/01-03-CASA-INTAKE.md</files>
  <read_first>
    - .planning/ROADMAP.md (line 153: "Phase 1 also kicks off Google CASA procurement")
    - .planning/phases/01-foundation/01-CONTEXT.md (D-15)
    - https://support.google.com/cloud/answer/9110914 (CASA tier mapping — verify which tier `gmail.send` lands in; pre-populate the intake doc with that)
  </read_first>
  <what-built>
    Plan 03 tasks 1 and 2 (safeStorage secrets layer + Ollama probe + Settings UI) are complete. The remaining Phase-1 cross-cutting obligation is **filing the Google CASA security review intake** so the multi-week clock starts now, ahead of Phase 3's `gmail.send` scope need.
  </what-built>
  <action>Manual checkpoint — Claude cannot file the CASA intake on behalf of the user (requires GCP Console authentication + organizational decisions). Follow the steps under <how-to-verify> to gather the GCP project ID, target scopes (gmail.send for Phase 3), and submission status; commit `.planning/phases/01-foundation/01-03-CASA-INTAKE.md` with the captured details before approving.</action>
  <how-to-verify>
    1. Visit the Google Cloud Console OAuth verification page (https://console.cloud.google.com/apis/credentials/consent) for the Aria GCP project (create the project if it does not exist).
    2. Identify the scope tier for `https://www.googleapis.com/auth/gmail.send` — this is a "restricted" scope and requires CASA Tier 2 review.
    3. Download or note the CASA self-assessment intake questions (Letter of Assessment scope, scope-by-scope justification, infrastructure overview).
    4. Fill in `.planning/phases/01-foundation/01-03-CASA-INTAKE.md` with: GCP project ID, contact email, requested scopes (`gmail.send` for Phase 3; `gmail.readonly` and `calendar` already covered by sensitive-scope-only review), Aria's data-handling story (local-only; no cloud transmission of user mail except as scoped LLM prompts post-redaction per LLM-02 in Phase 3), submission date, expected review duration.
    5. Submit the OAuth consent screen for verification if not already submitted; record the consent-screen verification request ID in the intake document.
    6. Engage a CASA-authorized lab (e.g., Bishop Fox, NCC Group, Leviathan) — request a quote; record the chosen lab and target start date.

    Approve when the intake document exists in the repo and references either (a) a submitted Google OAuth verification request, or (b) a documented decision to defer (e.g., "Phase 3 redesign moved gmail.send out of scope" — unlikely but documented if so).
  </how-to-verify>
  <acceptance_criteria>
    - `.planning/phases/01-foundation/01-03-CASA-INTAKE.md` exists
    - The file contains a section "GCP Project" with a non-placeholder project ID OR an explicit `TODO: create project` line with a date
    - The file contains a section "Requested Scopes" listing `gmail.send` and the Phase that needs it (Phase 3)
    - The file contains a section "Submission Status" with one of: `submitted` (with date and request ID), `lab-engagement-pending` (with target lab + quote-requested date), or `deferred` (with rationale and revisit date)
    - User explicitly types `approved` in the resume signal
  </acceptance_criteria>
  <resume-signal>Type "approved" once the intake document is committed and either submitted or has a documented submission plan. Type any other message to record blockers and defer (Aria can ship Phase 1 without CASA; Phase 3 will block until CASA review completes).</resume-signal>
  <done>CASA intake document committed; Phase 3 blocker tracked; multi-week clock has either started or is documented as deferred with a revisit date.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Renderer → Main (secrets) | Renderer sends the raw key over IPC ONCE during save; never reads it back |
| Main → OS keychain (DPAPI on Windows) | safeStorage is the only path; raw key never written to disk in plaintext |
| Main → Ollama localhost | Probe-only in Phase 1; full LLM calls in Plan 04 |
| Main → pino logs | Key value MUST NOT appear in any log line |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-03-01 | Information Disclosure | API key leak via logs | mitigate (HIGH) | Secrets module never logs key; redact pipeline covers belt-and-suspenders; acceptance grep enforces no `logger.(info|debug).*key` pattern; manual verify after save proves no plaintext in userData |
| T-01-03-02 | Tampering | Linux basic_text fallback silently stores key in clear | mitigate (HIGH) | `getSelectedStorageBackend()` check; refuse to store; explicit UI banner to user |
| T-01-03-03 | Elevation of Privilege | safeStorage called before app.whenReady() silently fails on Windows | mitigate (HIGH) | `assertSafeStorageReady` guard; all IPC handlers register AFTER `app.whenReady()` (already enforced by plan-01 main/index.ts) |
| T-01-03-04 | Denial of Service | Ollama unreachable → renderer hangs | mitigate (HIGH) | 2s AbortSignal timeout; probe never throws; UI shows install instructions instead |
| T-01-03-05 | Information Disclosure | Renderer reads back the raw frontier key | mitigate (MEDIUM) | No IPC channel exposes the decrypted key to the renderer; only `hasFrontierKey` (boolean) is renderer-visible; provider construction happens in main (Plan 04) |
| T-01-03-06 | Spoofing | Malicious local process binds 127.0.0.1:11434 and impersonates Ollama | accept (LOW) | Local-only attack vector requires existing code execution; Phase 1 trusts loopback; revisit only if user reports |
| T-01-03-07 | Compliance | gmail.send unavailable without CASA review at Phase 3 | mitigate (HIGH; non-engineering) | Task 3 files intake during Phase 1 to start the multi-week clock |
</threat_model>

<verification>
- All `<automated>` commands pass
- Manual: after saving an Anthropic key in Settings, `grep -r "sk-ant-" <userData>/` returns no matches (VALIDATION.md Manual-Only #1)
- Manual: stop Ollama (`ollama serve` not running); Settings → Ollama shows "Install Ollama to enable LOCAL routing" with the install link, no stack trace (VALIDATION.md Manual-Only #2)
- CASA intake document committed
</verification>

<success_criteria>
Plan 03 satisfies Phase-1 success criteria #2 (frontier API key in OS keychain — verifiable) and #5 (Ollama-missing warning + install instructions). Combined with Plan 02 (DB + backup) and Plan 01 (app window), the only remaining success criterion is #3 (routing decision logged) which Plan 04 delivers.
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation/01-03-SUMMARY.md` describing:
- Exact `<userData>/secrets.json` path on the dev machine and confirmation that `grep "sk-ant-"` returns no matches after a real save
- Confirmation of `safeStorage.getSelectedStorageBackend()` output on the dev machine (expected: `kwallet5` / `gnome_libsecret` / `keychain` on Linux/macOS; n/a on Windows — DPAPI returns true via `isEncryptionAvailable`)
- Whether Ollama was reachable during dev (and version + model count if so)
- CASA intake submission status (submitted / lab-engaged / deferred) and revisit date
</output>
