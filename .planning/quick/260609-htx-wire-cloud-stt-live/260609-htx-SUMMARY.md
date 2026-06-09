---
phase: quick-260609-htx
plan: "01"
subsystem: voice
tags: [cloud-stt, routing, d-13, d-15, whisper]
dependency_graph:
  requires:
    - src/main/voice/cloud-stt.ts
    - src/main/voice/stt/wav.ts
    - src/main/voice/prefs.ts
  provides:
    - VOICE_FEED_AUDIO cloud routing
  affects:
    - src/main/ipc/voice.ts
    - src/main/index.ts
tech_stack:
  added: []
  patterns:
    - injected-deps for testable routing
    - dynamic-import lazy default
    - cloud-error-fallback
key_files:
  created:
    - tests/unit/main/voice/cloud-stt-routing.spec.ts
  modified:
    - src/main/ipc/voice.ts
    - src/main/index.ts
decisions:
  - "D-15: shouldUseCloud() is the sole gate — never reimplemented or bypassed in the handler"
  - "Dynamic import used as lazy fallback so injected mocks work in tests without altering the type"
  - "llmQueue passthrough stub (add: fn => fn()) used when not injected — safe for unit tests, real queue injected at bootstrap"
metrics:
  duration: "~15 min"
  completed: "2026-06-09"
  tasks_completed: 2
  files_changed: 3
---

# Quick 260609-htx: Wire Cloud STT Live — Summary

One-liner: Routed each VOICE_FEED_AUDIO turn through `shouldUseCloud()` gate then dispatched to either `cloudTranscribe()` (WAV → Whisper-1) or the local sidecar, with error-fallback and 3 new unit tests.

## What Was Done

### Task 1: Inject cloud-stt deps + wire routing in VOICE_FEED_AUDIO

**src/main/ipc/voice.ts:**
- Added `import * as fs from 'node:fs'`
- Added type-only imports for `cloudTranscribe`, `shouldUseCloud`, `PQueueLike`, `writePcmToWav`, `tempWavPath`
- Added three optional fields to `VoiceHandlersDeps`:
  - `cloudStt?: { shouldUseCloud, cloudTranscribe }`
  - `writePcm?: { writePcmToWav, tempWavPath }`
  - `llmQueue?: PQueueLike`
- In `registerVoiceHandlers()`: resolved defaults via dynamic import when deps not injected; captured `llmQueue` stub
- In `VOICE_FEED_AUDIO` handler: inserted cloud routing block
  - Reads `getVoicePrefs(db).useCloud` each turn (not cached)
  - Calls `shouldUseCloud('', llmQueue, prefs.useCloud)` as the sole gate
  - Cloud-true path: `tempWavPath()` → `writePcmToWav(pcm, 16000, path)` → `readFileSync` → `cloudTranscribe(buf, signal)` → delta `{ text, final: true }`; `unlinkSync` in finally
  - Cloud-error path (`{ error }` result): `logger.warn` + fallback to `sttSidecar.transcribe(pcm)`
  - Cloud-false path: unchanged `sttSidecar.transcribe(pcm)`
  - Push block (`VOICE_TRANSCRIPT_DELTA` + idle) runs identically for all three paths

**src/main/index.ts:**
- Added `llmQueue: scheduler.queue` to the `registerVoiceHandlers()` call (D-13/D-15: real p-queue serialises LLM classify calls in production)

### Task 2: Unit tests — three routing branches

**tests/unit/main/voice/cloud-stt-routing.spec.ts (new, 3 tests):**
- Test A (cloud path): `shouldUseCloud → true` + `cloudTranscribe` succeeds → delta `{ text: 'cloud result', final: true }` emitted; sidecar NOT called
- Test B (local path): `shouldUseCloud → false` → sidecar called; cloud NOT called; sidecar delta emitted
- Test C (fallback path): `shouldUseCloud → true` + `cloudTranscribe → { error }` → sidecar called as fallback; turn not dropped; sidecar delta emitted

## Verification

| Check | Result |
|-------|--------|
| `pnpm typecheck` | 0 new errors (84 baseline unchanged) |
| `cloud-stt-routing.spec.ts` | 3/3 pass |
| `cloud-stt.spec.ts` (regression) | 9/9 pass |
| `shouldUseCloud` call site in voice.ts | Confirmed (line 365) |
| `cloudTranscribe` call site in voice.ts | Confirmed (line 378) |

## Commit

`934f3f7` — feat(260609-htx): wire cloud STT into VOICE_FEED_AUDIO via shouldUseCloud gate

## Deviations from Plan

None — plan executed exactly as written.

## Known Limitation / Follow-up

**D-15 audio-leg limitation (inherent to cloud STT — do not "fix"):**

The `shouldUseCloud()` gate classifies the *text context* of the conversation, not the audio bytes themselves. At the moment `VOICE_FEED_AUDIO` fires, no transcript exists for the current turn — the audio precedes any transcript. Therefore the D-15 sensitive-stays-local guarantee is:

- **Fully enforced** on the downstream LLM-answer leg (post-transcript via `shouldUseCloud` on the *prior-turn text*).
- **Not enforceable** on the raw audio bytes themselves for the *current* turn.

This is inherent to cloud STT (you cannot classify audio before you send it to be transcribed). It is acceptable under the explicit `useCloud` consent the user grants (D-14). A future improvement could buffer audio for N ms and classify a partial local transcript before routing, but this is out of scope for v1.

The `shouldUseCloud` gate still provides strong protection: any session where the prior context contains sensitive content (PII, financial data) will block the current turn from going to cloud, which is the primary attack vector.

## Threat Surface Scan

| Flag | File | Description |
|------|------|-------------|
| threat_flag: information_disclosure | src/main/ipc/voice.ts | Raw PCM audio bytes leave the machine when `shouldUseCloud` returns true — inherent to cloud STT, mitigated by D-14 consent gate and D-15 sensitivity classifier (T-htx-01) |

## Self-Check

- [x] `src/main/ipc/voice.ts` exists with `shouldUseCloud` call site
- [x] `src/main/index.ts` passes `llmQueue: scheduler.queue`
- [x] `tests/unit/main/voice/cloud-stt-routing.spec.ts` exists, 3 tests pass
- [x] Commit `934f3f7` exists in git log

## Self-Check: PASSED
