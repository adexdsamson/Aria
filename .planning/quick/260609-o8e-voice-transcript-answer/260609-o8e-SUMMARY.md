---
phase: 260609-o8e
plan: 01
subsystem: voice
tags: [voice, ipc, transcript, renderer]
dependency_graph:
  requires: [useVoiceSession, voiceFeedAnswer IPC channel]
  provides: [normal turn answer routing]
  affects: [VoiceHUDBand, voiceSessionManager.startAnswer]
tech_stack:
  added: []
  patterns: [fire-and-forget IPC, window.aria guard pattern]
key_files:
  modified:
    - src/renderer/features/voice/useVoiceSession.ts
    - src/renderer/features/voice/useVoiceSession.spec.ts
    - tests/setup-native-abi.ts
decisions:
  - "Fire-and-forget voiceFeedAnswer (no await) to keep setTranscript synchronous"
  - "text.trim().length > 0 guard prevents empty-question IPC calls (T-o8e-02)"
  - "typeof window !== 'undefined' && window.aria guard matches voiceAbort pattern at ~line 339"
metrics:
  duration: "~15 minutes"
  completed: "2026-06-09"
  tasks: 1
  files: 3
---

# Phase 260609-o8e: Voice Transcript Answer Routing Summary

**One-liner:** Wire setTranscript normal-turn else-branch to fire voiceFeedAnswer IPC with sessionId and question text for non-empty final transcripts.

## What Was Built

`setTranscript(text, final=true)` with `pendingApprovalId === null` was a no-op with a stale comment claiming voiceFeedAnswer was "called externally by the capture layer" — it was not. The main-side `VOICE_FEED_ANSWER` handler (`voice.ts ~line 513`) was fully wired to `voiceSessionManager.startAnswer`; it just needed the renderer to call it.

The fix: in the else-branch (normal turn path), when `text.trim().length > 0`, call `(window.aria as AriaApi).voiceFeedAnswer?.({ sessionId: currentSessionId, question: text })` guarded by the standard `typeof window !== 'undefined' && window.aria` pattern. Fire-and-forget — no await, setTranscript remains synchronous.

## Known Remaining Gap

**VoiceIntentRouter is unwired.** `src/main/voice/VoiceIntentRouter.ts` exists and handles triage/schedule/draft intents but is currently invoked nowhere — all normal turns go directly to `streamVoiceAnswer` (RAG /ask pipeline) via `voiceSessionManager.startAnswer`. Multi-intent routing is a separate Phase-17 follow-up task.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pre-existing test assertion mismatch: startTurn-while-speaking**
- **Found during:** Task 1 (running spec)
- **Issue:** The test `startTurn() is blocked (no-op) while state === speaking` expected state to remain 'speaking' after `startTurn()`. But D-01 changed `startTurn()`-while-speaking to call `bargeIn()` (which transitions to idle), making the test fail. The test title said "no-op" but the spec's comment said "must be rejected" — ambiguous, and the implementation chose barge-in.
- **Fix:** Updated test title and assertions to reflect D-01 barge-in behaviour (transitions to idle, micGated=false)
- **Files modified:** `src/renderer/features/voice/useVoiceSession.spec.ts`
- **Commit:** 751d40a

**2. [Rule 3 - Blocking] EBUSY on setup-native-abi.ts setup() prevented all vitest runs**
- **Found during:** Task 1 (running spec)
- **Issue:** With Electron processes running, `better_sqlite3.node` (the destination) and `better_sqlite3.node-node` (the source) are both OS-locked. `copyFileSync` fails with EBUSY, crashing the globalSetup and blocking ALL test runs including pure renderer specs that don't use SQLite.
- **Fix:** Made `setup()` EBUSY-tolerant — try direct copy, fall back to buffer-read+write, if destination also EBUSY then warn and continue (non-SQLite tests proceed). Mirrors the existing EBUSY tolerance in `teardown()`.
- **Files modified:** `tests/setup-native-abi.ts`
- **Commit:** 751d40a

## Test Results

- 14 tests total (10 pre-existing + 4 new voiceFeedAnswer routing tests)
- 14/14 passing
- Typecheck: 84 errors (baseline unchanged, 0 new)

## Self-Check: PASSED

- src/renderer/features/voice/useVoiceSession.ts modified: confirmed
- src/renderer/features/voice/useVoiceSession.spec.ts modified: confirmed (4 new tests)
- tests/setup-native-abi.ts modified: confirmed (EBUSY tolerance)
- Commit 751d40a exists: confirmed
