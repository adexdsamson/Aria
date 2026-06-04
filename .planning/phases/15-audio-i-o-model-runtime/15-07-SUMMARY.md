---
phase: 15-audio-i-o-model-runtime
plan: "07"
subsystem: voice-ui
tags: [voice, ui, topbar, hud, ptt, accessibility, tdd, VOICE-01, VOICE-07]
dependency_graph:
  requires:
    - src/shared/voice-types.ts (VoiceState union — Plan 15-01)
    - src/renderer/features/voice/useVoiceSession.ts (state machine + micGated — Plan 15-06)
    - src/renderer/features/voice/capture/useMicCapture.ts (PTT drives start/stop — Plan 15-04)
    - src/renderer/components/editorial/StatusDot.tsx (wrapped by VoiceStatusDot — D-14)
  provides:
    - src/renderer/features/voice/VoiceStatusDot.tsx (Topbar mic state dot, D-14)
    - src/renderer/features/voice/VoiceHUDBand.tsx (in-flow live-transcription HUD, D-15)
    - src/renderer/features/voice/VoicePTTButton.tsx (hold+click-toggle PTT, D-10/D-11/D-12)
  affects:
    - src/renderer/app/App.tsx (VoiceHUDBand mounted in-flow before TrialBanner)
    - src/renderer/components/Topbar.tsx (VoicePTTButton + VoiceStatusDot in right cluster)
    - src/renderer/features/voice/useVoiceSession.ts (stopTurn + setVadMode added to interface)
    - Plan 15-08 (download UI + disabled-PTT affordance — separate file ownership)
    - Phase 16 (speaking state seam ready for streaming TTS cascade)
tech_stack:
  added: []
  patterns:
    - VoiceState→StatusDotKind mapping (wraps editorial StatusDot primitive, no new tokens)
    - grid-template-rows 0fr/1fr collapse/expand for HUD band (D-15)
    - Inline CSS @keyframes with prefers-reduced-motion guard (mirrors App.tsx gate-bar pattern)
    - _testSession prop injection for vitest compatibility (avoids vi.mock vitest-pool timeout)
    - VoicePTTButton Public/Core split (avoids conditional useVoiceSession hook call)
    - DOM keydown/keyup Space handler on window (hold-to-talk, D-10)
    - aria-live=polite + aria-atomic=false live region (D-15)
key_files:
  created:
    - src/renderer/features/voice/VoiceStatusDot.tsx
    - src/renderer/features/voice/VoiceStatusDot.spec.tsx
    - src/renderer/features/voice/VoiceHUDBand.tsx
    - src/renderer/features/voice/VoiceHUDBand.spec.tsx
    - src/renderer/features/voice/VoicePTTButton.tsx
    - src/renderer/features/voice/VoicePTTButton.spec.tsx
  modified:
    - src/renderer/app/App.tsx (VoiceHUDBandConnected mounted before TrialBanner)
    - src/renderer/components/Topbar.tsx (voice cluster in right cluster)
    - src/renderer/features/voice/useVoiceSession.ts (stopTurn + setVadMode added)
decisions:
  - "VoiceStatusDot: Processing spinner uses data-voice-spinner SVG attr for test selectability; suppressed under prefers-reduced-motion"
  - "VoiceHUDBand: grid-template-rows 0fr/1fr chosen over max-height (D-Claude discretion per RESEARCH.md); inner overflow:hidden wrapper required for grid-row collapse"
  - "VoicePTTButton: Public/Core split avoids conditional useVoiceSession hook (rules-of-hooks); _testSession prop avoids vi.mock vitest-pool timeout quirk"
  - "stopTurn/setVadMode added to VoiceSessionActions interface (Rule 2 auto-add — required by PTT button D-10/D-11 and missing from Plan 15-06)"
  - "Topbar VoicePTTButton uses testId='aria-topbar-ptt' prop; VoiceHUDBandConnected reads from useVoiceSession singleton"
  - "VoiceStatusDot uses data-voice-struck-mic attr for muted state test selectability"
metrics:
  duration: "~55 minutes"
  completed: "2026-06-03"
  tasks_completed: 3
  tasks_total: 3
  files_created: 6
  files_modified: 3
---

