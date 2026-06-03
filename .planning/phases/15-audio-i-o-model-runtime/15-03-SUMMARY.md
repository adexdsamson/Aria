---
phase: 15-audio-i-o-model-runtime
plan: "03"
subsystem: voice-model-download
tags: [voice, download, ndh, whisper, resumable, powerMonitor, tdd, supply-chain]
dependency_graph:
  requires:
    - src/main/voice/prefs.ts (setVoiceModelReady / setVoiceModelDownloading — Plan 15-01)
    - src/shared/ipc-contract.ts (CHANNELS.VOICE_MODEL_PROGRESS / VOICE_STATE_CHANGED — Plan 15-01)
  provides:
    - src/main/voice/download/model-download.ts (ModelDownloadController + createModelDownload + DISCLOSED_MODEL_SIZE_BYTES)
  affects:
    - Plan 15-05 (IPC wiring — wires createModelDownload into IPC handlers + renderer progress subscription)
    - Plan 15-07 (onboarding voice step — calls disclosedSize() for size disclosure)
tech_stack:
  added:
    - node-downloader-helper@^2.1.11 (HTTP Range resume + progress events, pnpm-lock.yaml updated)
  patterns:
    - Injectable DownloaderHelper factory DI seam (parallel to SpawnFn in Plan 15-02)
    - makeRendererEmitter push via injected emitToRenderer dep (mirror of entitlement.ts pattern)
    - powerMonitor suspend/resume via injected registerLifecycle (mirror of sidecar-manager.ts)
    - settings(k,v) model-readiness flip via setVoiceModelReady on verified completion
    - T-15-08 supply-chain guard: size-mismatch blocks readiness flip
    - TDD RED/GREEN cycle (2 commits)
key_files:
  created:
    - src/main/voice/download/model-download.ts
    - src/main/voice/download/model-download.spec.ts
  modified:
    - package.json (added node-downloader-helper@^2.1.11)
    - pnpm-lock.yaml (lockfile-only update)
decisions:
  - "node-downloader-helper exports DownloaderHelper (not DownloadHelper) — corrected in implementation; exports verified via require()"
  - "Db type imported from ../../db/connect (not better-sqlite3 directly) to avoid tsconfig.node.json resolution gap"
  - "DISCLOSED_MODEL_SIZE_BYTES = 601882624 (verified in RESEARCH.md Pattern 4)"
  - "T-15-08: size mismatch on end blocks readiness flip; partial file kept for Range resume on next start"
metrics:
  duration: "~20 minutes"
  completed: "2026-06-03"
  tasks_completed: 1
  tasks_total: 1
  files_created: 2
  files_modified: 2
---

# Phase 15 Plan 03: Whisper Model Download Manager Summary

NDH-based resumable Whisper model download manager — HTTP Range resume, size disclosure before start, progress push to renderer, powerMonitor pause/resume, supply-chain size guard, and model-readiness flip on verified completion (D-05 through D-09, SC4).

## Tasks Completed

| # | Task | Commit | Type |
|---|------|--------|------|
| 1 | Resumable Whisper model download manager (TDD RED) | 93f0643 | test |
| 1 | Resumable Whisper model download manager (TDD GREEN) | 59c0dd6 | feat |

## Verification

- `npx vitest run src/main/voice/download/model-download.spec.ts tests/static/voice-audio-no-cloud.spec.ts` — 12/12 pass
- `npm run typecheck` — 84 errors (0 new; same pre-existing baseline as Plan 15-02)
- `node-downloader-helper` in package.json; pnpm-lock.yaml updated via `pnpm install --lockfile-only`
- voice-audio-no-cloud.spec.ts: 2/2 green (HF model URL is not a cloud audio endpoint — VOICE-04 preserved)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] NDH exports DownloaderHelper, not DownloadHelper**
- **Found during:** Task 1 GREEN phase (typecheck)
- **Issue:** `import { DownloadHelper } from 'node-downloader-helper'` fails — the actual export is `DownloaderHelper` (as shown by `Object.keys(require('node-downloader-helper'))` → `['DH_STATES', 'DownloaderHelper']`). The plan's RESEARCH excerpt used the wrong name.
- **Fix:** Renamed all references to `DownloaderHelper` in both model-download.ts and model-download.spec.ts.
- **Files modified:** `src/main/voice/download/model-download.ts`, `src/main/voice/download/model-download.spec.ts`
- **Commit:** 59c0dd6 (GREEN commit)

