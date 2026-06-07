---
phase: 16-streaming-cascade-barge-in-read-only
plan: "03"
subsystem: voice-renderer-logic
tags: [voice, tts, barge-in, pause-resume, queue, renderer, wave-1]
dependency_graph:
  requires: [16-01]
  provides:
    - useVoiceSession.bargeIn() + pause() + resume() + paused state (D-01/D-09)
    - KokoroPlayerHandle.cancel() + suspend() + resume() + speak(speed) (D-08/D-09 WARNING 3)
    - KokoroTtsInstance.generate() speed?: number type fix (D-08 Pitfall 2)
    - useReadAloudQueue hook with enqueue + cancel (D-05/D-07)
  affects:
    - src/renderer/features/voice/useVoiceSession.ts
    - src/renderer/features/voice/tts/useKokoroPlayer.ts
    - src/renderer/features/voice/useReadAloudQueue.ts
    - src/renderer/features/voice/VoicePTTButton.spec.tsx
    - tests/unit/renderer/voice/half-duplex.spec.ts
    - tests/unit/renderer/voice/useVoiceSession.spec.ts (NEW)
tech_stack:
  added: []
  patterns:
    - D-01 barge-in: renderer-first stop (state transition to idle) + voiceAbort IPC fire-and-forget (no await)
    - D-09 pause/resume: paused boolean alongside voiceState='speaking'; AudioContext operations delegated to caller
    - D-09 WARNING 3: KokoroPlayerHandle.suspend()/resume() declared + implemented (16-04b has known interface)
    - D-05 promise-chain queue: queueRef.current = queueRef.current.then(() => player.speak(text, {speed}))
    - D-02 Pitfall 5: cancel() resets queueRef AND calls player.cancel() (queue + source both cleared)
key_files:
  created:
    - src/renderer/features/voice/useReadAloudQueue.ts
    - tests/unit/renderer/voice/useVoiceSession.spec.ts
  modified:
    - src/renderer/features/voice/useVoiceSession.ts
    - src/renderer/features/voice/tts/useKokoroPlayer.ts
    - src/renderer/features/voice/VoicePTTButton.spec.tsx
    - tests/unit/renderer/voice/half-duplex.spec.ts
decisions:
  - "bargeIn() guards window.aria undefined in test environments (window.aria check before voiceAbort call)"
  - "cancel()/suspend()/resume() on KokoroPlayerHandle return void (fire-and-forget per D-09 spec — not awaited)"
  - "suspend() only suspends when audioCtx.state === 'running'; resume() only resumes when 'suspended' (safe state guards)"
  - "sourceRef cleared to null on source.onended as well as cancel() to prevent dangling references"
  - "half-duplex.spec.ts test updated: PTT-during-speaking now correctly asserts barge-in behavior (D-01 behavior change)"
  - "currentSessionId generated via crypto.randomUUID() with Date.now() fallback for environments without crypto"
metrics:
  duration: "~17 minutes"
  completed: "2026-06-07T18:27:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 4
---

# Phase 16 Plan 03: Renderer Voice Logic (Barge-in + Queue) Summary

Renderer-side pure logic for the streaming cascade: bargeIn()/pause()/resume() actions with paused state in useVoiceSession (D-01/D-09), KokoroTtsInstance speed type fix + KokoroPlayerHandle cancel/suspend/resume interface (D-08/D-09 WARNING 3 fix), and the useReadAloudQueue promise-chain queue hook (D-05/D-07).

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | useVoiceSession bargeIn/pause/resume + paused state | 4c9aadf | useVoiceSession.ts, half-duplex.spec.ts, useVoiceSession.spec.ts (NEW) |
| 2 | KokoroPlayerHandle speed/cancel/suspend/resume + useReadAloudQueue | 361ceab | useKokoroPlayer.ts, useReadAloudQueue.ts (NEW) |

## What Was Built

### Task 1: useVoiceSession Phase-16 Extensions

Added `paused: boolean` (default `false`) to `VoiceSessionState`. Added `bargeIn()`, `pause()`, `resume()` to `VoiceSessionActions` interface and implementation.

**bargeIn() (D-01/D-02):**
- Guard: no-op when `voiceState !== 'speaking'` (SC5: ambient sound without PTT never interrupts — guaranteed by construction)
- `clearCooldown()` cancels any in-flight half-duplex cooldown timer
- Fires `(window.aria as AriaApi).voiceAbort?.({ sessionId: currentSessionId })` **without await** (D-02 fire-and-forget; ~5ms renderer-side cancel is what hits SC3)
- `setState({ voiceState: 'idle', micGated: false, paused: false, liveTranscript: '' })`

**startTurn() D-01 dispatch:**
- When `voiceState === 'speaking'`, calls `actions.bargeIn()` then returns `false` (instead of just returning false as in Phase 15)
- `muted-during-playback` branch still returns false as-is

**pause() (D-09):** `clearCooldown()` + `setState({ paused: true })`. AudioContext.suspend() is caller's responsibility (VoiceHUDBand 16-04b).

**resume() (D-09):** `setState({ paused: false })`. AudioContext.resume() is caller's responsibility.

**currentSessionId:** Generated via `crypto.randomUUID()` with `Date.now()` + `Math.random()` fallback on each `startTurn()`. Wave 2 VoiceSessionManager will supply the canonical session ID via IPC.

