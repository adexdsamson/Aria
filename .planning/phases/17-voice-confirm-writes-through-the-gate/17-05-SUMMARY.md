---
phase: 17-voice-confirm-writes-through-the-gate
plan: "05"
subsystem: voice
tags: [voice, confirm, approvals, ipc, state-machine, tdd, d-04, d-06, d-10, d-11, d-12]

# Dependency graph
requires:
  - phase: 17-01
    provides: 'cancelled' state + IPC channel stubs (VOICE_CONFIRM/CANCEL_APPROVAL)
  - phase: 17-03
    provides: VoiceIntentRouter stages 'ready' rows + buildReadBackText() template
  - src/main/voice/confirm.ts
    provides: voiceConfirm() dormant seam (now wired live)
  - src/main/approvals/gate.ts
    provides: assertApproved + voice-forbidden-forced HARD GATE backstop
provides:
  - src/main/ipc/voice.ts: Real VOICE_CONFIRM_APPROVAL + VOICE_CANCEL_APPROVAL handlers
  - src/main/ipc/voice.ts: handleVoiceConfirmApproval() + handleVoiceCancelApproval() exported fns
  - src/main/voice/voice-session-manager.ts: confirmRepromptCount per-session + recordConfirmAmbiguous/resetConfirmReprompt
  - src/renderer/features/voice/useVoiceSession.ts: pendingApprovalId state + updated bargeIn/setTranscript + setPendingApproval/clearPendingApproval
  - src/renderer/features/voice/useVoiceConfirm.ts: useVoiceConfirm() hook (triggerReadBack/cancel)
  - tests/integration/voice-confirm.spec.ts: 10-test integration suite
affects:
  - 17-06: ApprovalCard imports useVoiceConfirm; voice-confirm affordance + Cancel button use these hooks
  - 17-07: ratchet update should reference these as the correct voice→write seams

# Tech tracking
tech-stack:
  added: []
  patterns:
    - TDD: test(17-05) RED → feat(17-05) GREEN × 2 (3 commits)
    - generateObject + Zod ConfirmIntentSchema for confirm-classifier (D-06, same as sensitivityClassifier)
    - vi.hoisted() for mock initialization to avoid TDZ hoisting issue in integration tests
    - pendingApprovalId ref in useVoiceSession to distinguish confirm-turn from normal-turn (Pitfall 4 guard)
    - bargeIn() extended: checks pendingApprovalId before voiceAbort (cancel-approval-then-abort pattern)
    - Rule 1 fix: VoicePTTButton.spec.tsx mock updated for new required interface fields

key-files:
  created:
    - src/renderer/features/voice/useVoiceConfirm.ts
    - tests/integration/voice-confirm.spec.ts
  modified:
    - src/main/ipc/voice.ts
    - src/main/voice/voice-session-manager.ts
    - src/renderer/features/voice/useVoiceSession.ts
    - src/shared/ipc-contract.ts
    - src/renderer/features/voice/VoicePTTButton.spec.tsx

key-decisions:
  - "Exported handleVoiceConfirmApproval() + handleVoiceCancelApproval() as standalone functions so integration tests can call them without full IPC scaffolding"
  - "classifyConfirmUtterance() defaults to 'ambiguous' on LLM failure (T-17-13: never auto-confirm on error)"
  - "pendingApprovalId cleared immediately in setTranscript before IPC dispatch (fire-and-forget pattern, same as bargeIn voiceAbort)"
  - "useVoiceConfirm hook uses a ref (not state) for pendingApprovalId to avoid re-render cycle on set/clear"
  - "voiceConfirmApproval IPC signature extended with transcript?: string in ipc-contract.ts"

requirements-completed:
  - VOICE-09
  - VOICE-11

# Metrics
duration: 41min
completed: 2026-06-08
---

# Phase 17 Plan 05: VOICE_CONFIRM/CANCEL_APPROVAL + Confirm Classifier + useVoiceConfirm Summary

**VOICE_CONFIRM_APPROVAL handler wired live via voiceConfirm seam; confirm-classifier (generateObject+Zod {confirm|cancel|ambiguous}); pendingApprovalId in useVoiceSession for bargeIn-to-cancel; useVoiceConfirm hook created**

## Performance

- **Duration:** 41 min
- **Started:** 2026-06-08T15:58:58Z
- **Completed:** 2026-06-08T16:40:01Z
- **Tasks:** 2 (TDD: 3 commits — test RED → feat GREEN × 2)
- **Files created:** 2, modified: 5

## Accomplishments

### Task 1: Real VOICE_CONFIRM_APPROVAL + VOICE_CANCEL_APPROVAL handlers + confirm classifier

Updated `src/main/ipc/voice.ts`:
- Replaced VOICE_CONFIRM_APPROVAL stub with real `handleVoiceConfirmApproval()` (exported for testing)
- Confirm-classifier via `generateObject` + Zod `ConfirmIntentSchema { intent: enum(['confirm','cancel','ambiguous']) }`
- `'confirm'` intent → `voiceConfirm(db, approvalId)` (stamps `ready→approved, approval_path='voice-explicit'`) → write dispatch by kind
- `'cancel'` intent → `transitionTo(db, approvalId, 'cancelled')`, returns `{ ok, cancelled: true }`
- `'ambiguous'` intent → returns `{ ok, needsRePrompt: true }` (T-17-13: never auto-execute on hedged utterance)
- Classifier failure → defaults to `'ambiguous'` (fail-safe: never auto-confirm on LLM error)
- Row existence + 'ready' state check BEFORE classifier (returns `{ error: 'not-found' }` early)
- Replaced VOICE_CANCEL_APPROVAL stub with real `handleVoiceCancelApproval()` (exported)

