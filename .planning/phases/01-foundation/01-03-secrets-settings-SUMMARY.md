---
phase: 01-foundation
plan: 03
subsystem: secrets-and-settings
tags: [safe-storage, dpapi, ollama, settings, casa, ipc-wiring]
requires:
  - phase: 01-foundation
    plan: 01b
  - phase: 01-foundation
    plan: 02
provides:
  - safeStorage-backed frontier-key secrets layer (set/get/has/clear + active provider)
  - Ollama probe + DIAGNOSTICS_STATUS aggregator
  - Settings UI composite (Status, Frontier key, Local model, Backup & restore, Diagnostics placeholder)
  - registerHandlers wiring of all Phase-1 IPC modules (Onboarding, Backup, Secrets, Ollama)
  - Google CASA Tier 2 intake document (D-15)
affects:
  - src/main/ipc/index.ts (consolidated wiring; ASK_ARIA + DIAGNOSTICS_ROUTING_LOG remain stubs for Plan 04)
  - src/main/index.ts (now delegates all IPC wiring to registerHandlers)
  - src/renderer/app/routes.tsx (mounts SettingsScreen in place of Plan 01b placeholder)
tech-stack:
  added:
    - Electron safeStorage encryptString/decryptString (DPAPI on Windows)
    - AbortSignal.timeout (Node 20) for Ollama probe
  patterns:
    - per-test vi.doMock('electron') to inject app/safeStorage stubs
    - composite Settings shell with nested react-router routes
key-files:
  created:
    - src/main/secrets/safeStorage.ts
    - src/main/ipc/secrets.ts
    - src/main/ipc/ollama.ts
    - src/main/llm/ollamaProbe.ts
    - src/renderer/features/settings/FrontierKeySection.tsx
    - src/renderer/features/settings/OllamaSection.tsx
    - src/renderer/features/settings/StatusPanel.tsx
    - src/renderer/features/settings/SettingsScreen.tsx
    - tests/unit/main/secrets/safeStorage.spec.ts
    - tests/unit/main/ipc/secrets.spec.ts
    - tests/unit/main/ipc/ollama.spec.ts
    - tests/unit/main/llm/ollamaProbe.spec.ts
    - .planning/phases/01-foundation/01-03-CASA-INTAKE.md
    - .planning/phases/01-foundation/deferred-items.md
  modified:
    - src/main/ipc/index.ts (now wires real handlers + only stubs 2 channels)
    - src/main/index.ts (delegates to registerHandlers)
    - src/renderer/app/routes.tsx (mounts SettingsScreen)
    - tests/unit/main/ipc/index.spec.ts (updated to reflect new wiring)
decisions:
  - "safeStorage refuses (not silently falls back) when Linux backend is basic_text — surfacing the failure to the UI is correct per D-09"
  - "The renderer is never given a path to read the raw key back; secretsHasFrontierKey returns only a boolean"
  - "registerHandlers now owns all Phase-1 wiring; src/main/index.ts no longer double-registers onboarding/backup"
  - "CASA intake filed as `deferred` with explicit <TODO> placeholders rather than invented data; revisit date set within 2 weeks"
metrics:
  duration: ~45min
  completed: 2026-05-16
---

# Phase 1 Plan 03: Secrets, Settings & CASA Intake Summary

One-liner: safeStorage-backed frontier-key layer (DPAPI-encrypted, never plaintext on disk), Ollama localhost probe with timeout, composite Settings UI mounting all four Phase-1 sections, consolidated registerHandlers wiring, and a deferred Google CASA Tier 2 intake doc that starts the multi-week clock for `gmail.send` (Phase 3).

## What shipped

### Task 1 — safeStorage secrets layer + IPC
- `src/main/secrets/safeStorage.ts` exports `setFrontierKey`, `getFrontierKey`, `hasFrontierKey`, `clearFrontierKey`, `getActiveProvider`, `setActiveProvider`, `SafeStorageUnavailableError`.
- Hard gates: `app.isReady()` AND `safeStorage.isEncryptionAvailable()` AND backend ≠ `'basic_text'`.
- On-disk shape `{ v: 1, providers: { anthropic?: <b64>, openai?: <b64>, google?: <b64> }, activeProvider }`, atomic `.tmp` + rename write.
- `src/main/ipc/secrets.ts` registers all five `SECRETS_*` channels. Logs only `{ provider }`, never the raw key.
- Unit tests (10 cases across the two spec files) cover: round-trip, no-plaintext-on-disk, not-ready / not-available / basic_text refusal, no-key-for-provider, clearing the active provider, bad-request shape.

