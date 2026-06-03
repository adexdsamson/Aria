---
phase: 15-audio-i-o-model-runtime
plan: "06"
subsystem: voice-tts-session
tags: [voice, tts, kokoro, half-duplex, state-machine, renderer, tdd, VOICE-07]
dependency_graph:
  requires:
    - src/shared/voice-types.ts (VoiceState union — Plan 15-01)
    - src/shared/ipc-contract.ts (VOICE_* channels + AriaApi — Plan 15-01)
    - src/preload/index.ts (onVoiceTranscript/onVoiceState/onVoiceModelProgress — Plan 15-01)
  provides:
    - src/renderer/features/voice/tts/useKokoroPlayer.ts (Kokoro-82M renderer TTS, webgpu→wasm)
    - src/renderer/features/voice/useVoiceSession.ts (state machine + half-duplex gate + IPC subs)
    - tests/unit/renderer/voice/half-duplex.spec.ts (VOICE-07/SC3 automated proof)
  affects:
    - Plan 15-07 (VoicePTTButton calls useVoiceSession for startTurn + micGated; useKokoroPlayer for speak)
    - Plan 15-05 (useMicCapture's onPcmFrame should be gated by micGated before voiceFeedAudio)
    - Phase 16 (the 'speaking' state seam in useVoiceSession is ready for streaming TTS cascade)
tech_stack:
  added:
    - kokoro-js@^1.2.1 (Kokoro-82M ONNX TTS engine, webgpu/wasm backends)
  patterns:
    - createKokoroPlayer factory (injectable KokoroTTS + AudioContext for testability)
    - createVoiceSessionStore observable store (lightweight pub/sub, no Zustand dep)
    - TDD RED→GREEN for both hooks (failing import → green implementation)
    - micGated half-duplex gate with setTimeout cooldown (fake-timer testable)
    - IPC push subscription via subscribeToIpc (mirrors AppShellNavigateListener pattern)
key_files:
  created:
    - src/renderer/features/voice/tts/useKokoroPlayer.ts
    - src/renderer/features/voice/tts/useKokoroPlayer.spec.ts
    - src/renderer/features/voice/useVoiceSession.ts
    - src/renderer/features/voice/useVoiceSession.spec.ts
    - tests/unit/renderer/voice/half-duplex.spec.ts
  modified:
    - package.json (added kokoro-js@^1.2.1)
    - pnpm-lock.yaml (lockfile updated)
decisions:
  - "D-18 trigger: speak(text) exposes a plain text param — caller passes the echo/fixed utterance; hook does NOT hard-code briefing content"
  - "D-13 cooldown: HALF_DUPLEX_COOLDOWN_MS=800 exported constant for testability; fake-timer driven"
  - "Store pattern: createVoiceSessionStore() observable factory (not Zustand) — Zustand not installed in the project; observable pub/sub achieves the same store contract"
  - "half-duplex.spec placement: tests/unit/renderer/voice/ (not tests/unit/voice/) — matches vitest renderer project include glob"
  - "startTurn() returns boolean: false when blocked (speaking state), true when started — callers can check"
metrics:
  duration: "~35 minutes"
  completed: "2026-06-03"
  tasks_completed: 2
  tasks_total: 2
  files_created: 5
  files_modified: 2
---

# Phase 15 Plan 06: Renderer TTS Path + Voice Session State Machine Summary

Kokoro-82M renderer TTS (webgpu→wasm fallback) with playback start/end signals, and the Zustand-style voice session state machine (idle→listening→processing→speaking→idle) with the micGated half-duplex gate (D-13/D-17/VOICE-07/SC3).

## Tasks Completed

| # | Task | Commit | Type |
|---|------|--------|------|
| 1 | useKokoroPlayer — TDD RED (failing test) | 5e761f2 | test |
| 1 | useKokoroPlayer — TDD GREEN (implementation) | 0161e91 | feat |
| 2 | useVoiceSession + half-duplex — TDD RED (failing tests) | 516b6de | test |
| 2 | useVoiceSession + half-duplex — TDD GREEN (implementation) | fe5ff56 | feat |

## Verification

- `npx vitest run src/renderer/features/voice/tts/useKokoroPlayer.spec.ts` — 6/6 pass
- `npx vitest run src/renderer/features/voice/useVoiceSession.spec.ts tests/unit/renderer/voice/half-duplex.spec.ts` — 15/15 pass
- All 3 spec files together: 21/21 pass
- `npm run typecheck` — 0 errors in new files (pre-existing 84-error baseline unchanged)
- `pnpm install --lockfile-only` updated lockfile for kokoro-js@^1.2.1

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] half-duplex.spec.ts path corrected to match vitest config**
- **Found during:** Task 2 RED setup
- **Issue:** Plan specifies `tests/unit/voice/half-duplex.spec.ts` but the vitest config only covers `tests/unit/main/**` and `tests/unit/renderer/**` — the bare `tests/unit/voice/` path is not in any project's include glob and would be silently ignored.
- **Fix:** Placed the spec at `tests/unit/renderer/voice/half-duplex.spec.ts` which is picked up by the renderer project's `tests/unit/renderer/**/*.{test,spec}.{ts,tsx}` include.
- **Files modified:** `tests/unit/renderer/voice/half-duplex.spec.ts` (created at correct path)
- **Commit:** 516b6de

