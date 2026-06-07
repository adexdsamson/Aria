---
phase: 16-streaming-cascade-barge-in-read-only
plan: "05"
subsystem: testing
tags: [vitest, static-ratchet, voice, security, ci]

# Dependency graph
requires:
  - phase: 16-04a
    provides: src/main/voice/ streaming modules (tts-segmenter, voice-session-manager, voice-latency-log)
  - phase: 16-04b
    provides: src/renderer/features/voice/ additions (useReadAloudQueue, VoiceHUDBand transport controls)
  - phase: 14-03
    provides: voice-routes-through-staging.spec.ts — the exact structural template
provides:
  - D-13 read-only static ratchet for Phase 16 voice streaming modules
  - CI guard preventing future write-chokepoint imports in either voice directory
affects: [phase-17-voice-confirm-writes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Static ratchet with two-directory walk — extend Phase-14 pattern to cover both main and renderer voice dirs"
    - "Chokepoint-definition exclusion — exclude the write-seam file itself (confirm.ts) from the caller-discipline scan"

key-files:
  created:
    - tests/static/voice-streaming-no-write.spec.ts
  modified: []

key-decisions:
  - "confirm.ts excluded from scan: it DEFINES voiceConfirm (it IS the chokepoint), not a caller of it; the ratchet guards callers"
  - "WRITE_CHOKEPOINTS extends Phase-14 set with assertApproved + voiceConfirm (5 total) per D-13"
  - "Single it() block with { file, chokepoint } pair offenders array — mirrors Phase-14 voice-routes-through-staging structure"

patterns-established:
  - "Phase-14 ratchet extension pattern: copy walk/stripComments/RE verbatim, add directories + chokepoints, exclude definition files"

requirements-completed: [VOICE-02, VOICE-03, VOICE-06]

# Metrics
duration: 15min
completed: 2026-06-07
---

# Phase 16 Plan 05: D-13 Read-Only Static Ratchet Summary

**D-13 static CI ratchet asserting Phase 16 voice streaming modules (src/main/voice/ + src/renderer/features/voice/) import no write chokepoints — extends the Phase-14 voice-routes-through-staging ratchet to the new streaming surface area**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-07T21:20:00Z
- **Completed:** 2026-06-07T21:35:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Created tests/static/voice-streaming-no-write.spec.ts — passes GREEN (1 test, 0 offenders)
- Walks both src/main/voice/ and src/renderer/features/voice/ with W-1 missing-dir guards
- Asserts none of 5 write chokepoints appear in production voice files: assertApproved, voiceConfirm, sendApprovedEmail, applyCalendarChange, pushApprovedMeetingActions
- All 20 static ratchets pass (70 tests total) — no regressions
- IPC handler count test unaffected (154/154 CHANNELS, 4/4 green)

## Task Commits

1. **Task 1: D-13 read-only static ratchet** - `a37a95d` (test)

## Files Created/Modified

- `tests/static/voice-streaming-no-write.spec.ts` — D-13 CI guard; walks both voice dirs; 5 write chokepoints asserted absent; W-1 missing-dir guard; test-file + confirm.ts exclusion filters

## Decisions Made

- `confirm.ts` excluded from the scan by filename pattern (`/voice/confirm.ts`): it IS the `voiceConfirm` write-seam definition (not a caller), so the identifier-boundary RE matches the function declaration itself. Excluding it keeps the ratchet's intent precise: guard callers, not the definition.
- Single `it()` block with `{ file, chokepoint }` pair offenders array chosen over one `it()` per chokepoint — mirrors the Phase-14 template structure more faithfully.
- `WRITE_CHOKEPOINTS` named (not `CHOKEPOINT_NAMES`) to distinguish from the Phase-14 array and make the Phase-16 extension intent explicit.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added confirm.ts exclusion after first run caught a false positive**
- **Found during:** Task 1 verification run
- **Issue:** `src/main/voice/confirm.ts` exports `voiceConfirm` — the identifier appears at its own function declaration. The identifier-boundary RE cannot distinguish definition from call-site, so the ratchet flagged the Phase-14 write-seam file itself as a "caller" of `voiceConfirm`.
- **Fix:** Added a filename exclusion `if (/[/\\]voice[/\\]confirm\.ts$/.test(f)) continue` after the test-file exclusion, with an inline comment explaining the Phase-14 write-seam definition context.
- **Files modified:** tests/static/voice-streaming-no-write.spec.ts
- **Verification:** Re-ran spec → 1 test GREEN; all 20 static ratchets GREEN (70/70)
- **Committed in:** a37a95d (same task commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - false positive bug in scan scope)
**Impact on plan:** Necessary correctness fix — the ratchet intent is to guard callers, not flag the write-seam's own function export. No scope creep.

## Issues Encountered

None beyond the Rule 1 auto-fix above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All 6 Phase 16 plans complete (01, 02, 03, 04a, 04b, 05)
- D-13 read-only guarantee now enforced at CI — any future Phase 17+ developer who accidentally imports a write chokepoint into a voice streaming module will see a failing static ratchet
- Phase 16 ready for `/gsd-verify-work`

## Known Stubs

None.

## Threat Flags

None — this plan adds only a test file with no new network, auth, file-access, or schema surface.

## Self-Check: PASSED

- [x] `tests/static/voice-streaming-no-write.spec.ts` exists
- [x] Commit `a37a95d` exists (`git log --oneline -1` confirms)
- [x] `npx vitest run tests/static/voice-streaming-no-write.spec.ts --no-file-parallelism` → 1 passed
- [x] `npx vitest run tests/static/ --no-file-parallelism` → 20 files, 70 tests passed
- [x] `npx vitest run tests/unit/main/ipc/index.spec.ts --no-file-parallelism` → 4 passed (handler count unchanged)

---
*Phase: 16-streaming-cascade-barge-in-read-only*
*Completed: 2026-06-07*