### Task 2 — Ollama probe + Settings UI + registerHandlers
- `src/main/llm/ollamaProbe.ts`: parallel `GET /api/version` + `GET /api/tags` with `AbortSignal.timeout(2000)`. Never throws — maps ECONNREFUSED → `unreachable`, AbortError → `timeout`, non-2xx → `unreachable`. 4 unit tests, all branches covered.
- `src/main/ipc/ollama.ts`: `OLLAMA_STATUS` returns the probe; `DIAGNOSTICS_STATUS` aggregates ollama + active provider + key presence + `mode` (HYBRID iff ollama reachable AND a frontier key is configured for the active provider, else LOCAL_ONLY) + `dataDir`. 4 unit tests.
- Settings UI sections under `src/renderer/features/settings/`:
  - `FrontierKeySection.tsx` — provider radio (anthropic / openai / google), `type="password"` input, Save / Clear; clears the key string from React state immediately on successful save; surfaces the literal basic_text warning string when the main process refuses to store.
  - `OllamaSection.tsx` — 10 s poll; reachable badge + version + model count; on unreachable, renders the literal text `"Install Ollama to enable LOCAL routing"` with anchor href `https://ollama.com/download/windows`.
  - `StatusPanel.tsx` — 10 s poll of `diagnosticsStatus`; renders Ollama / Frontier / Mode / Data directory rows + the LOCAL-only banner `"Frontier disabled — add an API key in Settings."` when no frontier key is configured.
  - `SettingsScreen.tsx` — composite with nested react-router routes (`status`, `frontier-key`, `ollama`, `onboarding` → `<BackupRestoreSection/>` from Plan 02, `diagnostics` placeholder for Plan 04). Default `/settings` → `/settings/status`.
- `src/main/ipc/index.ts` rewritten: `registerHandlers` now invokes `registerOnboardingHandlers`, `registerBackupHandlers`, `registerSecretsHandlers`, `registerOllamaHandlers` in order; only `ASK_ARIA` and `DIAGNOSTICS_ROUTING_LOG` remain as `NOT_IMPLEMENTED` stubs (Plan 04 territory).
- `src/main/index.ts` simplified: dropped the duplicate onboarding/backup wiring; bootstrap now does `registerHandlers(ipcMain, { logger, dataDir, dbHolder })` once.

### Task 3 — CASA intake
- `.planning/phases/01-foundation/01-03-CASA-INTAKE.md` filed at status `deferred`. Captures the Aria data-handling narrative verbatim for the CASA submission, lists requested scopes by phase (gmail.readonly + calendar = sensitive-scope review; gmail.send = restricted / CASA Tier 2), and flags every field requiring live GCP Console state or commercial-lab quotes with explicit `<TODO: …>` placeholders. **No legal / security data was invented.** Action items for the user are enumerated at the bottom of the doc.

## Acceptance grep summary

| Check | Result |
|---|---|
| `isEncryptionAvailable` in safeStorage.ts | 2 ≥ 1 |
| `basic_text` in safeStorage.ts | 5 ≥ 1 |
| `safeStorage.encryptString` in safeStorage.ts | 2 ≥ 1 |
| `logger.(info\|debug).*key` lines (must be 0) | 0 |
| `127.0.0.1:11434` in ollamaProbe.ts | 2 ≥ 1 |
| `AbortSignal` in ollamaProbe.ts | 2 ≥ 1 |
| `ollama.com/download/windows` in OllamaSection.tsx | 1 ≥ 1 |
| `Frontier disabled` in StatusPanel.tsx | 2 ≥ 1 |
| `type="password"` in FrontierKeySection.tsx | 1 ≥ 1 |
| `register(Onboarding\|Backup\|Secrets\|Ollama)Handlers` in src/main/ipc/index.ts | 12 (well above 4 — counts include import + invocation + skipChannels) |
| SettingsScreen imports BackupRestoreSection | yes |

## Verification

- `npx vitest run --project=main tests/unit/main/secrets tests/unit/main/ipc tests/unit/main/llm` → **22 passed / 22**
- `npm run typecheck` → clean (no errors against either tsconfig)
- Electron version still pinned to `41.6.1` exact (per debug session `sqlcipher-electron-42-abi`)

