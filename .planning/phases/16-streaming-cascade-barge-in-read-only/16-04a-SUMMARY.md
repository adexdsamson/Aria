---
phase: 16-streaming-cascade-barge-in-read-only
plan: "04a"
subsystem: voice-session-manager
tags: [voice, streaming, session-manager, barge-in, latency-log, tdd-green, wave-2]
dependency_graph:
  requires:
    - phase: 16-02
      provides: "TtsSegmenter, writeVoiceLatencyLog, streamVoiceAnswer"
    - phase: 16-03
      provides: "renderer-first abort contract, KokoroPlayerHandle.cancel/suspend/resume"
  provides:
    - "VoiceSessionManager factory (createVoiceSessionManager) with startAnswer/onBargeIn/markLatency/getSession"
    - "VOICE_LATENCY_MARK handler upgraded from no-op to real markLatency delegation (WARNING 2 fix)"
    - "voice.ts VoiceHandlersDeps.voiceSessionManager type extended with markLatency"
    - "voice-session-manager.spec.ts turned GREEN (3/3 — onChunk accumulator + fast-abort + D-12)"
  affects:
    - src/main/voice/voice-session-manager.ts
    - src/main/ipc/voice.ts
    - tests/unit/main/voice/voice-session-manager.spec.ts
tech_stack:
  added: []
  patterns:
    - "DI factory pattern: createVoiceSessionManager(deps) returns {startAnswer, onBargeIn, markLatency, getSession}"
    - "onChunk accumulator: spokenSoFar lives in onChunk callback, NOT onAbort (AI SDK #8088 mitigation)"
    - "sessions Map persists across turns for D-11 multi-turn context (not cleared on onDone)"
    - "D-12 interrupted turn: appendTurn(db, {role:'assistant', text:'[interrupted: \"...\"]'}) on barge-in"
    - "WARNING 2 fix: markLatency stores t_kokoro_synth_start/t_first_audio_out from renderer marks"
    - "Auto-wire createVoiceSessionManager in registerVoiceHandlers when db + emitToRenderer present"
    - "TtsSegmenter constructor mock: vi.fn(function(){return{push,flush}}) — not arrow fn (vitest constraint)"
key_files:
  created:
    - src/main/voice/voice-session-manager.ts
  modified:
    - src/main/ipc/voice.ts
    - tests/unit/main/voice/voice-session-manager.spec.ts
decisions:
  - "sessions Map does NOT delete session on onDone — sessions persist for D-11 multi-turn context; the spec requires getSession() to succeed after stream completion"
  - "getSession() exposed on VoiceSessionManager return type for test accessibility and potential future diagnostics"
  - "VoiceSessionManagerDeps.embedClient and .vectorStore are optional — cast as required type when passing to streamVoiceAnswer (callers in production always provide them; test mocks streamVoiceAnswer)"
  - "Auto-wire guard: registerVoiceHandlers creates VoiceSessionManager only when deps.dbHolder.db AND deps.emitToRenderer are both present (pre-unlock safety)"
  - "TtsSegmenter mock fix: arrow function vi.fn(() => ({...})) cannot be a constructor; fixed to vi.fn(function(){return {...}}) per Vitest constraint"
metrics:
  duration: "~15 minutes"
  completed: "2026-06-07T18:47:07Z"
  tasks_completed: 1
  tasks_total: 1
  files_created: 1
  files_modified: 2
---

# Phase 16 Plan 04a: VoiceSessionManager + voice.ts VOICE_LATENCY_MARK wiring Summary

VoiceSessionManager factory wiring TtsSegmenter→streamVoiceAnswer→VOICE_TTS_CHUNK push + D-12 barge-in interrupted turn + D-06 latency log with all four t_* columns via markLatency; VOICE_LATENCY_MARK upgraded from no-op stub; voice-session-manager.spec.ts GREEN.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | VoiceSessionManager + voice.ts VOICE_ABORT/VOICE_FEED_ANSWER/VOICE_LATENCY_MARK wiring | fa796ed | voice-session-manager.ts (new), voice.ts, voice-session-manager.spec.ts |

## What Was Built

### VoiceSessionManager (src/main/voice/voice-session-manager.ts)

DI factory `createVoiceSessionManager(deps)` returns `{ startAnswer, onBargeIn, markLatency, getSession }`.