**2. [Rule 1 - Bug] speak() test timing: createBufferSource called after async generate()**
- **Found during:** Task 1 GREEN phase
- **Issue:** Tests captured `fakeCtx.lastSourceNode` immediately after calling `speak()`, but `createBufferSource()` is called only AFTER `await generate()` resolves. The node was null at the capture point.
- **Fix:** Added `await Promise.resolve(); await Promise.resolve()` in test to flush the pending microtask before capturing lastSourceNode. The implementation order (generate→createBufferSource→onPlaybackStart→start) is correct and intentional.
- **Files modified:** `useKokoroPlayer.spec.ts`
- **Commit:** 0161e91

**3. [Rule 2 - Missing] store.subscribeToIpc convenience method**
- **Found during:** Task 2 GREEN phase
- **Issue:** Tests called `store.subscribeToIpc()` directly on the store object, but the initial VoiceSessionStore type only exposed `getState()` and `subscribe()`. `subscribeToIpc` was only available via `store.getState().subscribeToIpc()`.
- **Fix:** Added `subscribeToIpc(aria)` directly on the VoiceSessionStore type and implementation — natural API design for the mount-effect pattern.
- **Files modified:** `useVoiceSession.ts`
- **Commit:** fe5ff56

**4. [Rule 1 - Bug] Zustand not installed — used observable store pattern instead**
- **Found during:** Task 2 implementation
- **Issue:** Plan specifies "Zustand store" per CONTEXT.md STACK.md recommendation, but Zustand is not in package.json or node_modules. Adding it would be an unplanned dependency.
- **Fix:** Implemented a minimal observable store (pub/sub pattern with listeners Set + setState helper) that achieves the same external contract — `getState()`, `subscribe()`, `subscribeToIpc()`. The API surface matches what the tests + downstream plans expect.
- **Files modified:** `useVoiceSession.ts` (full implementation without Zustand)
- **Commit:** fe5ff56

## Success Criteria Check

- [x] Real Kokoro-82M renderer playback (webgpu→wasm fallback) — useKokoroPlayer.ts
- [x] D-18 trigger: speak(text) exposes a plain param — caller supplies the echo utterance
- [x] onPlaybackStart fires BEFORE AudioBufferSourceNode.start() (verified by test ordering assertions)
- [x] onPlaybackEnd fires AFTER buffer ends event (verified by invocation order test)
- [x] Voice state machine includes 'speaking' (D-17) — state: 'idle'|'listening'|'processing'|'speaking'|'muted-during-playback'|'error'
- [x] micGated=true on turn-start AND full TTS playback duration (D-13)
- [x] startTurn() blocked (returns false) while state === 'speaking' (D-13 gate)
- [x] ~800ms cooldown after onPlaybackEnd before micGated=false (D-13; HALF_DUPLEX_COOLDOWN_MS=800)
- [x] subscribeToIpc() wires all 3 VOICE_* push channels with unsubscribe on teardown
- [x] half-duplex.spec proves PTT-start rejected while speaking (VOICE-07/SC3 automated proxy)
- [x] kokoro-js@^1.2.1 in package.json; lockfile updated

## Known Stubs

None. The hooks expose full production-ready logic:
- `useKokoroPlayer.init()` triggers the real kokoro-js lazy import in production (~160 MB HF download)
- `createVoiceSessionStore()` is the production store with real setTimeout cooldown
- No hardcoded placeholder values that flow to UI rendering

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| T-15-18 resolved | src/renderer/features/voice/useVoiceSession.ts | micGated=true enforced for full playback + 800ms cooldown; startTurn() returns false while speaking — primary AEC defense (#47043) |
| T-15-19 accept | src/renderer/features/voice/tts/useKokoroPlayer.ts | KOKORO_MODEL_ID pinned to onnx-community/Kokoro-82M-v1.0-ONNX, fetched over HTTPS by transformers.js; renderer-cached |
| T-15-20 resolved | src/renderer/features/voice/tts/useKokoroPlayer.ts | speak() accepts caller-provided text param; D-18 scope (echo/fixed utterance only) enforced by callers in Plan 15-07 |

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED — useKokoroPlayer | 5e761f2 | PASS (import failed — no such module) |
| GREEN — useKokoroPlayer | 0161e91 | PASS (6/6 tests) |
| RED — useVoiceSession + half-duplex | 516b6de | PASS (import failed — no such module) |
| GREEN — useVoiceSession + half-duplex | fe5ff56 | PASS (15/15 tests) |

## Self-Check: PASSED

- [x] src/renderer/features/voice/tts/useKokoroPlayer.ts exists and contains 'KokoroTTS', 'webgpu', 'wasm', 'onPlaybackStart', 'onPlaybackEnd'
- [x] src/renderer/features/voice/useVoiceSession.ts exists and contains 'micGated', 'speaking', 'startTurn', 'onPlaybackStart', 'onPlaybackEnd', 'subscribeToIpc', 'HALF_DUPLEX_COOLDOWN_MS'
- [x] tests/unit/renderer/voice/half-duplex.spec.ts exists with 5 tests
- [x] All 21 tests pass across 3 spec files
- [x] Commits 5e761f2, 0161e91, 516b6de, fe5ff56 all exist in git log
- [x] kokoro-js@^1.2.1 in package.json
