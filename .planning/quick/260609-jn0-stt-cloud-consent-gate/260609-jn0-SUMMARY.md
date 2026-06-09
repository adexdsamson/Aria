---
phase: quick-260609-jn0
plan: "01"
subsystem: voice
tags: [cloud-stt, consent-gate, voice, ipc, prefs]

requires:
  - phase: quick-260609-htx
    provides: "cloud-stt.ts cloudTranscribe + cloud STT wiring skeleton"

provides:
  - "VOICE_FEED_AUDIO STT-audio routing gated on prefs.useCloud consent pref (not content classifier)"
  - "llmQueue removed from VoiceHandlersDeps + registerVoiceHandlers body"
  - "cloud-stt-routing.spec.ts rewritten with useCloud-pref-gated assertions"

affects: [voice, cloud-stt, ipc-voice]

tech-stack:
  added: []
  patterns:
    - "STT-audio routing is consent-gated (useCloud pref); shouldUseCloud() gates only the LLM-answer leg (audio precedes transcript)"

key-files:
  created: []
  modified:
    - src/main/ipc/voice.ts
    - src/main/index.ts
    - tests/unit/main/voice/cloud-stt-routing.spec.ts

key-decisions:
  - "STT-audio cloud routing is a consent gate only (prefs.useCloud===true) — no content classifier call possible at audio time because the transcript does not yet exist"
  - "shouldUseCloud() retained in cloud-stt.ts and VoiceHandlersDeps.cloudStt for the LLM-answer leg"
  - "llmQueue removed from VoiceHandlersDeps and index.ts call site — no longer needed in voice IPC after routing fix"

patterns-established:
  - "Audio-precedes-transcript: STT routing gates must be consent-only; per-utterance sensitivity can only gate post-transcript paths"

requirements-completed: [voice-cloud-stt-routing]

duration: 15min
completed: 2026-06-09
---

# Quick 260609-jn0: STT Cloud Consent Gate Summary

**VOICE_FEED_AUDIO cloud routing changed from broken content-classifier gate (always local) to consent-only gate (prefs.useCloud===true + modules resolved), fixing cloud STT silently falling back to local every turn**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-09T14:05Z
- **Completed:** 2026-06-09T14:20Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Fixed root cause: `shouldUseCloud('', llmQueue, prefs.useCloud)` was called with an empty string, classifying to confidence < 0.6, always returning false — cloud STT never fired even when useCloud=true
- Replaced faulty gate with `prefs.useCloud === true && cloudSttResolved != null && wavUtilsResolved != null` (synchronous, no await)
- Removed dead `llmQueue` surface: interface field, JSDoc, local const in `registerVoiceHandlers`, `PQueueLike` import, and call site in `index.ts`
- Rewrote spec: 3 tests now gate on `getVoicePrefs` useCloud pref (true/false/cloud-error fallback); `shouldUseCloud` is asserted NOT called in the audio leg

## Task Commits

1. **Task 1 + Task 2: consent-gate fix + spec rewrite** - `3f80e08` (fix)

## Files Created/Modified

- `src/main/ipc/voice.ts` - Replaced shouldUseCloud call with consent gate; removed llmQueue field/const/import
- `src/main/index.ts` - Removed `llmQueue: scheduler.queue` from registerVoiceHandlers call
- `tests/unit/main/voice/cloud-stt-routing.spec.ts` - Rewritten; gates on useCloud pref; 3/3 pass

## Decisions Made

- `shouldUseCloud()` is preserved in both `cloud-stt.ts` and `VoiceHandlersDeps.cloudStt.shouldUseCloud` — it remains correct for the LLM-answer leg where a transcript exists
- No architectural changes; the fix is surgical (3 edits in voice.ts + 1 edit in index.ts)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed llmQueue call site in index.ts**
- **Found during:** Task 1 (typecheck after voice.ts edits)
- **Issue:** `src/main/index.ts` still passed `llmQueue: scheduler.queue` to `registerVoiceHandlers`, causing TS2353 (property does not exist in type after interface field removal) — one new error above the 84 baseline
- **Fix:** Removed `llmQueue: scheduler.queue` line from the `registerVoiceHandlers` call in index.ts
- **Files modified:** src/main/index.ts
- **Verification:** `pnpm typecheck` returned to 84 errors
- **Committed in:** 3f80e08 (same atomic commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking: index.ts call site not listed in plan)
**Impact on plan:** Required for typecheck baseline. No scope creep — the line was directly caused by removing the interface field.

## Issues Encountered

- Electron was running during test execution, causing EBUSY on the native ABI swap in global setup. Killed Electron processes via PowerShell before re-running; tests passed 3/3.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints or auth paths introduced. The routing change reduces unintended data exfiltration risk (cloud STT now only fires on explicit consent, not silently).

## Self-Check: PASSED

- `src/main/ipc/voice.ts` — modified, committed in 3f80e08
- `src/main/index.ts` — modified, committed in 3f80e08
- `tests/unit/main/voice/cloud-stt-routing.spec.ts` — modified, committed in 3f80e08
- Commit 3f80e08 exists in git log
- typecheck: 84 errors (0 new)
- vitest: 3/3 pass

## Next Phase Readiness

- Cloud STT fires correctly when user has enabled it via VoiceSection disclosure (D-14 consent)
- Local sidecar remains the default (useCloud=false) and fallback path (cloud error)
- shouldUseCloud() ready for wiring to the LLM-answer leg in a future plan

---
*Phase: quick-260609-jn0*
*Completed: 2026-06-09*