Updated `src/main/voice/voice-session-manager.ts`:
- Added `confirmRepromptCount: number` to `VoiceSession` interface (D-06 re-prompt loop counter)
- New methods: `recordConfirmAmbiguous(sessionId)` → increments counter, returns new count; `resetConfirmReprompt(sessionId)` → resets to 0
- VoiceSessionManager interface extended with both methods

Created `tests/integration/voice-confirm.spec.ts`:
- 10 integration tests using real in-memory SQLite (migration 137)
- Covers: confirm→approved, cancel→cancelled, ambiguous→needsRePrompt, not-found, already-terminal, forced→voice-forbidden-forced, assertApproved throws not-approved for cancelled rows
- Uses `vi.hoisted()` for generateObject mock to avoid TDZ hoisting issue

### Task 2: useVoiceSession pendingApprovalId + useVoiceConfirm hook

Updated `src/renderer/features/voice/useVoiceSession.ts`:
- `VoiceSessionState += pendingApprovalId: string | null` (default `null`)
- `bargeIn()` extended: when `pendingApprovalId !== null`, fires `voiceCancelApproval` IPC before existing `voiceAbort` (D-10: barge-in while awaiting-confirm aborts the staged approval)
- `setTranscript(text, final=true)` extended: when `pendingApprovalId !== null`, sends to `voiceConfirmApproval({ approvalId, transcript })` instead of normal `voiceFeedAnswer` path (Pitfall 4 guard)
- New actions: `setPendingApproval(approvalId)` + `clearPendingApproval()` for use by `useVoiceConfirm`

Created `src/renderer/features/voice/useVoiceConfirm.ts`:
- Exports `useVoiceConfirm(actions)` → `ConfirmControls { triggerReadBack, cancel, pendingApprovalId }`
- `triggerReadBack(approvalId, readBackText)`: sets sub-state + fires TTS read-back via `voiceFeedAnswer`
- `cancel()`: fires `voiceCancelApproval` IPC + clears sub-state + emits `aria:toast` custom event (D-12: "Cancelled — press to try again")

Updated `src/shared/ipc-contract.ts`:
- `voiceConfirmApproval` signature extended with `transcript?: string` (confirm-classifier path)

Updated `src/renderer/features/voice/VoicePTTButton.spec.tsx` (Rule 1):
- Added `pendingApprovalId: null`, `setPendingApproval: vi.fn()`, `clearPendingApproval: vi.fn()` to mock to satisfy updated VoiceSessionState/Actions interface

## Task Commits

Each task was committed atomically (TDD pattern):

1. **Task 1 RED: Add failing tests for VOICE_CONFIRM/CANCEL_APPROVAL handlers** - `140bc78` (test)
2. **Task 1 GREEN: real VOICE_CONFIRM/CANCEL_APPROVAL handlers + confirm classifier** - `57c3aae` (feat)
3. **Task 2: useVoiceSession pendingApprovalId + useVoiceConfirm hook** - `0d7ac6a` (feat)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] VoicePTTButton.spec.tsx mock missing new required fields**
- **Found during:** Task 2 (typecheck revealed 1 new error)
- **Issue:** VoicePTTButton.spec.tsx mock did not include `pendingApprovalId`, `setPendingApproval`, or `clearPendingApproval` added to VoiceSessionState/Actions
- **Fix:** Added the three fields to the `makeSession()` helper in the spec file
- **Files modified:** `src/renderer/features/voice/VoicePTTButton.spec.tsx`
- **Commit:** `0d7ac6a`

## Verification Results

| Check | Result |
|-------|--------|
| `voice-confirm.spec.ts` (integration) | 10/10 PASS |
| `tests/unit/renderer/voice/` | 22/22 PASS |
| Ratchet: voice modules cannot import raw write chokepoints | PASS (0 matches) |
| `pnpm typecheck` | 84 errors (baseline flat, 0 new) |
| `handleVoiceConfirmApproval` exported | confirmed |
| `handleVoiceCancelApproval` exported | confirmed |
| `useVoiceConfirm` hook exported | confirmed |
| `pendingApprovalId` in VoiceSessionState | confirmed |
| bargeIn() fires voiceCancelApproval when pendingApprovalId non-null | confirmed (integration test) |
| setTranscript routes to voiceConfirmApproval when pendingApprovalId non-null | confirmed (unit test) |
| forced/high-severity row → voice-forbidden-forced HARD GATE | confirmed (integration test) |

## Known Stubs

None — all handlers are real implementations. The `task_batch` write dispatch in `handleVoiceConfirmApproval` intentionally defers `pushApprovedMeetingActions` when DI deps are absent (same pattern as `email_send` which requires renderer-side GMAIL_SEND_APPROVED dispatch). This is documented in the handler comment.

## Threat Surface Scan

No new network endpoints or schema changes. The confirm-classifier is a local LLM call (`getLocalModel()`) — no new PII exposure. The `voiceConfirmApproval` IPC channel now routes through `voiceConfirm → assertApproved` — the Phase-14 HARD GATE (T-17-12: `voice-forbidden-forced`) remains the backstop for forced/high-severity rows.

## Self-Check: PASSED

- `src/renderer/features/voice/useVoiceConfirm.ts` exists: FOUND
- `tests/integration/voice-confirm.spec.ts` exists: FOUND
- `handleVoiceConfirmApproval` exported from `src/main/ipc/voice.ts`: FOUND
- `handleVoiceCancelApproval` exported from `src/main/ipc/voice.ts`: FOUND
- Commits `140bc78`, `57c3aae`, `0d7ac6a`: FOUND in git log

---
*Phase: 17-voice-confirm-writes-through-the-gate*
*Completed: 2026-06-08*