# Phase 15 Plan 07: Voice UI — Mic State Surface Summary

VoiceStatusDot (Topbar persistent dot) + VoiceHUDBand (in-flow live-transcription) + VoicePTTButton (hold+click-toggle PTT), wired into App.tsx shell and Topbar right cluster. VOICE-01 and VOICE-07 satisfied: mic state always visible, live transcription per utterance.

## Tasks Completed

| # | Task | Commit | Type |
|---|------|--------|------|
| 1 RED | VoiceStatusDot + VoiceHUDBand failing tests | 855e1f9 | test |
| 1 GREEN | VoiceStatusDot + VoiceHUDBand implementation | e52433a | feat |
| 2 RED | VoicePTTButton failing tests + useVoiceSession update | 23ae12d | test |
| 2 GREEN | VoicePTTButton implementation | 11fa6fb | feat |
| 3 | Wire HUDBand + StatusDot + PTT into App + Topbar | a5f4fbf | feat |

## Verification

- `npx vitest run --project=renderer src/renderer/features/voice/VoiceStatusDot.spec.tsx` — 18/18 pass
- `npx vitest run --project=renderer src/renderer/features/voice/VoiceHUDBand.spec.tsx` — 22/22 pass
- `npx vitest run --project=renderer src/renderer/features/voice/VoicePTTButton.spec.tsx` — 16/16 pass
- `npx vitest run --project=renderer src/renderer/features/voice/useVoiceSession.spec.ts` — 10/10 pass (regression check after stopTurn/setVadMode addition)
- `npm run typecheck` — 0 errors across all modified files

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing] stopTurn() + setVadMode() absent from VoiceSessionActions**
- **Found during:** Task 2 RED setup (typecheck error: 'stopTurn' does not exist in type 'VoiceSessionActions')
- **Issue:** Plan 15-06 delivered startTurn/endTurn/onPlaybackStart/onPlaybackEnd but did not add stopTurn or setVadMode to the interface — both are explicitly required by Plan 15-07's VoicePTTButton (D-10 keyup = hard turn-end; D-11 VAD mode switch).
- **Fix:** Added both methods to the VoiceSessionActions interface + implementation in createVoiceSessionStore. stopTurn() transitions listening→processing (waiting for VAD) or resets to idle. setVadMode() stores the current mode for the capture layer.
- **Files modified:** src/renderer/features/voice/useVoiceSession.ts
- **Commit:** 23ae12d

**2. [Rule 1 - Bug] Conditional useVoiceSession() hook call violated rules-of-hooks**
- **Found during:** Task 2 GREEN — worker crash (transform:0ms, zero tests run)
- **Issue:** First implementation of VoicePTTButton used `const liveSession = _testSession ? null : useVoiceSession()` — conditional hook call that violates React rules, causing the vitest worker to crash before running any tests.
- **Fix:** Refactored into Public/Core split: VoicePTTButton (public) always calls useVoiceSession(), then passes the result (or _testSession override) to VoicePTTButtonCore. No conditional hook.
- **Files modified:** src/renderer/features/voice/VoicePTTButton.tsx
- **Commit:** 11fa6fb

**3. [Rule 2 - Missing] testId prop needed for Topbar compact PTT variant**
- **Found during:** Task 3 wiring (UI-SPEC requires aria-topbar-ptt testid; component defaulted to voice-ptt-button)
- **Issue:** UI-SPEC §Topbar requires `data-testid="aria-topbar-ptt"` for the compact Topbar slot, while the full PTT button uses `data-testid="voice-ptt-button"`.
- **Fix:** Added optional `testId` prop (default 'voice-ptt-button') to VoicePTTButtonProps and threaded it through to the inner button element. Topbar uses `testId="aria-topbar-ptt"`.
- **Files modified:** src/renderer/features/voice/VoicePTTButton.tsx
- **Commit:** a5f4fbf

## Success Criteria Check

