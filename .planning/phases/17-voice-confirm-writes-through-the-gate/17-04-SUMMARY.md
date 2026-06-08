---
phase: 17-voice-confirm-writes-through-the-gate
plan: "04"
subsystem: voice
tags: [voice, cloud-stt, sensitivity-routing, ipc, prefs, settings-kv, tdd]

# Dependency graph
requires:
  - phase: 17-01
    provides: voice/prefs.ts KV foundation + VOICE_GET/SET_PREFS stubs
  - phase: 03-02
    provides: classify() sensitivity classifier (never-throws, Stage-3 fallback)
  - phase: 15-01
    provides: voice/prefs.ts settings KV pattern
  - package: ai@6
    provides: experimental_transcribe for cloud STT
  - package: "@ai-sdk/openai@3"
    provides: openai.transcription('whisper-1') model factory
provides:
  - cloudTranscribe() — OpenAI Whisper STT wrapper (never throws); returns {text}|{error}
  - shouldUseCloud() — per-turn fail-safe local gate (D-15); false when sensitive/low-confidence/unconsented
  - Real VOICE_GET_PREFS handler replacing Plan 01 stub
  - Real VOICE_SET_PREFS handler with Zod validation + D-14 consent KV audit
  - VoicePrefKey type exported from voice/prefs.ts
  - readVoicePref() exported from voice/prefs.ts
affects:
  - 17-05: VOICE_CONFIRM/CANCEL_APPROVAL handlers (can build independently)
  - 17-06: VoiceSection.tsx settings UI (reads VOICE_GET/SET_PREFS — now real)
  - future voice turns: shouldUseCloud() gates cloud STT path

# Tech tracking
tech-stack:
  added: []
  patterns:
    - TDD (RED → GREEN) for cloud-stt.ts
    - experimental_transcribe from ai@6 + openai.transcription('whisper-1') — no new deps
    - BG_GET/SET_PREFS mirror pattern for VOICE_GET/SET_PREFS
    - VoicePrefsPatchSchema.strict() Zod validation (T-17-10)
    - D-14 consent KV-only audit (action_audit_log is a VIEW — INSERT forbidden)

key-files:
  created:
    - src/main/voice/cloud-stt.ts
    - tests/unit/main/voice/cloud-stt.spec.ts
  modified:
    - src/main/ipc/voice.ts
    - src/main/voice/prefs.ts

key-decisions:
  - "cloudTranscribe() wraps experimental_transcribe + openai.transcription('whisper-1') — no new npm deps (D-13)"
  - "shouldUseCloud() is fail-safe local: any of useCloudPref=false, confidence<0.6, non-none category returns false (D-15)"
  - "D-14 consent recorded in settings KV only (voice.cloudAudio.consented + consentedAt) — action_audit_log is a VIEW, INSERT would fail at runtime"
  - "VoicePrefKey exported from prefs.ts so ipc/voice.ts handler can type-check cloudAudio.consented key"
  - "VOICE_SET_PREFS uses VoicePrefsPatchSchema.strict() to reject unknown keys (T-17-10 mitigation)"

# Metrics
duration: 54min
completed: 2026-06-08
---

# Phase 17 Plan 04: Cloud STT + Sensitivity Gate + Real Voice Prefs Handlers Summary

**Cloud STT wrapper (D-13) + per-turn fail-safe sensitivity gate (D-15) + real VOICE_GET/SET_PREFS replacing Plan 01 stubs (D-16), with D-14 consent audit in settings KV only**

## Performance

- **Duration:** ~54 min
- **Started:** 2026-06-08T14:43:00Z
- **Completed:** 2026-06-08T15:37:00Z
- **Tasks:** 2 (Task 1 TDD: 3 commits — RED/GREEN; Task 2: 1 commit)
- **Files modified:** 4

## Accomplishments

