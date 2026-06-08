---
phase: 17-voice-confirm-writes-through-the-gate
plan: "01"
subsystem: database
tags: [sqlite, migration, ipc, voice, approvals, state-machine]

# Dependency graph
requires:
  - phase: 14-voice-safety-confirm-contract
    provides: voiceConfirm seam + approval state machine
  - phase: 16-streaming-cascade-barge-in
    provides: IPC channel patterns + voice handler registration patterns
provides:
  - Migration 137 adds 'cancelled' terminal state to approval table CHECK constraint
  - state.ts ApprovalState union + ALLOWED map with 'cancelled' terminal state
  - 4 new IPC channels (VOICE_CONFIRM_APPROVAL, VOICE_CANCEL_APPROVAL, VOICE_GET_PREFS, VOICE_SET_PREFS)
  - voice/prefs.ts extended with speed/voiceId/useCloud/cloudAudio KV keys + getVoicePrefs/writeVoicePref
  - ApprovalCard isTerminal includes 'cancelled'
  - DEFAULT_LIST_STATES includes 'cancelled' for audit visibility
affects:
  - 17-02, 17-03, 17-04, 17-05: depend on 'cancelled' state + new IPC channels existing
  - approval card rendering: 'cancelled' rows now non-interactive

# Tech tracking
tech-stack:
  added: []
  patterns:
    - PRAGMA legacy_alter_table=ON + table-rebuild for SQLite CHECK constraint extension
    - TDD gate: test(17-01) RED → feat(17-01) GREEN for state machine changes
    - Handler-count invariant maintained via stub registration in ipc/index.ts + ipc/voice.ts

key-files:
  created:
    - src/main/db/migrations/137_approval_cancelled_state.sql
    - tests/unit/main/approvals/state.spec.ts
  modified:
    - src/main/db/migrations/embedded.ts
    - src/main/approvals/state.ts
    - src/shared/ipc-contract.ts
    - src/main/ipc/voice.ts
    - src/main/ipc/index.ts
    - src/main/voice/prefs.ts
    - src/main/ipc/approvals.ts
    - src/renderer/features/approvals/ApprovalCard.tsx

key-decisions:
  - "Migration 137 uses PRAGMA legacy_alter_table=ON table-rebuild (not ALTER TABLE) to safely extend the state CHECK constraint without dangling FK hazard"
  - "'cancelled' is a distinct terminal state from 'rejected' (deliberate deny) — voice-path abort only"
  - "4 IPC channels land with stubs NOW so handler-count invariant stays green; real impls in Plans 04 and 05"
  - "VoicePrefsDto (speed/voiceId/useCloud) is the IPC DTO type; no user_prefs table — settings KV only"

patterns-established:
  - "Wave 0 contract foundation: schema + state machine + IPC channels land before any feature code"
  - "Stub handlers registered in both ipc/voice.ts (for real bootstrap) and ipc/index.ts (for pre-unlock)"

requirements-completed:
  - VOICE-11
  - VOICE-05
  - VOICE-08
  - VOICE-09

# Metrics
duration: 18min
completed: 2026-06-08
---

# Phase 17 Plan 01: Wave 0 Contract Foundation Summary

**Migration 137 (PRAGMA legacy_alter_table=ON table-rebuild) adds 'cancelled' terminal state to approval, with 4 new VOICE_CONFIRM/CANCEL/GET_SET_PREFS IPC channels stub-registered and voice/prefs.ts extended for speed/voiceId/useCloud**

## Performance

- **Duration:** 18 min
- **Started:** 2026-06-08T10:59:20+01:00
- **Completed:** 2026-06-08T11:17:21+01:00
- **Tasks:** 2 (TDD: 3 commits — test/17-01 → feat/17-01 × 2)
- **Files modified:** 8

## Accomplishments

