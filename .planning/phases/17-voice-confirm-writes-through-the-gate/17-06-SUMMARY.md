---
phase: 17-voice-confirm-writes-through-the-gate
plan: "06"
subsystem: voice
tags: [voice, settings, approvals, ui, d-07, d-09, d-12, d-14, d-15, d-16, voice-08]

# Dependency graph
requires:
  - phase: 17-04
    provides: Real VOICE_GET/SET_PREFS handlers (Plan 04)
  - phase: 17-05
    provides: useVoiceConfirm.ts + voiceCancelApproval IPC (Plan 05)
  - phase: 17-01
    provides: 'cancelled' terminal state + isTerminal in ApprovalCard already updated
provides:
  - src/renderer/features/settings/VoiceSection.tsx: Voice settings panel (speed/voiceId/useCloud + consent modal)
  - src/renderer/features/settings/SettingsScreen.tsx: Voice tab wired in Behaviour NavSection
  - src/renderer/features/approvals/ApprovalCard.tsx: voice-confirm affordance + Cancel button for ready rows
affects:
  - 17-07: ratchet + integration test + human-verify wave

# Tech tracking
tech-stack:
  added: []
  patterns:
    - BehaviourSection.tsx editorial pattern (optimistic update + revert + error alert)
    - Modal editorial primitive for cloud consent disclosure (D-14)
    - pendingCloudEnableRef pattern to defer IPC write until consent confirmed
    - forceExplicit boolean gates VoiceConfirmButton (D-07)
    - voiceCancelApproval IPC direct call from Cancel button (D-09)

key-files:
  created:
    - src/renderer/features/settings/VoiceSection.tsx
  modified:
    - src/renderer/features/settings/SettingsScreen.tsx
    - src/renderer/features/approvals/ApprovalCard.tsx

key-decisions:
  - "VoiceSection cloudConsented tracked in local state only: VoicePrefsDto does not expose cloudAudio.consented; if useCloud=true is loaded from prefs on mount, cloudConsented is inferred as true (user must have consented previously)"
  - "pendingCloudEnableRef (useRef) defers the voiceSetPrefs write until user clicks 'I Understand, Enable' in modal — modal cancel leaves Checkbox unchecked (T-17-16 mitigated)"
  - "VoiceConfirmButton: disabled + opacity:0.35 when forceExplicit=true (D-07); Phase-14 HARD GATE is the backstop"
  - "Cancel button (D-09/D-12): uses voiceCancelApproval directly with approvalId; always visible for ready-state rows; does not require useVoiceConfirm hook in ApprovalCard (simpler — hook is for the voice session orchestration path)"

requirements-completed:
  - VOICE-05
  - VOICE-08

# Metrics
duration: 18min
completed: 2026-06-09
---

# Phase 17 Plan 06: VoiceSection Settings UI + ApprovalCard Voice-Confirm Integration Summary

**VoiceSection.tsx (D-16/VOICE-08): speed/voiceId/useCloud controls with cloud consent modal; ApprovalCard: 'Confirm by voice' button suppressed when forceExplicit (D-07) + always-visible Cancel button for ready rows (D-09/D-12)**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-06-09T00:10:00Z
- **Completed:** 2026-06-09T00:28:00Z
- **Tasks:** 2 (1 commit each)
- **Files created:** 1, modified: 2

## Accomplishments

### Task 1: VoiceSection.tsx settings panel

Created `src/renderer/features/settings/VoiceSection.tsx`:
- Editorial card pattern mirroring `BehaviourSection.tsx`: Playfair italic heading, mono header label, hairline divider rows, gold alert for errors
- **Speed select** (`data-testid="voice-speed-select"`): 0.75/1.0/1.25/1.5x options; writes via `VOICE_SET_PREFS({ speed })`
- **Voice ID input** (`data-testid="voice-id-input"`): Kokoro voice name override, labeled "experimental"; writes via `VOICE_SET_PREFS({ voiceId })`
- **Cloud audio Checkbox** (`data-testid="voice-cloud-toggle"`): first enable from `cloudConsented=false` → opens consent modal (`setConsentModalOpen(true)`) and defers IPC write via `pendingCloudEnableRef`
- **Cloud consent modal** (D-14, T-17-16): editorial `Modal` (size="sm") with "Data disclosure" eyebrow + "Cloud Audio Processing" title; itemized disclosure (what leaves device / recipient / retention / sensitivity override); "I Understand, Enable" + "Cancel" buttons. On confirm: `setCloudConsented(true)` + write `VOICE_SET_PREFS({ useCloud: true })`. On cancel: Checkbox stays unchecked, no IPC write.
- **D-15 guarantee line** (`data-testid="voice-cloud-local-guarantee"`): visible whenever `useCloud=true`, reads "Sensitivity-flagged turns always processed locally."
- All controls disabled while `loaded=false` (prevents race on mount)
- Optimistic update + revert on IPC error (same pattern as `BehaviourSection`)