- [x] VoiceStatusDot maps all 6 VoiceStates to ok/warn/err/idle StatusDotKind (D-14)
- [x] No new CSS custom properties introduced (D-14)
- [x] VoiceHUDBand has role=status aria-live=polite aria-atomic=false (D-15)
- [x] VoiceHUDBand collapses to 0fr (idle) / expands to 1fr (active) — mounts unconditionally
- [x] Both components suppress animation under prefers-reduced-motion (D-16)
- [x] Transcript rendered as plain text node, not dangerouslySetInnerHTML (T-15-21)
- [x] VoicePTTButton hold-to-talk: keydown Space → setVadMode('hold') + startTurn (D-10)
- [x] VoicePTTButton hold-to-talk: keyup Space → stopTurn (hard turn-end, D-10)
- [x] VoicePTTButton click-toggle: click idle → setVadMode('toggle') + startTurn; click active → stopTurn (D-10)
- [x] PTT-start blocked while speaking/muted-during-playback (D-13/T-15-23)
- [x] Space keydown ignored when e.target is HTMLInputElement or HTMLTextAreaElement (T-15-22)
- [x] No import of globalShortcut or uiohook-napi in VoicePTTButton (D-12)
- [x] App.tsx: VoiceHUDBandConnected mounts in-flow before TrialBanner (not a portal/overlay)
- [x] Topbar.tsx: ⌘K → bell → VoicePTTButton(compact) → VoiceStatusDot → AvatarMenu
- [x] Voice pair wrapped in flex span with 8px gap (sm token, UI-SPEC §Topbar)
- [x] Existing ⌘K / bell / AvatarMenu elements remain present and unbroken

## Known Stubs

None. All three components wire to the live useVoiceSession() store which provides real state (idle by default until the voice pipeline starts). The HUD band collapses to 0-height in idle state — no placeholder text flows to the UI.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| T-15-21 resolved | src/renderer/features/voice/VoiceHUDBand.tsx | transcript rendered as plain React text node; no dangerouslySetInnerHTML; aria-live content is text-only |
| T-15-22 resolved | src/renderer/features/voice/VoicePTTButton.tsx | Space keydown handler guards e.target instanceof HTMLInputElement/HTMLTextAreaElement; 2 tests verify |
| T-15-23 resolved | src/renderer/features/voice/VoicePTTButton.tsx | speaking/muted-during-playback blocks startTurn via isGated() check; aria-disabled + tooltip reflect gate; 3 tests verify |

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED — VoiceStatusDot + VoiceHUDBand | 855e1f9 | PASS (import failed — no such modules) |
| GREEN — VoiceStatusDot + VoiceHUDBand | e52433a | PASS (18/18 + 22/22 tests) |
| RED — VoicePTTButton | 23ae12d | PASS (import failed — no such module) |
| GREEN — VoicePTTButton | 11fa6fb | PASS (16/16 tests) |

## Self-Check: PASSED

- [x] src/renderer/features/voice/VoiceStatusDot.tsx exists and contains 'StatusDot', 'stateToKind', 'voice-pulse', 'data-voice-spinner', 'data-voice-struck-mic', 'aria-topbar-voice-dot'
- [x] src/renderer/features/voice/VoiceHUDBand.tsx exists and contains 'aria-live', 'aria-atomic', 'grid-template-rows', 'voice-hud-band', 'voice-hud-state-label', 'voice-hud-transcript', 'data-voice-hud-inner'
- [x] src/renderer/features/voice/VoicePTTButton.tsx exists and contains 'keydown', 'keyup', 'setVadMode', 'startTurn', 'stopTurn', 'HTMLInputElement', 'HTMLTextAreaElement', 'voice-ptt-button'
- [x] VoicePTTButton.tsx does NOT contain 'globalShortcut' or 'uiohook' (D-12)
- [x] src/renderer/app/App.tsx contains 'VoiceHUDBandConnected' and 'VoiceHUDBand' import
- [x] src/renderer/components/Topbar.tsx contains 'VoicePTTButton', 'VoiceStatusDot', 'aria-topbar-ptt'
- [x] All 5 task commits exist: 855e1f9, e52433a, 23ae12d, 11fa6fb, a5f4fbf
- [x] 18/18 VoiceStatusDot tests pass
- [x] 22/22 VoiceHUDBand tests pass
- [x] 16/16 VoicePTTButton tests pass
- [x] useVoiceSession.spec.ts 10/10 pass (regression — stopTurn/setVadMode addition)
- [x] typecheck: 0 errors