- `src/main/voice/cloud-stt.ts` created: `cloudTranscribe()` wraps `experimental_transcribe` from `ai@6` with `openai.transcription('whisper-1')`; never throws, returns `{text}` on success or `{error}` on API failure
- `shouldUseCloud()` implements the D-15 per-turn fail-safe local gate: returns false when `useCloudPref=false` (fast exit, no classify call), `confidence < 0.6`, or any category is non-`'none'`; returns true only when all conditions pass
- 9 unit tests in `tests/unit/main/voice/cloud-stt.spec.ts` cover all shouldUseCloud branches and cloudTranscribe success/error paths — all green
- `VOICE_GET_PREFS` stub upgraded to real handler (was already functional via `getVoicePrefs` delegate; comment updated)
- `VOICE_SET_PREFS` stub replaced with real handler: `VoicePrefsPatchSchema.strict()` Zod validation; per-key writes for `speed/voiceId/useCloud`; D-14 consent writes `voice.cloudAudio.consented='1'` + `voice.cloudAudio.consentedAt=ISO` on first `useCloud=true` (settings KV only — `action_audit_log` is a VIEW)
- `VoicePrefKey` type exported from `voice/prefs.ts`; `readVoicePref()` added for single-key reads
- Handler-count invariant: `index.spec.ts 4/4` green — no new CHANNELS entries (stubs already registered in Plan 01)
- Typecheck: 0 new errors (84 baseline unchanged)

## Task Commits

1. **Task 1 RED: Add failing tests for cloud-stt cloudTranscribe + shouldUseCloud** - `fd917f8` (test)
2. **Task 1 GREEN: cloudTranscribe() + shouldUseCloud() cloud STT gate** - `9765c74` (feat)
3. **Task 2: Real VOICE_GET_PREFS + VOICE_SET_PREFS handlers** - `9151252` (feat)

## Files Created/Modified

- `src/main/voice/cloud-stt.ts` — NEW: `cloudTranscribe()` D-13 whisper-1 wrapper; `shouldUseCloud()` D-15 fail-safe gate; `PQueueLike` type exported
- `tests/unit/main/voice/cloud-stt.spec.ts` — NEW: 9 tests (5 shouldUseCloud + 3 cloudTranscribe)
- `src/main/ipc/voice.ts` — Real VOICE_GET_PREFS + VOICE_SET_PREFS; `VoicePrefsPatchSchema` at module level; `z`, `writeVoicePref`, `readVoicePref` imports added
- `src/main/voice/prefs.ts` — `VoicePrefKey` exported; `readVoicePref()` added

## Decisions Made

- `PQueueLike` type is defined locally in `cloud-stt.ts` (minimal `{ add: <T>(fn) => Promise<T> }` subset) and exported for test compatibility — avoids importing p-queue just for the type
- D-14 consent check reads `readVoicePref(db, 'cloudAudio.consented')` before writing to avoid overwriting `consentedAt` on subsequent `useCloud=true` calls (idempotent consent record)
- `VoicePrefKey` type exported (was internal) so the handler can pass typed consent keys without `as any` casts — Rule 2 correctness requirement
- `VoicePrefsPatchSchema.strict()` bounds: `speed: z.number().min(0.5).max(2)` prevents payload tampering (T-17-10)
- `readVoicePref()` added as a thin exported wrapper around the internal `readStr()` — keeps `readStr` private, exposes only a typed key accessor

## Deviations from Plan

None — plan executed exactly as written. All success criteria met.

## Known Stubs

None — all stubs from Plan 01 that were in scope for this plan are now real implementations. VOICE_CONFIRM/CANCEL_APPROVAL remain as stubs; those are Plan 05's responsibility.

## Threat Surface Scan

No new network endpoints or auth paths introduced beyond what is documented in the plan's threat model:
- `cloudTranscribe()` sends audio to OpenAI Whisper — gated by `shouldUseCloud()` which enforces consent + sensitivity check
- `VOICE_SET_PREFS` payload validated via `VoicePrefsPatchSchema.strict()` before any DB write

---

## Self-Check

### Files Exist

- `src/main/voice/cloud-stt.ts` — FOUND
- `tests/unit/main/voice/cloud-stt.spec.ts` — FOUND
- `src/main/ipc/voice.ts` — FOUND (modified)
- `src/main/voice/prefs.ts` — FOUND (modified)

### Commits Exist

- `fd917f8` — FOUND (test RED)
- `9765c74` — FOUND (feat GREEN)
- `9151252` — FOUND (feat Task 2)

## Self-Check: PASSED

*Phase: 17-voice-confirm-writes-through-the-gate*
*Completed: 2026-06-08*