Updated `src/renderer/features/settings/SettingsScreen.tsx`:
- Added `{ to: 'voice', label: 'Voice' }` to the Behaviour NavSection tabs array
- Added `<Route path="voice" element={<VoiceSection />} />` to the Routes block
- Import added

### Task 2: ApprovalCard voice-confirm affordance + Cancel button

Updated `src/renderer/features/approvals/ApprovalCard.tsx` (EmailApprovalCard variant):

**isTerminal check** — Already included `|| row.state === 'cancelled'` from Plan 17-01. No change needed.

**D-07 VoiceConfirmButton** (`data-testid="approval-voice-confirm-{id}"`):
- Rendered when `row.state === 'ready'`
- `disabled={busy || forceExplicit}` — suppressed for forced/high-severity rows
- `opacity: forceExplicit ? 0.35 : 1` — visual disabled cue
- `title` tooltip explains suppression when forced
- `onClick` calls `window.aria.voiceConfirmApproval({ approvalId: row.id, transcript: 'confirm' })` (pre-classified path)
- Phase-14 HARD GATE (`assertApproved throws voice-forbidden-forced`) is the backstop

**D-09/D-12 Cancel button** (`data-testid="approval-cancel-voice-{id}"`):
- Rendered when `row.state === 'ready'` — always-visible escape hatch
- `disabled={busy}` only
- `onClick` calls `window.aria.voiceCancelApproval({ approvalId: row.id })` (ready→cancelled)
- Label: "Cancel" (variant="ghost")
- Positioned between "Edit" and "Reject" in the button row

## Task Commits

1. **Task 1: VoiceSection.tsx settings panel + wired into SettingsScreen** - `ad9031b` (feat)
2. **Task 2: ApprovalCard voice-confirm affordance + Cancel button** - `a70750c` (feat)

## Files Created/Modified

- `src/renderer/features/settings/VoiceSection.tsx` — NEW: voice settings panel (speed/voiceId/useCloud + D-14 consent modal + D-15 guarantee)
- `src/renderer/features/settings/SettingsScreen.tsx` — voice tab added to Behaviour NavSection + Route wired
- `src/renderer/features/approvals/ApprovalCard.tsx` — VoiceConfirmButton (D-07 suppressed when forceExplicit) + Cancel button (D-09/D-12)

## Decisions Made

- `cloudConsented` tracked in local state only (not in VoicePrefsDto): if `useCloud=true` loads from prefs on mount, `cloudConsented` is inferred as true (user must have consented previously to get here)
- `pendingCloudEnableRef` (useRef, not useState) defers the IPC write until consent confirmed — avoids optimistic state update before consent
- Cancel button in ApprovalCard calls `voiceCancelApproval` directly rather than importing `useVoiceConfirm` hook — simpler path for the static "always-visible escape hatch" requirement (D-09); hook is for voice session orchestration context
- `isTerminal` already included `'cancelled'` from Plan 17-01 — no change needed in Task 2

## Deviations from Plan

None — plan executed exactly as written. `isTerminal` was already updated in Plan 17-01, which the plan notes. Both success criteria met.

## Known Stubs

None. `VoiceSection` wires to real `VOICE_GET/SET_PREFS` handlers from Plan 04. `ApprovalCard` Cancel button wires to real `VOICE_CANCEL_APPROVAL` handler from Plan 05.

## Threat Surface Scan

No new network endpoints. Threat mitigations applied:
- T-17-16 (Info Disclosure — cloud enabled without disclosure): Consent modal gates first `useCloud=true` toggle. Modal cancel leaves Checkbox unchecked. `pendingCloudEnableRef` ensures no IPC write without explicit "I Understand, Enable" click.
- T-17-17 (EoP — VoiceConfirmButton on forced row): `disabled={busy || forceExplicit}` + `opacity:0.35`. Phase-14 HARD GATE (`assertApproved voice-forbidden-forced`) is the structural backstop.

---

## Self-Check

### Files Exist

- `src/renderer/features/settings/VoiceSection.tsx` — FOUND
- `src/renderer/features/settings/SettingsScreen.tsx` (modified) — FOUND
- `src/renderer/features/approvals/ApprovalCard.tsx` (modified) — FOUND

### Commits Exist

- `ad9031b` (feat: VoiceSection + SettingsScreen) — verified
- `a70750c` (feat: ApprovalCard voice-confirm + Cancel) — verified

### Typecheck

- 84 errors (baseline flat, 0 new) — PASS

## Self-Check: PASSED

*Phase: 17-voice-confirm-writes-through-the-gate*
*Completed: 2026-06-09*