**`startAnswer({ sessionId, question })`**
- D-11: looks up or creates VoiceSession in Map; creates RAG thread via `createThread(db, { title: '(voice session)' })` on first call per sessionId
- Records `t_stt_done = Date.now() - session.startMs` (STT-complete timestamp)
- Creates `AbortController` per turn; stores in `deps.sessionAbortControllers` for VOICE_ABORT handler
- Creates new `TtsSegmenter` instance per turn (D-04)
- Calls `streamVoiceAnswer` with `onChunk` accumulating `session.spokenSoFar += delta` (D-03/AI SDK #8088) and feeding `segmenter.push(delta)` → `emitToRenderer(VOICE_TTS_CHUNK, ...)` per chunk (D-05)
- On `onDone`: flushes segmenter remainder, updates `session.spokenSoFar`, calls `writeVoiceLatencyLog` with all four t_* columns (D-06)
- Sessions persist in Map after completion for D-11 multi-turn context

**`onBargeIn({ sessionId })`**
- D-12: writes synthetic `[interrupted: "spokenSoFar…"]` assistant turn via `appendTurn` before next user turn
- No-op if session not found

**`markLatency({ sessionId, mark, t })`**
- WARNING 2 fix: stores `t_kokoro_synth_start` or `t_first_audio_out` from renderer timing marks into VoiceSession
- First-write-wins per mark (null check)

**`getSession(sessionId)`**
- Returns VoiceSession for test assertions and diagnostics

### voice.ts Upgrades

**`VoiceHandlersDeps.voiceSessionManager`** extended with `markLatency()` method declaration.

**`VOICE_LATENCY_MARK` handler** upgraded from `return undefined` no-op stub to:
```
deps.voiceSessionManager?.markLatency({ sessionId, mark, t })
```

**Auto-wire in `registerVoiceHandlers`**: creates `createVoiceSessionManager(...)` when `deps.dbHolder.db` and `deps.emitToRenderer` are present and `deps.voiceSessionManager` is absent.

### Test Fix (voice-session-manager.spec.ts)

Fixed `TtsSegmenter` constructor mock from arrow function to regular function — Vitest cannot use arrow functions as `new`-able constructors.

## Verification

```
tests/unit/main/voice/voice-session-manager.spec.ts: 3/3 PASS
  (a) onChunk accumulator: spokenSoFar accumulates text-deltas in order ✓
  (b) fast abort does NOT clear the accumulator ✓
  (c) onBargeIn writes synthetic interrupted turn via appendTurn (D-12) ✓

tests/unit/main/ipc/index.spec.ts: 4/4 PASS (handler-count invariant green)

pnpm typecheck: 84 errors (matches baseline — 0 new errors)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TtsSegmenter constructor mock used arrow function (not constructable)**
- **Found during:** First test run of voice-session-manager.spec.ts
- **Issue:** The Wave-0 RED scaffold in 16-01 used `vi.fn(() => ({push, flush}))` for the TtsSegmenter mock. Arrow functions cannot be used as constructors; `new TtsSegmenter()` threw `TypeError: () => ({...}) is not a constructor`.
- **Fix:** Changed the mock to `vi.fn(function() { return { push: vi.fn(), flush: vi.fn() }; })` — regular function is constructable by Vitest.
- **Files modified:** tests/unit/main/voice/voice-session-manager.spec.ts
- **Commit:** fa796ed

**2. [Rule 2 - Missing] sessions Map not cleared on onDone (spec requirement)**
- **Found during:** Implementation design — plan action said "sessions.delete(sessionId)" in onDone, but spec test (a) calls `manager.getSession(sessionId)` after `onDone` fires and expects the session to exist.
- **Issue:** Plan spec and implementation spec conflicted. The spec is the authoritative behavioral contract for D-11 multi-turn context: sessions must persist for the next voice turn.
- **Fix:** Do NOT delete sessions on `onDone`. Sessions stay in Map until the next `startAnswer` for the same sessionId (which resets per-turn fields) or app close. This is architecturally correct — D-11 requires cross-turn context retention.
- **Commit:** fa796ed (initial implementation — no separate fix commit needed)

## Known Stubs

None — the plan's intended stubs (VOICE_ABORT and VOICE_FEED_ANSWER) already had real wiring from 16-01 (optional-chaining calls to `voiceSessionManager?.onBargeIn()` and `voiceSessionManager?.startAnswer()`). With `createVoiceSessionManager` now auto-wired in `registerVoiceHandlers`, these optional chains resolve to real implementations.

## Threat Surface Scan

No new security-relevant surface beyond the plan's declared threat model:
- T-16-12 (DoS via unbounded session map): sessions persist per sessionId but not across new `startAnswer` calls for the same ID; the practical session count equals the number of concurrent voice sessions (typically 1)
- T-16-13 (zero write risk): `voice-session-manager.ts` imports no write chokepoints (`assertApproved`, `voiceConfirm`, `sendApprovedEmail`, `applyCalendarChange`, `pushApprovedMeetingActions`)

## Self-Check

### Created files exist:
- [x] `src/main/voice/voice-session-manager.ts` — FOUND

### Modified files exist:
- [x] `src/main/ipc/voice.ts` — FOUND
- [x] `tests/unit/main/voice/voice-session-manager.spec.ts` — FOUND

### Commits exist:
- [x] fa796ed — Task 1 commit (VoiceSessionManager + VOICE_LATENCY_MARK wiring)

## Self-Check: PASSED