**Test additions:** 13 new test cases in `useVoiceSession.spec.ts` covering bargeIn/pause/resume/startTurn dispatch/paused defaults/bargeIn resets paused. half-duplex.spec.ts updated to reflect D-01 behavior change (PTT-during-speaking now calls bargeIn → idle, not stays-speaking). VoicePTTButton.spec.tsx `makeSession()` updated with `paused: false` + `bargeIn/pause/resume: vi.fn()`.

### Task 2: KokoroPlayerHandle + useReadAloudQueue

**KokoroTtsInstance.generate() (D-08 Pitfall 2 fix):**
- Added `speed?: number` to options — `kokoro-js@1.2.1` accepts it but the local interface stub didn't declare it (was silent no-op)

**KokoroPlayerHandle interface additions (D-09 WARNING 3 fix — full contract declared so 16-04b has no guesswork):**
- `speak(text, options?: {speed?: number})`: Promise<void> — speed threaded to generate()
- `cancel(): void` — stops active AudioBufferSourceNode (D-02)
- `suspend(): void` — AudioContext.suspend() fire-and-forget (D-09)
- `resume(): void` — AudioContext.resume() fire-and-forget (D-09)

**createKokoroPlayer implementation:**
- `sourceRef: AudioBufferSourceNode | null` closure variable tracks active source
- `speak()` stores source in `sourceRef` before play; clears on `source.onended`
- `cancel()`: calls `sourceRef.stop()` guarded in try/catch (stop() may throw if already stopped); nulls `sourceRef`
- `suspend()`: guards `audioCtx.state === 'running'` before calling `void audioCtx.suspend()`
- `resume()`: guards `audioCtx.state === 'suspended'` before calling `void audioCtx.resume()`

**useReadAloudQueue hook (D-05/D-07):**
- `queueRef = useRef<Promise<void>>(Promise.resolve())`
- `enqueue(text)`: `queueRef.current = queueRef.current.then(async () => { await player.speak(text, { speed }); })`
- `cancel()`: `queueRef.current = Promise.resolve(); player.cancel()` (Pitfall 5 fix: BOTH reset queue AND stop source)
- Wave-0 RED scaffold turned GREEN: 4/4 tests pass

## Verification

```
tests/unit/renderer/voice/useVoiceSession.spec.ts: 13/13 PASS
tests/unit/renderer/voice/useReadAloudQueue.spec.ts: 4/4 PASS
tests/unit/renderer/voice/half-duplex.spec.ts: 5/5 PASS
pnpm typecheck: 84 errors (matches baseline, 0 new)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] half-duplex.spec.ts PTT-during-speaking test assertion outdated by D-01**
- **Found during:** Task 1 verification run
- **Issue:** Phase-15 half-duplex test asserted `voiceState stays 'speaking'` after `startTurn()` during speaking. Phase 16 D-01 intentionally changes this — `startTurn()` now calls `bargeIn()` which transitions to 'idle'.
- **Fix:** Updated the test description and assertions to reflect D-01 semantics: `startTurn()` returns false (correct) AND state transitions to idle (new D-01 behavior).
- **Files modified:** `tests/unit/renderer/voice/half-duplex.spec.ts`
- **Commit:** 4c9aadf

**2. [Rule 2 - Missing guard] window.aria null-safety in bargeIn()**
- **Found during:** Task 1 verification (half-duplex.spec.ts failure)
- **Issue:** `bargeIn()` called `(window.aria as AriaApi).voiceAbort?.(...)` but `window.aria` was `undefined` in the Vitest jsdom environment, throwing `TypeError: Cannot read properties of undefined`.
- **Fix:** Added `if (typeof window !== 'undefined' && window.aria)` guard before the IPC call. The optional chaining `?.` on `voiceAbort` handles the case where window.aria exists but voiceAbort is unregistered.
- **Files modified:** `src/renderer/features/voice/useVoiceSession.ts`
- **Commit:** 4c9aadf

**3. [Rule 1 - Bug] VoicePTTButton.spec.tsx makeSession() missing Phase-16 required fields**
- **Found during:** pnpm typecheck
- **Issue:** `makeSession()` returned an object with `paused?: boolean` (optional from `Partial<>` spread) but `VoiceSessionState.paused` is now required. TypeScript error TS2322.
- **Fix:** Added `paused: false`, `bargeIn: vi.fn()`, `pause: vi.fn()`, `resume: vi.fn()` to the default `makeSession()` return object.
- **Files modified:** `src/renderer/features/voice/VoicePTTButton.spec.tsx`
- **Commit:** 4c9aadf

## Threat Surface Scan

No new security-relevant surface beyond the plan's declared threat model. All changes are renderer-local:
- `bargeIn()` fires `voiceAbort` IPC — covered by T-16-07 (accept: renderer always has permission to abort its own LLM stream)
- `speed` parameter — covered by T-16-08 (accept: renderer-local audio parameter, no network egress)
- D-13 ratchet (Plan 16-05) will walk `renderer/features/voice/` to confirm no write chokepoints are imported — all three new files are clean (no `assertApproved`, `voiceConfirm`, etc.)

## Self-Check

### Created files exist:
- [x] `src/renderer/features/voice/useReadAloudQueue.ts` — FOUND
- [x] `tests/unit/renderer/voice/useVoiceSession.spec.ts` — FOUND

### Modified files exist:
- [x] `src/renderer/features/voice/useVoiceSession.ts` — FOUND
- [x] `src/renderer/features/voice/tts/useKokoroPlayer.ts` — FOUND

### Commits exist:
- [x] 4c9aadf — Task 1 commit (bargeIn/pause/resume)
- [x] 361ceab — Task 2 commit (speed/cancel/suspend/resume + useReadAloudQueue)

## Self-Check: PASSED
