---
phase: 15-audio-i-o-model-runtime
plan: "09"
subsystem: whisper-packaging-and-runtime-proof
tags: [voice, whisper, packaging, extraResources, binary, sidecar, ram-ceiling, e2e, ship-blocker-fix]
dependency_graph:
  requires:
    - Plan 15-02 (SttSidecarManager + resolveBinaryPath contract)
    - Plan 15-05 (IPC voice handlers)
    - Plan 15-06 (TTS + half-duplex gate)
    - Plan 15-07 (VoiceHUDBand + StatusDot UI)
    - Plan 15-08 (model download UI + onboarding voice step)
  provides:
    - package.json build.extraResources whisper-cli entries (win32 + darwin)
    - package.json build.mac.binaries signing entry
    - build/whisper/README.md procurement contract
    - tests/static/whisper-binary-packaging.spec.ts (D-02 + §Pitfall 2 guard, 8/8)
    - tests/e2e/packaged-launch.spec.ts (SC2 E2E scaffold, .skip pending packaged build)
    - .planning/phases/15-audio-i-o-model-runtime/15-RAM-CEILING.md (measurement template)
  affects:
    - Phase 15 SC2 (packaged launch no-ABI-crash) — proof pending packaged build on user's machine
    - Phase 15 RAM ceiling proof — OPEN pending 16 GB measurement
tech_stack:
  added: []
  patterns:
    - electron-builder extraResources per-platform binary staging (D-02)
    - build.mac.binaries for Gatekeeper-safe code-signing of sidecar (§Pitfall 2)
    - static guard reading package.json to lock packaging config invariants
    - Playwright _electron packaged-launch smoke scaffold (.skip until packaged build present)
key_files:
  created:
    - build/whisper/README.md
    - tests/static/whisper-binary-packaging.spec.ts
    - tests/e2e/packaged-launch.spec.ts
    - .planning/phases/15-audio-i-o-model-runtime/15-RAM-CEILING.md
  modified:
    - package.json (extraResources win32+darwin entries; build.mac.binaries)
decisions:
  - "D-02: whisper-cli ships via extraResources (NOT asarUnpack) — correct for plain executables, verified by static guard"
  - "§Pitfall 2: build.mac.binaries required for Gatekeeper-safe signing — electron-builder does not auto-sign extraResources executables"
  - "Windows-only staged path: macOS binary DEFERRED to CI (cmake -DWHISPER_METAL=ON + notarization); cannot build/sign on Windows dev machine"
  - "SC2 E2E scaffold as .skip: packaged-launch.spec.ts stays .skip until packaged build + binary are present; un-skip checklist in header"
  - "RAM ceiling: OPEN debt — measurement requires 16 GB machine; dev machine is 8 GB (confirmed swap territory)"
metrics:
  duration: "~20 minutes"
  completed: "2026-06-04"
  tasks_completed: 3
  tasks_total: 3
  files_created: 4
  files_modified: 1
---

# Phase 15 Plan 09: Whisper Binary Packaging + Runtime Proof Summary

Packaging config for the whisper-cli sidecar binary (per-platform extraResources, macOS mac.binaries code-signing entry), a static guard locking the config, a ship-blocker fix (whisper.dll omitted from win32 filter), the SC2 packaged-launch E2E scaffold (.skip), and the RAM ceiling measurement template. Windows binary staged and verified; macOS binary and packaged-launch SC2 deferred as open human-verify debt.

## Tasks Completed

| # | Task | Commit | Type | Status |
|---|------|--------|------|--------|
| 1 | extraResources + mac.binaries config + static guard | e8f717c | feat | DONE |
| Ship-blocker fix | whisper.dll added to win32 filter + README + spec | a130077 | fix | DONE |
| 2 | Windows binary staged + verified; macOS DEFERRED to CI | — | human-action | PARTIAL/DEFERRED |
| 3 | SC2 E2E scaffold + RAM ceiling template | — | human-verify | OPEN debt |

## Verification

- `npx vitest run tests/static/whisper-binary-packaging.spec.ts --no-file-parallelism` — 8/8 pass
- `whisper-cli.exe --help` (on dev machine with binaries staged) — exit 0, 73 lines
- `whisper-cli.exe --help` without `whisper.dll` — exit 127 (STATUS_DLL_NOT_FOUND) — confirmed ship-blocker
- `tests/e2e/packaged-launch.spec.ts` — `.skip` (passes by design; runs against packaged artifact only)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] whisper.dll omitted from win32 extraResources filter — STATUS_DLL_NOT_FOUND ship-blocker**
- **Found during:** Post-Task-1 empirical verification (orchestrator runtime test)
- **Issue:** Task 1's package.json win32 filter was `["whisper-cli.exe", "ggml.dll", "ggml-base.dll", "ggml-cpu.dll"]`. The `whisper.dll` runtime DLL was omitted. A packaged Windows build would copy the binary without its primary runtime dependency, causing `STATUS_DLL_NOT_FOUND` (exit code 127, 1-line output) on first spawn — app would boot but STT would silently fail.
- **Proof:** `whisper-cli.exe --help` with `whisper.dll` present → exit 0, 73 lines. Same invocation after removing `whisper.dll` → exit 127, 1 line. Deterministic.
- **Fix:** Added `"whisper.dll"` to the win32 filter in `package.json`. Updated `build/whisper/README.md` (Windows contents list, Packaging Flow snippet, Verification Checklist). Added a new spec assertion to lock the fix.
- **Files modified:** `package.json`, `build/whisper/README.md`, `tests/static/whisper-binary-packaging.spec.ts`
- **Commit:** `a130077`

