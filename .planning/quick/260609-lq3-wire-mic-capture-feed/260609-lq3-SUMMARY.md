---
phase: 260609-lq3
plan: 01
subsystem: voice
tags: [voice, mic-capture, ipc, ptt, renderer, hook]
dependency_graph:
  requires:
    - src/renderer/features/voice/capture/useMicCapture.ts
    - src/renderer/features/voice/useVoiceSession.ts
    - src/shared/ipc-contract.ts (voiceFeedAudio)
  provides:
    - src/renderer/features/voice/useVoiceCapture.ts (useVoiceCapture hook)
  affects:
    - src/renderer/app/App.tsx (VoiceHUDBandConnected now drives mic capture)
tech_stack:
  added: []
  patterns:
    - useRef for capture handle + per-turn frames array (avoids closure-before-assignment)
    - useEffect keyed on [session.voiceState] with prevStateRef for edge detection
    - Try/finally around feedAudio IPC to guarantee endTurn (T-lq3-03)
    - Injection opts (createCapture + feedAudio) for test isolation
    - aria:toast CustomEvent bus for error surfacing (mirrors useVoiceConfirm pattern)
key_files:
  created:
    - src/renderer/features/voice/useVoiceCapture.ts
    - src/renderer/features/voice/useVoiceCapture.spec.ts
  modified:
    - src/renderer/app/App.tsx
decisions:
  - "Refs for capture handle + frames array (not useState) to avoid stale closure and synchronous frame accumulation"
  - "captureRef.current?.stop() in onError instead of local handle constant — prevents closure-before-assignment bug"
  - "feedAudio in try/finally not try/catch — endTurn always called regardless of IPC success/failure"
  - "prevStateRef used to track transition direction (listening→processing vs any→processing)"
metrics:
  duration: ~25 minutes
  completed: 2026-06-09
  tasks_completed: 2
  files_changed: 3
---

# Phase 260609-lq3 Plan 01: Wire Mic Capture Feed Summary

**One-liner:** useVoiceCapture hook connecting createMicCapture PCM pipeline to voiceFeedAudio IPC via voiceState-keyed useEffect with concat-and-flush on turn-end.

## What Was Built

### Task 1: useVoiceCapture hook + spec (TDD)

`src/renderer/features/voice/useVoiceCapture.ts` — a React hook that:

- Accepts the flat `VoiceSessionState & VoiceSessionActions` snapshot from `useVoiceSession()`
- Uses `useEffect` keyed on `[session.voiceState]` with a `prevStateRef` to detect edge transitions
- Maintains `captureRef` (current `MicCaptureHandle | null`) and `framesRef` (per-turn `ArrayBuffer[]`) via `useRef`
- On `prev !== 'listening' && curr === 'listening'`: creates a fresh capture handle, resets frames, calls `handle.start()`
- On `prev === 'listening' && curr === 'processing'`: calls `handle.stop()`, concatenates all Int16 frames byte-accurately via `Uint8Array.set()`, calls `voiceFeedAudio` if total bytes > 0, then `session.endTurn()` in finally path
- On `curr === 'idle' && captureRef.current !== null` (bargeIn): calls `handle.stop()`, discards buffer, no feedAudio
- On `onError`: uses `captureRef.current?.stop()` (not a captured local) to avoid closure-before-assignment, dispatches `aria:toast` CustomEvent, calls `session.endTurn()`

Spec covers all 6 cases: (a) start-turn, (b) frame accumulation, (c) flush with concatenation verification `[1,2]+[3,4]→[1,2,3,4]`, (d) zero-frame no-feed, (e) bargeIn stop+discard, (f) onError toast+endTurn.

### Task 2: Mount in VoiceHUDBandConnected (App.tsx)

Added `import { useVoiceCapture }` and `useVoiceCapture(session)` call inside `VoiceHUDBandConnected`. The single `useVoiceSession()` call now serves both `useVoiceCapture` and `VoiceHUDBand` props, eliminating a redundant store subscription.

## Verification

| Check | Result |
|-------|--------|
| useVoiceCapture.spec.ts 6 cases | PASS (6/6) |
| grep -c useVoiceCapture App.tsx | 2 (import + call site) |
| VoicePTTButton.spec.tsx | PASS (26/26) |
| useMicCapture.spec.ts | PASS (11/11) |
| useVoiceSession.spec.ts | 9/10 (1 pre-existing failure: D-13 half-duplex startTurn gate test) |
| typecheck error count | 84 (baseline unchanged, 0 new errors) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] vi.fn() mock not assignable to typeof createMicCapture**
- **Found during:** typecheck after GREEN
- **Issue:** `vi.fn((cbs) => handle)` has type `Mock<Procedure | Constructable>` which TypeScript cannot assign to `typeof createMicCapture`. This caused 7 typecheck errors in the spec.
- **Fix:** Added `import type { createMicCapture }` and typed the `makeCreateCapture` return value as `typeof createMicCapture`, using `as unknown as typeof createMicCapture` to satisfy the type while keeping the mock at runtime.
- **Files modified:** `src/renderer/features/voice/useVoiceCapture.spec.ts`
- **Commit:** 0b89ac1 (same atomic commit — included in GREEN)

## Known Stubs

None — `useVoiceCapture` is fully wired: `createMicCapture` (real impl) and `window.aria.voiceFeedAudio` (real IPC) are the defaults. The injection points are for tests only.

## Threat Surface Scan

No new network endpoints, auth paths, or trust boundaries introduced beyond what is already in the plan's threat model. `voiceFeedAudio` IPC is an existing channel from Phase 15-05.

## Self-Check: PASSED

- src/renderer/features/voice/useVoiceCapture.ts — FOUND
- src/renderer/features/voice/useVoiceCapture.spec.ts — FOUND
- src/renderer/app/App.tsx (modified) — FOUND
- Commit 0b89ac1 — confirmed in git log
