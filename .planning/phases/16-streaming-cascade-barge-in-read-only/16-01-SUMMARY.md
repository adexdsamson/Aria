---
phase: 16-streaming-cascade-barge-in-read-only
plan: "01"
subsystem: voice-ipc-contract
tags: [voice, ipc, migration, tdd-scaffold, wave-0]
dependency_graph:
  requires: []
  provides:
    - CHANNELS.VOICE_TTS_CHUNK + CHANNELS.VOICE_ABORT + CHANNELS.DIAGNOSTICS_VOICE_LATENCY + CHANNELS.VOICE_FEED_ANSWER + CHANNELS.VOICE_LATENCY_MARK
    - VoiceLatencyLogRow interface in ipc-contract.ts
    - migration 136 voice_latency_log (D-06 telemetry table)
    - RED failing scaffolds for tts-segmenter, voice-latency-log, voice-session-manager, useReadAloudQueue
  affects:
    - src/shared/ipc-contract.ts
    - src/preload/index.ts
    - src/main/ipc/voice.ts
    - src/main/ipc/index.ts
    - src/main/db/migrations/embedded.ts
tech_stack:
  added: []
  patterns:
    - onVoiceTtsChunk push override mirrors onVoiceTranscript pattern (ipcRenderer.on + removeListener)
    - VOICE_LATENCY_MARK fire-and-forget stub (handler returns undefined)
    - VoiceHandlersDeps slot extension (sessionAbortControllers + voiceSessionManager optional slots)
    - handler-count invariant via Object.keys(CHANNELS).length (dynamic, no hardcoded count)
    - migration 136 appended at tail of EMBEDDED_MIGRATIONS (ascending version order maintained)
key_files:
  created:
    - src/main/db/migrations/136_voice_latency_log.sql
    - tests/unit/main/voice/tts-segmenter.spec.ts
    - tests/unit/main/voice/voice-latency-log.spec.ts
    - tests/unit/main/voice/voice-session-manager.spec.ts
    - tests/unit/renderer/voice/useReadAloudQueue.spec.ts
  modified:
    - src/shared/ipc-contract.ts
    - src/preload/index.ts
    - src/main/ipc/voice.ts
    - src/main/ipc/index.ts
    - src/main/db/migrations/embedded.ts
decisions:
  - "VOICE_LATENCY_MARK registered as ipcMain.handle(no-op) in both voice.ts and ipc/index.ts stubs (satisfies handler-count invariant while real timing handler lands in 16-04a)"
  - "migration 136 appended at tail of EMBEDDED_MIGRATIONS array (after 135, maintains ascending version order for correct new-install application)"
  - "better-sqlite3-multiple-ciphers used in voice-latency-log.spec.ts (not better-sqlite3 — matches project convention)"
  - "voice-session-manager.spec.ts mocks all collaborators (streamVoiceAnswer, createThread, appendTurn, TtsSegmenter, writeVoiceLatencyLog) via vi.mock — no real DB needed for RED scaffold"
metrics:
  duration: "~25 minutes"
  completed: "2026-06-07T17:30:58Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 5
  files_modified: 5
---

# Phase 16 Plan 01: IPC Contract + Migration 136 + Wave-0 Spec Scaffolds Summary

Wave-0 contract foundation: 5 new IPC channels (VOICE_TTS_CHUNK, VOICE_ABORT, DIAGNOSTICS_VOICE_LATENCY, VOICE_FEED_ANSWER, VOICE_LATENCY_MARK), migration 136 voice_latency_log, stub handlers keeping handler-count invariant GREEN, and 4 failing RED spec scaffolds for Wave 1-2 pure-logic units.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | IPC contract — 5 new channels + preload push subscription | ae3096f | ipc-contract.ts, preload/index.ts |
| 2 | Migration 136 + stub handlers + handler-count invariant | 67f916f | 136_voice_latency_log.sql, embedded.ts, voice.ts, ipc/index.ts |
| 3 | Failing test scaffolds for Wave 1-2 units (RED) | 1ad1815 | 4 new spec files |

## What Was Built

### Task 1: IPC Contract
Added 5 new entries to `CHANNELS`, `CHANNEL_METHODS`, and `AriaApi`:
- `VOICE_TTS_CHUNK` ('aria:voice:tts-chunk') — main→renderer push, `onVoiceTtsChunk` subscription
- `VOICE_ABORT` ('aria:voice:abort') — renderer→main invoke, `voiceAbort(req)` method
- `DIAGNOSTICS_VOICE_LATENCY` ('aria:diagnostics:voice-latency') — renderer→main invoke, `diagnosticsVoiceLatency(req?)` method
- `VOICE_FEED_ANSWER` ('aria:voice:feed-answer') — renderer→main invoke, `voiceFeedAnswer(req)` method
- `VOICE_LATENCY_MARK` ('aria:voice:latency-mark') — renderer→main fire-and-forget, `voiceLatencyMark(req)` method

Defined `VoiceLatencyLogRow` interface inline in ipc-contract.ts (D-06 telemetry row shape, avoids circular import).

Added `onVoiceTtsChunk` push override in `preload/index.ts` mirroring the `onVoiceTranscript` pattern. The 4 renderer→main channels are auto-mapped by `buildApi()`, no manual override needed.

`pnpm typecheck`: 84 errors (matches 84-error baseline, 0 new errors).

### Task 2: Migration 136 + Stub Handlers
Created `src/main/db/migrations/136_voice_latency_log.sql` with `voice_latency_log` table (id, session_id, t_stt_done NOT NULL, t_llm_first_token/t_first_sentence_ready/t_kokoro_synth_start/t_first_audio_out nullable INTEGERs, recorded_at TEXT DEFAULT datetime('now')) + `idx_voice_latency_session` index. Appended as last entry in `EMBEDDED_MIGRATIONS` (ascending order preserved: 134→135→136).