### Plan Scope Adjustments (not bugs)

**Task 2 — macOS binary DEFERRED to CI:**
The plan explicitly calls this a blocking human-action checkpoint. No macOS runner or Apple Developer ID cert is available on the Windows dev machine. The Windows binaries are staged and verified. macOS procurement path documented in `build/whisper/README.md` (Option A: `cmake -DWHISPER_METAL=ON` + CI workflow snippet + `otool -L` self-containment check).

**Task 3 — packaged-launch SC2 and RAM ceiling are OPEN human-verify debts:**
The plan explicitly calls this a blocking human-verify checkpoint. The automatable portions are done:
- `tests/e2e/packaged-launch.spec.ts` scaffolded as `.skip` with un-skip checklist (mirrors `tests/e2e/phase8-happy-path.spec.ts` precedent)
- `15-RAM-CEILING.md` created as a measurement template with procedure, expected budget, result tables, and pass/fail criteria

The actual packaged build run, SC2/SC3/SC5 verification, and RAM measurement require the user's 16 GB machine with the packaged artifact.

## Open Verification Debts

Two debts remain open after this plan — both require the user's machine / macOS CI:

**Debt 1: macOS binary procurement**
- Action: Build `whisper-cli` on a macOS CI runner via `cmake -B build -DWHISPER_METAL=ON && cmake --build build -j --config Release`
- Verify: `otool -L build/bin/whisper-cli` shows ONLY system frameworks
- Sign: electron-builder via `build.mac.binaries` entry (already wired in `package.json`)
- Reference: `build/whisper/README.md` §Option A (RECOMMENDED)

**Debt 2: Packaged-launch SC2 + SC3 + SC5 + RAM ceiling**
- Action: Build the packaged app (`npm run build` → `electron-builder --win`) on the 16 GB machine
- SC2: `npx playwright test tests/e2e/packaged-launch.spec.ts` — must pass (un-skip after packaging)
- SC3: Laptop-speaker acoustic half-duplex check (manual — cannot automate AEC behavior)
- SC5: Device hot-swap + permission-denied (manual)
- RAM ceiling: 10-second PTT session while Ollama 8B loaded — record in `15-RAM-CEILING.md`
- Reference: `tests/e2e/packaged-launch.spec.ts` header (un-skip checklist); `15-RAM-CEILING.md` (measurement procedure)

## Success Criteria Check

- [x] whisper-cli ships via extraResources + signed via mac.binaries (D-02, §Pitfall 2) — config in place, guard green
- [x] whisper.dll included in win32 filter — ship-blocker fixed (a130077)
- [ ] Packaged app launches with no NODE_MODULE_VERSION ABI crash + sidecar spawns (SC2) — OPEN: requires packaged build on user's machine
- [ ] Half-duplex holds on laptop speakers (SC3) — OPEN: manual acoustic check
- [ ] Device hot-swap + permission-denied handled (SC5) — OPEN: manual check
- [ ] RAM ceiling measured and recorded (16 GB machine) — OPEN: 15-RAM-CEILING.md template ready

## Known Stubs

None in the code paths. The packaged-launch E2E is intentionally `.skip` (not a stub — it has full assertions, just gated on a packaged artifact being present). The RAM ceiling template is a measurement form, not a stub.

## Threat Flags

No new threat surface introduced by this plan. The packaging config and static guard are purely build-time artifacts. The threat mitigations from the plan's threat model are:

- T-15-27 (binary signing): `build.mac.binaries` entry wired → electron-builder will sign on CI. Config locked by static guard.
- T-15-28 (binary provenance): Windows binary from official v1.8.6 release (staged, verified). macOS binary from CI cmake build (deferred, Option A documented).
- T-15-29 (Gatekeeper quarantine): `build.mac.binaries` entry prevents quarantine on clean macOS install. Proven by §Pitfall 2.
- T-15-30 (RAM-pressure swap): 15-RAM-CEILING.md measurement procedure in place; result pending 16 GB run.

## Self-Check: PASSED

- [x] `package.json` contains win32 + darwin extraResources entries with `to: "."`
- [x] `package.json build.mac.binaries` contains `"Contents/Resources/whisper-cli"`
- [x] `package.json` win32 filter includes `"whisper.dll"` (ship-blocker fix a130077)
- [x] `build/whisper/README.md` documents Windows v1.8.6 + macOS CI cmake + whisper.dll requirement + D-04 fallback
- [x] `tests/static/whisper-binary-packaging.spec.ts` — 8/8 pass (includes whisper.dll guard)
- [x] `tests/e2e/packaged-launch.spec.ts` — `.skip` scaffold with SC2 assertions + un-skip checklist
- [x] `.planning/phases/15-audio-i-o-model-runtime/15-RAM-CEILING.md` — measurement template created
- [x] Commits e8f717c (Task 1) and a130077 (whisper.dll fix) in git log