**2. [Rule 1 - Bug] Db type import from better-sqlite3 causes tsconfig.node.json resolution gap**
- **Found during:** Task 1 GREEN phase (typecheck)
- **Issue:** `import type { Database as Db } from 'better-sqlite3'` in model-download.ts triggers TS2307 "Cannot find module 'better-sqlite3'" in tsconfig.node.json (project uses better-sqlite3-multiple-ciphers). Pre-existing in prefs.ts and tray/notify.ts.
- **Fix:** Changed to `import type { Db } from '../../db/connect'` which exports `type Db = Database.Database` from the correctly-resolved ciphers package.
- **Files modified:** `src/main/voice/download/model-download.ts`
- **Commit:** 59c0dd6 (GREEN commit)

## Success Criteria Check

- [x] model-download.ts imports DownloaderHelper from node-downloader-helper with resumeIfFileExists/resumeOnIncomplete set
- [x] destination resolves under app.getPath('userData') (mocked in test); disclosedSize() returns DISCLOSED_MODEL_SIZE_BYTES before start
- [x] progress event → emitToRenderer(VOICE_MODEL_PROGRESS, …) + setVoiceModelDownloading; complete → setVoiceModelReady(db, path)
- [x] 10/10 spec tests pass (progress, complete-flips-ready, size-mismatch-guard, error-keeps-partial, pause/resume, size-before-start, powerMonitor seam, destDir)
- [x] voice-audio-no-cloud.spec.ts: 2/2 green (HF model URL is not a cloud audio endpoint)
- [x] typecheck 84 errors (0 new); package.json has node-downloader-helper; lockfile updated

## Known Stubs

None — this plan is pure main-process infrastructure. No UI rendering, no IPC wiring yet (Plan 15-05). The `emitToRenderer` and DB writes are fully wired; the IPC surface that exposes them to the renderer is Plan 15-05.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| T-15-08 mitigated | src/main/voice/download/model-download.ts | Size mismatch on 'end' blocks setVoiceModelReady — truncated/MITM'd files cannot flip readiness. HTTPS + size check is the L1 floor. |
| T-15-09 accepted | src/main/voice/download/model-download.ts | Fetch is to HF CDN only (GET, no body); no audio or user data sent. VOICE-04 ratchet enforces no cloud audio endpoint. |
| T-15-10 mitigated | src/main/voice/download/model-download.ts | resumeIfFileExists + resumeOnIncomplete (Range) recover from interruption; powerMonitor pauses on sleep to avoid retry burst. |

## TDD Gate Compliance

- RED gate: `test(15-03)` commit 93f0643 exists — spec fails with "Cannot find module './model-download'"
- GREEN gate: `feat(15-03)` commit 59c0dd6 exists — all 12 tests pass
- REFACTOR gate: Not needed — implementation is clean as-is

## Self-Check: PASSED

- [x] src/main/voice/download/model-download.ts exists
- [x] src/main/voice/download/model-download.spec.ts exists
- [x] Commit 93f0643 (TDD RED) exists in git log
- [x] Commit 59c0dd6 (TDD GREEN) exists in git log
- [x] package.json contains node-downloader-helper@^2.1.11
- [x] 12/12 tests pass; voice-audio-no-cloud.spec.ts 2/2 green
- [x] typecheck baseline unchanged (84 errors, 0 new from this plan)
