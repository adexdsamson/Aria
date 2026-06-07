---
phase: 16-streaming-cascade-barge-in-read-only
plan: "02"
subsystem: voice-streaming
tags: [voice, tts, segmenter, latency-log, streaming, rag, answer-service]
dependency_graph:
  requires:
    - phase: 16-01
      provides: "IPC contract (CHANNELS.VOICE_TTS_CHUNK/VOICE_ABORT/DIAGNOSTICS_VOICE_LATENCY), migration 136 voice_latency_log, RED scaffolds for tts-segmenter and voice-latency-log"
  provides:
    - "TtsSegmenter class (D-04 hybrid first-chunk + sentence segmenter)"
    - "writeVoiceLatencyLog + readRecentVoiceLatencyLog (D-06 ARIA_DEBUG-gated latency writer)"
    - "streamVoiceAnswer standalone export in answer-service.ts (D-03 LOCAL-only streaming path)"
    - "DIAGNOSTICS_VOICE_LATENCY handler wired to readRecentVoiceLatencyLog (replaces [] stub)"
  affects:
    - src/main/voice/voice-session-manager.ts (Plan 16-04a consumes TtsSegmenter + streamVoiceAnswer + writeVoiceLatencyLog)
    - src/main/rag/answer-service.ts
    - src/main/ipc/voice.ts
tech_stack:
  added: []
  patterns:
    - "TtsSegmenter dual-regime: Regime 1 word-boundary flush (first ~8 words) → Regime 2 sentence accumulation with ABBREVIATION_RE deny-list"
    - "DECIMAL_RE guard prevents false sentence splits on numeric patterns like 3.14"
    - "voice-latency-log mirrors routingLog.ts structure exactly: module-level SQL constants, ARIA_DEBUG gate as first line of write function"
    - "streamVoiceAnswer as standalone module-level export (NOT inside createAnswerService, NOT in AnswerService interface)"
    - "spokenSoFar accumulated in onChunk callback, NOT onAbort (AI SDK #8088 mitigation)"
    - "AI SDK 6 text-delta chunk property is chunk.text (NOT chunk.textDelta as documented in RESEARCH.md)"
key_files:
  created:
    - src/main/voice/tts-segmenter.ts
    - src/main/voice/voice-latency-log.ts
  modified:
    - src/main/rag/answer-service.ts
    - src/main/ipc/voice.ts
    - tests/unit/main/voice/tts-segmenter.spec.ts (turned GREEN, no spec changes needed)
    - tests/unit/main/voice/voice-latency-log.spec.ts (turned GREEN, no spec changes needed)
key-decisions:
  - "AI SDK 6 text-delta chunk uses chunk.text not chunk.textDelta — auto-fixed at Task 3 (Rule 1)"
  - "streamVoiceAnswer retrieval failure path persists empty assistant turn (graceful degradation vs silent drop)"
  - "StreamVoiceAnswerArgs excludes db (deps already carries it); cleaner than duplicating the param"
  - "DIAGNOSTICS_VOICE_LATENCY handler upgraded inline in voice.ts with db-null guard + limit passthrough"
requirements-completed: [VOICE-03, VOICE-06]

# Metrics
duration: 23min
completed: "2026-06-07"
---

# Phase 16 Plan 02: TtsSegmenter + voice-latency-log + streamVoiceAnswer Summary

**D-04 hybrid first-chunk segmenter (abbreviation + decimal deny-list), D-06 ARIA_DEBUG-gated latency log, and D-03 LOCAL-only streamText streaming path alongside existing ask() — all three Wave-1 pure-logic units, no Electron/IPC dependencies.**

## Performance

- **Duration:** ~23 min
- **Started:** 2026-06-07T18:38:27Z
- **Completed:** 2026-06-07T19:02:04Z
- **Tasks:** 3
- **Files modified:** 4 (2 new + 2 modified)

## Accomplishments

