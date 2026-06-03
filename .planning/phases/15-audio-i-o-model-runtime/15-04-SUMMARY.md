---
phase: 15-audio-i-o-model-runtime
plan: "04"
subsystem: voice-capture
tags: [voice, audio, audioworklet, getUserMedia, renderer, tdd]
dependency_graph:
  requires:
    - src/shared/voice-types.ts (VoiceState DTO — Plan 15-01)
    - src/main/index.ts CSP script-src blob: fix (Plan 15-01 csp-allows-blob.spec.ts)
  provides:
    - src/renderer/features/voice/capture/mic-worklet.ts (Blob-URL AudioWorklet loader)
    - src/renderer/features/voice/capture/useMicCapture.ts (getUserMedia hook + createMicCapture factory)
  affects:
    - Plan 15-05 (useMicCapture's onPcmFrame callback is the PCM source for voiceFeedAudio IPC)
    - Plan 15-07 (VoicePTTButton calls start()/stop() on useMicCapture)
tech_stack:
  added: []
  patterns:
    - Inline-Blob-URL AudioWorklet (WORKLET_SOURCE template literal → Blob → URL.createObjectURL → addModule → revokeObjectURL)
    - Factory pattern for testable async lifecycle (createMicCapture returns { start, stop })
    - React hook wrapper (useMicCapture) with stable refs + unmount cleanup
    - DeviceChange hot-swap: addEventListener('devicechange') → stop old tracks → re-acquire
    - Structured error routing: NotAllowedError → permission-denied onError; re-acquire fail → device-lost onError
key_files:
  created:
    - src/renderer/features/voice/capture/mic-worklet.ts
    - src/renderer/features/voice/capture/mic-worklet.spec.ts
    - src/renderer/features/voice/capture/useMicCapture.ts
    - src/renderer/features/voice/capture/useMicCapture.spec.ts
  modified: []
decisions:
  - "D-19 resample strategy: AudioContext created at sampleRate 16000 (not in-worklet resampler); worklet receives pre-downsampled input and forwards mono channel 0 as transferable ArrayBuffer"
  - "Factory pattern (createMicCapture) + React hook wrapper (useMicCapture) keeps core logic testable without React runtime"
  - "useMicCapture does NOT close AudioContext on devicechange — context is reused across device swaps to avoid re-init cost; only tracks + worklet node are torn down"
metrics:
  duration: "~30 minutes"
  completed: "2026-06-03"
  tasks_completed: 2
  tasks_total: 2
  files_created: 4
  files_modified: 0
---

# Phase 15 Plan 04: Renderer Audio Capture Layer Summary

Renderer getUserMedia → inline-Blob-URL AudioWorklet → 16 kHz mono PCM, with devicechange hot-swap and permission-denied structured error routing (D-19/D-20/SC5).

## Tasks Completed

| # | Task | Commit | Type |
|---|------|--------|------|
| 1 | mic-worklet Blob-URL registration (TDD RED) | 0db8f38 | test |
| 1 | mic-worklet Blob-URL registration (TDD GREEN) | 9c51e87 | feat |
| 2 | useMicCapture getUserMedia + worklet + devicechange (TDD RED) | 4549028 | test |
| 2 | useMicCapture getUserMedia + worklet + devicechange (TDD GREEN) | d1ee4db | feat |

## Verification

- `npx vitest run src/renderer/features/voice/capture/` — 20/20 tests pass (2 spec files)
- `npm run typecheck` — 84 errors (all pre-existing baseline from other files; 0 errors in new files)
- `WORKLET_SOURCE` embeds `registerProcessor('mic-processor', MicProcessor)` with `inputs[0][0]` mono channel + `port.postMessage({ pcm: buf }, [buf])` transferable
- `setupWorklet` creates Blob(type=application/javascript), URL.createObjectURL, addModule, URL.revokeObjectURL in finally block
- `createMicCapture` calls getUserMedia (no desktopCapturer, no video constraint), creates AudioContext at sampleRate 16000, wires worklet source, registers devicechange listener
- Permission-denied (NotAllowedError) → `{ type: 'permission-denied', message: 'Microphone permission denied — check your system settings' }` via onError callback — no unhandled throw
- devicechange → stop old tracks, re-acquire; re-acquire failure → `{ type: 'device-lost', message: 'Audio device disconnected' }` via onError
- stop() stops all tracks, disconnects worklet, closes AudioContext, removes devicechange listener

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] AudioWorkletNode mock used vi.fn().mockReturnValue() which vitest disallows for `new` calls**
- **Found during:** Task 1 GREEN phase
- **Issue:** `vi.stubGlobal('AudioWorkletNode', vi.fn().mockReturnValue(fakeNode))` throws "Cannot use mockReturnValue when called with `new`" in vitest 4.x. The workaround is using a real class.
- **Fix:** Replaced with a `class MockAudioWorkletNode` that records `processorName`. Assertion changed from `toHaveBeenCalledWith` on the constructor to checking `node.processorName === 'mic-processor'`.
- **Files modified:** `mic-worklet.spec.ts`
- **Commit:** 9c51e87 (same GREEN commit)

