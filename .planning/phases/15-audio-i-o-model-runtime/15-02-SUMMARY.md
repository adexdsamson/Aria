---
phase: 15-audio-i-o-model-runtime
plan: "02"
subsystem: voice-stt-sidecar
tags: [voice, stt, sidecar, whisper-cli, tdd, static-ratchet, temp-wav, abi-safety]
dependency_graph:
  requires:
    - src/shared/voice-types.ts (TranscriptDelta DTO — Plan 15-01)
  provides:
    - src/main/voice/stt/wav.ts (writePcmToWav + tempWavPath)
    - src/main/voice/stt/sidecar-manager.ts (SttSidecarManager class + resolveBinaryPath)
    - tests/static/stt-no-native-addon.spec.ts (SC2 no-ABI-crash ratchet)
  affects:
    - Plan 15-05 (IPC wiring — registers powerMonitor lifecycle via SttSidecarManager.pause/resume/dispose)
    - Plan 15-09 (packaging — whisper-cli binary goes into extraResources; resolveBinaryPath() will resolve via process.resourcesPath)
tech_stack:
  added: []
  patterns:
    - RIFF/WAVE 44-byte PCM header writer (pure Node.js stdlib, no ffmpeg)
    - Injectable SpawnFn DI seam for unit testing child_process.spawn without real binary
    - try/finally temp-WAV cleanup (T-15-04 no biometric-audio persistence)
    - child_process.spawn per-utterance protocol (not persistent-stdin, per whisper.cpp issue #3521)
    - resolveBinaryPath: app.isPackaged ? process.resourcesPath : __dirname/../../../build (mirrors icons.ts)
    - static ratchet: walk/stripComments/missing-dir-guard (mirrors voice-routes-through-staging.spec.ts)
key_files:
  created:
    - src/main/voice/stt/wav.ts
    - src/main/voice/stt/wav.spec.ts
    - src/main/voice/stt/sidecar-manager.ts
    - src/main/voice/stt/sidecar-manager.spec.ts
    - tests/static/stt-no-native-addon.spec.ts
  modified: []
decisions:
  - "D-01: per-utterance spawn (not persistent-stdin) chosen for correctness — whisper.cpp CLI is file-based (issue #3521); start latency is acceptable for PTT loop"
  - "D-04: SpawnFn type uses 'any' options param to be assignable from node:child_process.spawn overloaded signatures without losing type safety in the implementation"
  - "T-15-04: tempWavPath() always resolves to os.tmpdir(), never app.getPath(userData)"
  - "SC2 ratchet: stt-no-native-addon.spec.ts proves the no-ABI-crash guarantee at CI time, not runtime"
metrics:
  duration: "~15 minutes"
  completed: "2026-06-03"
  tasks_completed: 3
  tasks_total: 3
  files_created: 5
  files_modified: 0
---

# Phase 15 Plan 02: STT Sidecar Manager Summary

WAV temp-file writer, SttSidecarManager (whisper-cli child process + per-utterance protocol + lifecycle hooks), and the no-native-addon static ratchet that makes SC2's "no NODE_MODULE_VERSION ABI crash" true by construction.

## Tasks Completed

| # | Task | Commit | Type |
|---|------|--------|------|
| 1 | WAV writer TDD RED | 5264236 | test |
| 1 | WAV writer TDD GREEN | 5a524db | feat |
| 2 | SttSidecarManager TDD RED | 48b9b66 | test |
| 2 | SttSidecarManager TDD GREEN | 360dfe2 | feat |
| 3 | No-native-addon static ratchet | 7b270c8 | feat |

## Verification

- `npx vitest run src/main/voice/stt/ tests/static/stt-no-native-addon.spec.ts tests/static/voice-routes-through-staging.spec.ts` — 34/34 pass
- `npm run typecheck` — 84 errors (1 fewer than baseline 85; pre-existing errors only)
- No `.node` imports/requires in stt/**; zero banned-package references
- voice-routes-through-staging.spec.ts: 2/2 pass (staging ratchet unaffected)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] SpawnFn type incompatible with child_process.spawn overloads**
- **Found during:** Task 2 typecheck pass
- **Issue:** `SpawnFn = (cmd, args: ReadonlyArray<string>, options?: SpawnOptions) => ChildProcess` does not match `child_process.spawn`'s overloaded signatures where `options` varies by overload. TypeScript reports TS2322 on the default assignment.
- **Fix:** Changed to `type SpawnFn = (cmd: string, args: ReadonlyArray<string>, options?: any) => ChildProcess` with an `eslint-disable` comment. Cast `defaultSpawn as SpawnFn` at the assignment site. The `any` is isolated to the type alias; the implementation never uses the options parameter.
- **Files modified:** `src/main/voice/stt/sidecar-manager.ts`, `src/main/voice/stt/sidecar-manager.spec.ts`
- **Commit:** 360dfe2 (same GREEN commit)

**2. [Rule 1 - Bug] Relative import path off by one directory level**
- **Found during:** Task 2 typecheck pass
- **Issue:** `../../shared/voice-types` from `src/main/voice/stt/` resolves to `src/main/shared/voice-types` (non-existent). Correct path is `../../../shared/voice-types`.
- **Fix:** Corrected import path in `sidecar-manager.ts`.
- **Files modified:** `src/main/voice/stt/sidecar-manager.ts`
- **Commit:** 360dfe2 (same GREEN commit)

**3. [Rule 1 - Bug] Unused `spawnCalls` variable and `cmd` parameter in spec**
- **Found during:** Task 2 typecheck pass
- **Issue:** `noUnusedLocals` / `noUnusedParameters` flagged `spawnCalls` (declared but only cleared in afterEach) and `cmd` parameter (captured but not used in cleanup test).
- **Fix:** Removed `spawnCalls` array; prefixed `cmd` to `_cmd` in the closure.
- **Files modified:** `src/main/voice/stt/sidecar-manager.spec.ts`
- **Commit:** 360dfe2 (same GREEN commit)

## Success Criteria Check

- [x] Sidecar wraps whisper-cli as a child process with the per-utterance WAV→--output-json protocol (D-01)
- [x] Temp WAVs cleaned on all paths (success AND non-zero exit AND JSON parse failure); lifecycle methods support powerMonitor suspend/resume (D-03)
- [x] No-native-addon ratchet green → SC2 no-ABI-crash true by construction (VOICE-04)

## Known Stubs

None — this plan delivers pure runtime infrastructure (WAV writer, sidecar manager, static guard). No UI rendering, no data sources.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| T-15-04 resolved | src/main/voice/stt/wav.ts | tempWavPath() writes ONLY to os.tmpdir(); writePcmToWav does NOT accept a userData path |
| T-15-05 resolved | src/main/voice/stt/sidecar-manager.ts | dispose() reaps child + clears all tracked temp files; pause() kills child on suspend |
| T-15-07 resolved | src/main/voice/stt/sidecar-manager.ts | lives under src/main/voice/**; voice-routes-through-staging ratchet green (2/2) |

## Self-Check: PASSED

- [x] src/main/voice/stt/wav.ts exists and exports writePcmToWav + tempWavPath
- [x] src/main/voice/stt/sidecar-manager.ts exists and exports SttSidecarManager + resolveBinaryPath
- [x] tests/static/stt-no-native-addon.spec.ts exists with 4 tests
- [x] Commits 5264236, 5a524db, 48b9b66, 360dfe2, 7b270c8 all present in git log
- [x] 34/34 tests pass across all spec files
- [x] typecheck baseline not degraded (84 errors vs 85 baseline)