Extended `VoiceHandlersDeps` in `voice.ts` with `sessionAbortControllers?: Map<string, AbortController>` and `voiceSessionManager?` slots for 16-04a wiring.

Added 5 stub handlers in `registerVoiceHandlers`:
1. `VOICE_TTS_CHUNK` — no-op returning `{ok:true}` (push direction is emitToRenderer, not ipcMain)
2. `VOICE_ABORT` — abort map lookup + `voiceSessionManager?.onBargeIn()` (D-02 abort + D-12)
3. `DIAGNOSTICS_VOICE_LATENCY` — stub returns `[]` (TODO: replace with readRecentVoiceLatencyLog in 16-02)
4. `VOICE_FEED_ANSWER` — calls `voiceSessionManager?.startAnswer()` or stubs `{ok:true}`
5. `VOICE_LATENCY_MARK` — no-op returning undefined (real handler in 16-04a)

Also registered matching stubs in `ipc/index.ts` Phase-16 block.

Handler-count invariant test: **4/4 PASS** (`Object.keys(CHANNELS).length = 154 === handlers.size`).

### Task 3: Failing Spec Scaffolds (RED)
Four spec files created, all failing with "Cannot find module" (correct RED failure):

- `tests/unit/main/voice/tts-segmenter.spec.ts` — D-04 hybrid segmenter (3 describe groups × 3+ it blocks; first-chunk regime, abbreviation deny-list, flush)
- `tests/unit/main/voice/voice-latency-log.spec.ts` — D-06 write function (4 it blocks; no-op without ARIA_DEBUG=1, inserts with ARIA_DEBUG=1, readRecent ordered desc, limit respected)
- `tests/unit/main/voice/voice-session-manager.spec.ts` — D-03/D-11/D-12 (3 it blocks: onChunk accumulator, fast-abort preserves accumulator per AI SDK #8088, onBargeIn writes interrupted turn via appendTurn)
- `tests/unit/renderer/voice/useReadAloudQueue.spec.ts` — D-05 queue (4 it blocks: in-order speaks, cancel resets queue, enqueue after cancel, speed passed to speak)

## Verification

- `pnpm typecheck`: 84 errors (baseline unchanged)
- Handler-count test (`tests/unit/main/ipc/index.spec.ts`): 4/4 PASS
- 4 spec scaffolds: all FAIL with "Cannot find module" (correct RED)
- Migration 136 in correct position (last in EMBEDDED_MIGRATIONS, version > 135)
- No `.todo()` or `.skip()` in spec files

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Migration 136 initially inserted at wrong position in EMBEDDED_MIGRATIONS**
- **Found during:** Task 2 — edit inserted 136 before 135 in the array
- **Issue:** EMBEDDED_MIGRATIONS array had 136 at index before 135, which would cause wrong application order on fresh DB installs
- **Fix:** Removed 136 from mid-array position, appended it at tail (after 135) to maintain ascending version order
- **Files modified:** src/main/db/migrations/embedded.ts
- **Commit:** 67f916f

**2. [Rule 1 - Bug] voice-latency-log.spec.ts used wrong sqlite package**
- **Found during:** Task 3 verification run
- **Issue:** Spec imported `better-sqlite3` directly but project uses `better-sqlite3-multiple-ciphers`; caused "Cannot find package 'better-sqlite3'" instead of the correct "Cannot find module voice-latency-log" RED failure
- **Fix:** Changed import to `better-sqlite3-multiple-ciphers` (matches all other test files using DB)
- **Files modified:** tests/unit/main/voice/voice-latency-log.spec.ts
- **Commit:** 1ad1815

## Known Stubs

The following stubs are intentional Wave-0 placeholders (real implementations land in later plans):

| Stub | File | Reason |
|------|------|--------|
| `DIAGNOSTICS_VOICE_LATENCY` returns `[]` | src/main/ipc/voice.ts | readRecentVoiceLatencyLog function created in Plan 16-02 |
| `VOICE_FEED_ANSWER` stubs when voiceSessionManager absent | src/main/ipc/voice.ts | VoiceSessionManager wired in Plan 16-04a |
| `VOICE_LATENCY_MARK` no-op | src/main/ipc/voice.ts | Real timing handler in Plan 16-04a |
| `VOICE_TTS_CHUNK` handler returns `{ok:true}` | src/main/ipc/voice.ts | Push direction (emitToRenderer) wired in 16-04a |

These stubs are required to satisfy the handler-count invariant and do not prevent the plan's goal (Wave-0 contract + RED scaffolds) from being achieved.

## Threat Surface Scan

No new security-relevant surface beyond what is declared in the plan threat model (T-16-01 through T-16-15). The 5 new IPC channels all have corresponding mitigations documented in the plan's threat register. No new write paths introduced.

## Self-Check

### Created files exist:
- [x] `src/main/db/migrations/136_voice_latency_log.sql` — FOUND
- [x] `tests/unit/main/voice/tts-segmenter.spec.ts` — FOUND
- [x] `tests/unit/main/voice/voice-latency-log.spec.ts` — FOUND
- [x] `tests/unit/main/voice/voice-session-manager.spec.ts` — FOUND
- [x] `tests/unit/renderer/voice/useReadAloudQueue.spec.ts` — FOUND

### Commits exist:
- [x] ae3096f — Task 1 commit
- [x] 67f916f — Task 2 commit
- [x] 1ad1815 — Task 3 commit

## Self-Check: PASSED