**2. [Rule 1 - Bug] AudioContext mock as vi.fn() triggered "mock did not use function or class" warning in vitest**
- **Found during:** Task 2 GREEN phase — 6/11 tests failing
- **Issue:** `vi.fn().mockImplementation(() => plainObj)` for a global that is `new`-called causes vitest 4.x warnings and the constructor assignment for `currentFakeCtx` didn't work correctly.
- **Fix:** Replaced with a real `class FakeAudioContext` that sets `currentFakeCtx = this` in its constructor, giving tests a direct reference to the actual instance created during `start()`.
- **Files modified:** `useMicCapture.spec.ts`
- **Commit:** d1ee4db (same GREEN commit)

## Success Criteria Check

- [x] Capture is getUserMedia → inline-Blob-URL AudioWorklet → 16 kHz mono PCM (D-19); no native recorder / desktopCapturer
- [x] Device hot-swap re-acquires without crash; permission-denied is an actionable error (D-20/SC5)
- [x] PCM surfaces as transferable ArrayBuffers for Plan 15-05; worklet relies on the Plan 15-01 CSP blob: fix
- [x] 20/20 tests pass; typecheck clean on new files

## Known Stubs

None — this plan delivers pure audio-capture infrastructure. No UI rendering, no stubs.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| T-15-11 resolved | src/renderer/features/voice/capture/useMicCapture.ts | NotAllowedError + device-lost caught and routed to structured onError — no unhandled rejection takes down renderer |
| T-15-12 accept | src/renderer/features/voice/capture/useMicCapture.ts | PCM forwarded only to onPcmFrame callback; Plan 15-05 owns IPC transport; no direct network path from this module |
| T-15-13 accept | src/renderer/features/voice/capture/mic-worklet.ts | WORKLET_SOURCE is a compile-time template literal, not user input; blob: is scoped to script-src only (Plan 15-01) |

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED — mic-worklet | 0db8f38 | PASS (import failed — no such module) |
| GREEN — mic-worklet | 9c51e87 | PASS (9/9 tests) |
| RED — useMicCapture | 4549028 | PASS (import failed — no such module) |
| GREEN — useMicCapture | d1ee4db | PASS (11/11 tests) |

## Self-Check: PASSED

- [x] src/renderer/features/voice/capture/mic-worklet.ts exists and contains `WORKLET_SOURCE`, `setupWorklet`, `createObjectURL`, `revokeObjectURL`, `registerProcessor`
- [x] src/renderer/features/voice/capture/useMicCapture.ts exists and contains `getUserMedia`, `devicechange`, `NotAllowedError`, `createMicCapture`, `useMicCapture`
- [x] mic-worklet.spec.ts exists (9 tests)
- [x] useMicCapture.spec.ts exists (11 tests)
- [x] All 20 tests pass
- [x] Commits 0db8f38, 9c51e87, 4549028, d1ee4db all exist in git log