### Manual verification (deferred)
- Manual `grep -r "sk-ant-" <userData>/` after a real save: **deferred** — requires running the packaged app. The architectural guarantee (encryptString → base64 → `secrets.json`) is verified at the unit level by `safeStorage.spec.ts > writes only the encrypted blob to secrets.json (no plaintext key)`.
- `safeStorage.getSelectedStorageBackend()` output on the dev machine: **not captured at the bench** — Windows 11 will report `'dpapi'`. Manual verification can be added when first packaging in Phase 8.
- Ollama reachability during dev: **not probed at the bench** (unit tests stub fetch globally).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 / Rule 3 — Plan-mandated refactor breaks pre-existing test]**
- **Found during:** Task 2 (registerHandlers rewrite)
- **Issue:** `tests/unit/main/ipc/index.spec.ts` previously asserted "every CHANNELS entry resolves to NOT_IMPLEMENTED". That contract changes with Plan 03 (4 of 6 handler groups are now real handlers).
- **Fix:** Rewrote the test to reflect the new wiring: still requires exactly one handler per CHANNELS entry, but now asserts that ASK_ARIA + DIAGNOSTICS_ROUTING_LOG are the only NOT_IMPLEMENTED stubs and that the secrets channels are wired to real round-trip behavior.
- **Files modified:** `tests/unit/main/ipc/index.spec.ts`
- **Commit:** `feat(01-03): Ollama probe + Settings UI composite + registerHandlers wiring (Task 2)`

**2. [Rule 1 — Plan-mandated refactor in main/index.ts]**
- **Found during:** Task 2
- **Issue:** Plan 02 wired `registerOnboardingHandlers` + `registerBackupHandlers` directly from `src/main/index.ts` with a skipChannels list. Plan 03 explicitly states `registerHandlers` now owns all wiring.
- **Fix:** Removed the duplicate wiring from `src/main/index.ts`; bootstrap now calls `registerHandlers(ipcMain, { logger, dataDir, dbHolder })` once. No skipChannels needed.
- **Commit:** Same as #1.

### Authentication gates
None.

### Deferred Issues

- **Pre-existing native-module ABI mismatch in `tests/unit/main/db/`**: 7 tests in `backup-restore.spec.ts` + `migrations.spec.ts` fail with `NODE_MODULE_VERSION 145 vs 141` for `better-sqlite3-multiple-ciphers`. This is the documented SQLCipher-Electron-ABI blocker tracked at `.planning/debug/sqlcipher-electron-42-abi.md` — NOT in Plan 03 scope. Logged to `.planning/phases/01-foundation/deferred-items.md`.

### Task 3 CASA-intake placeholders surfaced to user

The CASA intake doc contains explicit `<TODO: …>` placeholders the user must fill before submission:

| Section | TODO |
|---|---|
| §1 GCP project ID | create project; record final ID |
| §1 OAuth client ID | create Desktop OAuth client |
| §2 secondary / legal / IR contacts | optional; user to decide |
| §3 gmail.modify scope | decide whether Phase 3 needs it |
| §5 source-code repo URL + update channel | confirm |
| §6 privacy policy / ToS / homepage URLs | publish before consent screen verification |
| §6 demo video | record once Phase 3 ships |
| §7 lab selection, quote date, start date, cost estimate | request quotes from CASA-authorized labs |
| §8 revisit date | set explicit revisit date |

These are explicitly **not** invented per the orchestrator instruction. The CASA intake task is `human-action` and the user must complete these fields off-band.

## Known Stubs

- `<DiagnosticsPlaceholder/>` in `SettingsScreen.tsx` for the `/settings/diagnostics` route. This is intentional — Plan 04 (wave 5) replaces it with `<DiagnosticsSection/>` showing the routing log. Documented in the placeholder body.
- `ASK_ARIA` and `DIAGNOSTICS_ROUTING_LOG` channels still return `{ error: 'NOT_IMPLEMENTED' }` via the registry's stub branch. Intentional — Plan 04 owns these.

## Self-Check: PASSED

- `[FOUND] src/main/secrets/safeStorage.ts`
- `[FOUND] src/main/ipc/secrets.ts`
- `[FOUND] src/main/llm/ollamaProbe.ts`
- `[FOUND] src/main/ipc/ollama.ts`
- `[FOUND] src/main/ipc/index.ts` (modified)
- `[FOUND] src/renderer/features/settings/FrontierKeySection.tsx`
- `[FOUND] src/renderer/features/settings/OllamaSection.tsx`
- `[FOUND] src/renderer/features/settings/StatusPanel.tsx`
- `[FOUND] src/renderer/features/settings/SettingsScreen.tsx`
- `[FOUND] tests/unit/main/secrets/safeStorage.spec.ts`
- `[FOUND] tests/unit/main/ipc/secrets.spec.ts`
- `[FOUND] tests/unit/main/ipc/ollama.spec.ts`
- `[FOUND] tests/unit/main/llm/ollamaProbe.spec.ts`
- `[FOUND] .planning/phases/01-foundation/01-03-CASA-INTAKE.md`
- `[FOUND] commit af2a29d (Task 1)`
- `[FOUND] commit for Task 2`
- `[FOUND] commit 65bd998 (Task 3 CASA intake)`