- TtsSegmenter class with dual-regime segmenter: Regime 1 flushes ~8-word fragment on word boundary (first-audio SC2 driver), Regime 2 accumulates full sentences with ABBREVIATION_RE (Mr/Mrs/Dr/Prof/Sr/Jr/vs/etc/i.e/e.g.) + DECIMAL_RE deny-list
- writeVoiceLatencyLog / readRecentVoiceLatencyLog mirroring routingLog.ts structure, gated by ARIA_DEBUG=1 with safeLimit [1,1000]; DIAGNOSTICS_VOICE_LATENCY handler wired to real reader
- streamVoiceAnswer standalone export in answer-service.ts: LOCAL-route only, 4096-char cap, onChunk accumulator for spokenSoFar (AI SDK #8088 mitigation), appendTurn for both user and assistant roles, abortSignal wired

## Task Commits

1. **Task 1: TtsSegmenter — D-04 hybrid first-chunk + sentence segmenter** - `3b0d5e9` (feat)
2. **Task 2: voice-latency-log — D-06 ARIA_DEBUG-gated writer + reader** - `df61858` (feat)
3. **Task 3: streamVoiceAnswer — D-03 streaming LLM path alongside ask()** - `5b92abc` (feat)

## Files Created/Modified

- `src/main/voice/tts-segmenter.ts` — TtsSegmenter class: dual-regime push() + flush(); ABBREVIATION_RE + DECIMAL_RE deny-lists; pure TypeScript, zero electron/ai imports
- `src/main/voice/voice-latency-log.ts` — writeVoiceLatencyLog (ARIA_DEBUG-gated) + readRecentVoiceLatencyLog; mirrors routingLog.ts structure exactly
- `src/main/rag/answer-service.ts` — StreamVoiceAnswerArgs interface + streamVoiceAnswer function added after createAnswerService; ask() entirely unchanged
- `src/main/ipc/voice.ts` — DIAGNOSTICS_VOICE_LATENCY handler upgraded from `return []` stub to real readRecentVoiceLatencyLog call with db-null guard

## Decisions Made

- streamVoiceAnswer does NOT receive `db` in args (it's in deps); avoids redundant parameter
- Retrieval failure path in streamVoiceAnswer writes an empty assistant turn (graceful degradation, not silent skip) so D-12 barge-in context is never confused by a missing turn
- DIAGNOSTICS_VOICE_LATENCY handler upgraded inline in voice.ts (not deferred) as specified in plan Task 2 action

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] AI SDK 6 text-delta chunk property is chunk.text, not chunk.textDelta**
- **Found during:** Task 3 (streamVoiceAnswer implementation)
- **Issue:** PATTERNS.md and RESEARCH.md document the onChunk accumulator as `chunk.textDelta`, but the actual AI SDK 6 `TextStreamPart` type for `text-delta` uses `{ type: 'text-delta'; id: string; text: string }` — no `textDelta` property exists. TypeScript caught this during typecheck (TS2339: Property 'textDelta' does not exist).
- **Fix:** Changed `chunk.textDelta` → `chunk.text` in both the spokenSoFar accumulator and the onChunk callback
- **Files modified:** src/main/rag/answer-service.ts
- **Verification:** pnpm typecheck: 84 errors (baseline unchanged, no new errors)
- **Committed in:** 5b92abc (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 Rule 1 bug)
**Impact on plan:** Critical correctness fix — without it, spokenSoFar would remain empty and onChunk would never be called (undefined property access returns undefined in JS, silently failing the accumulator). No scope creep.

## Issues Encountered

- tts-segmenter.spec.ts "does NOT split on Dr. Smith" test failed on first run (1 of 9). Root cause: ABBREVIATION_RE was being tested against text including the punctuation character (`upToPunct = buffer.slice(lastEnd, match.index + 1)`), but ABBREVIATION_RE matches word like "Dr" (without dot). Fixed by testing `beforePunct = buffer.slice(lastEnd, match.index)` — the text before the period, not including it. Resolved in the same implementation iteration (no deviation filing needed, caught during GREEN step before commit).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 16-04a (wave 2): voice-session-manager.ts can now import TtsSegmenter, streamVoiceAnswer, and writeVoiceLatencyLog — all three Wave-1 building blocks are committed
- voice-session-manager.spec.ts stays RED (scaffolded in 16-01) — turns GREEN in 16-04a
- ask() in answer-service.ts is entirely unchanged; 132/132 RAG tests pass

## Threat Surface Scan

No new security-relevant surface beyond the plan's threat model:
- T-16-04 (streamVoiceAnswer prompt injection): 4096-char cap implemented and verified
- T-16-05 (LOCAL-route scope): streamVoiceAnswer uses buildLocalPrompt only; no buildFrontierPrompt/tokenizeForFrontier in the voice path
- T-16-06 (voice_latency_log): write function confirmed debug-gated (ARIA_DEBUG !== '1' returns immediately)

## Self-Check

### Created files exist:
- [x] `src/main/voice/tts-segmenter.ts` — FOUND
- [x] `src/main/voice/voice-latency-log.ts` — FOUND

### Commits exist:
- [x] 3b0d5e9 — Task 1 TtsSegmenter
- [x] df61858 — Task 2 voice-latency-log
- [x] 5b92abc — Task 3 streamVoiceAnswer

## Self-Check: PASSED