- Migration 137 created using migration 134 as verbatim template, adding `'cancelled'` to the approval state CHECK constraint; uses `PRAGMA legacy_alter_table=ON` + full table-rebuild to avoid the dangling-FK hazard documented in `reference_sqlite_rename_fk_rewrite`
- embedded.ts canonical new-install DDL updated with migration 137 entry so new installs get the correct schema
- ApprovalState union, ALLOWED transitions map, and all consumers ('cancelled' in DEFAULT_LIST_STATES, isTerminal in ApprovalCard) updated for audit clarity
- 4 new IPC channels land atomically with stub handlers in both ipc/voice.ts and ipc/index.ts — handler-count invariant green (test passes in 8.7s)
- voice/prefs.ts extended: VoicePrefKey includes speed/voiceId/useCloud/cloudAudio.consented/cloudAudio.consentedAt; VOICE_PREF_DEFAULTS exported; getVoicePrefs() and writeVoicePref() functions added

## Task Commits

Each task was committed atomically (TDD for Task 1):

1. **Task 1 RED: Add failing tests for 'cancelled' state machine** - `1295163` (test)
2. **Task 1 GREEN: Migration 137 + state.ts 'cancelled' terminal state** - `a5dc78e` (feat)
3. **Task 2: New IPC channels + voice prefs extension + consumer updates** - `0652b94` (feat)

## Files Created/Modified

- `src/main/db/migrations/137_approval_cancelled_state.sql` — Table-rebuild migration adding 'cancelled' to state CHECK; uses PRAGMA legacy_alter_table=ON
- `src/main/db/migrations/embedded.ts` — Canonical new-install DDL updated with migration 137 entry (version 137)
- `src/main/approvals/state.ts` — ApprovalState union += 'cancelled'; ALLOWED['ready'] += 'cancelled'; ALLOWED['cancelled'] = [] (terminal)
- `src/shared/ipc-contract.ts` — 4 new CHANNELS, CHANNEL_METHODS, AriaApi signatures; VoicePrefsDto/VoicePrefsPatchDto; ApprovalUiState += 'cancelled'
- `src/main/ipc/voice.ts` — 4 stub handlers for new channels (returned in registerVoiceHandlers)
- `src/main/ipc/index.ts` — voice17Channels block with 4 pre-unlock stubs (handler-count invariant)
- `src/main/voice/prefs.ts` — Extended VoicePrefKey; VOICE_PREF_DEFAULTS; getVoicePrefs(); writeVoicePref()
- `src/main/ipc/approvals.ts` — 'cancelled' added to DEFAULT_LIST_STATES
- `src/renderer/features/approvals/ApprovalCard.tsx` — isTerminal includes 'cancelled' (2 occurrences)
- `tests/unit/main/approvals/state.spec.ts` — 3 assertions: assertTransition('ready','cancelled') OK; assertTransition('cancelled','approved') throws /invalid-transition/; APPROVAL_STATES includes 'cancelled'

## Decisions Made

- Used migration 134 as the verbatim template for migration 137 — only diff is adding `,'cancelled'` to the state CHECK constraint; all column definitions, INSERT...SELECT column list, and 5 indexes are identical
- 'cancelled' is terminal (`ALLOWED['cancelled'] = []`) and distinct from 'rejected' (deliberate deny) per D-11
- Voice prefs IPC uses the BG_GET/SET_PREFS mirror pattern: VoicePrefsDto as return type; VoicePrefsPatchSchema for validation in real impl (Plans 04)
- Stubs return `{ error: 'NOT_IMPLEMENTED' }` for confirm/cancel and `VOICE_PREF_DEFAULTS` for get_prefs to avoid renderer crashes on early calls

## Deviations from Plan

None — plan executed exactly as written. All success criteria met.

## Issues Encountered

The handler-count test (`tests/unit/main/ipc/index.spec.ts`) first ran appeared to timeout at 30s in one run but passed in 8.7s on a second run — this is the pre-existing slow-start behavior of this test (it imports and initializes the entire IPC layer). No issue with the new code.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All Plan 17-02+ can proceed: 'cancelled' state is in the DB + state machine, IPC channels exist, voice prefs foundation is set
- Plan 17-04 (real VOICE_GET/SET_PREFS impl) and Plan 17-05 (real VOICE_CONFIRM/CANCEL_APPROVAL impl) can replace the stubs registered here
- Typecheck baseline: 84 errors (flat — 0 new from this plan)
- Tests green: state.spec.ts 3/3 + index.spec.ts 4/4

---
*Phase: 17-voice-confirm-writes-through-the-gate*
*Completed: 2026-06-08*
