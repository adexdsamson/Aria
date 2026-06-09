---
phase: 260609-j2b
plan: "01"
subsystem: voice
tags: [voice, ptt, cloud-gate, ipc, renderer]
dependency_graph:
  requires: [phase-15-voice-ptt, phase-17-voice-prefs]
  provides: [cloud-aware-ptt-gate]
  affects: [VoicePTTButton, VoiceModelDownload]
tech_stack:
  added: []
  patterns: [fail-closed-cloud-check, session-scoped-ref-cache, injectable-ipc-seam]
key_files:
  created: []
  modified:
    - src/renderer/features/voice/VoiceModelDownload.tsx
    - src/renderer/features/voice/VoicePTTButton.tsx
    - src/renderer/features/voice/VoicePTTButton.spec.tsx
decisions:
  - "cloudReadyRef is a ref (not state) — no extra re-render cycle; same pattern as modelReadyRef"
  - "checkCloudEnabled() fails closed on error (returns false) so the local model gate is never bypassed accidentally"
  - "voiceGetPrefs field on VoiceModelDownloadIpc is optional (?: syntax) — existing makeIpc() helpers compile without change"
  - "cloudReadyRef cache is session-scoped (same lifetime as modelReadyRef); stale if user toggles cloud mid-session without remount — acceptable for v1"
  - "TypeScript narrowed the redundant cloudReadyRef !== true guard away; removed it since the cloud fast-path early-return already proves that invariant"
metrics:
  duration: "~15 minutes"
  completed: "2026-06-09"
  tasks_completed: 2
  files_modified: 3
---

# Phase 260609-j2b Plan 01: Cloud-aware PTT Gate Summary

**One-liner:** Cloud-aware PTT gate using optional `voiceGetPrefs` IPC seam — `useCloud=true` skips the 574 MB Whisper download modal entirely and routes straight to `startTurn()`.

## What Was Built

The VoicePTTButton's lazy first-PTT download gate (D-08) previously always checked local model readiness, even when cloud audio (`useCloud=true`) was configured. This caused the 574 MB download modal to appear unnecessarily for cloud users.

### Changes

**VoiceModelDownload.tsx**
- Added optional `voiceGetPrefs?: AriaApi['voiceGetPrefs']` to `VoiceModelDownloadIpc` interface — backward-compatible (existing consumers that omit it compile unchanged).

**VoicePTTButton.tsx**
- `cloudReadyRef: useRef<boolean | null>(null)` — session-scoped cache for the cloud check (null = unchecked).
- `checkCloudEnabled()` — calls `getIpc()?.voiceGetPrefs()`, caches result; returns `false` on error (fail-closed, never bypasses local gate).
- `checkReadyOrCloud()` — if cloud enabled, returns `true` immediately; otherwise delegates to `checkModelReady()`.
- `attemptPttStart()` updated:
  - New cloud fast-path at the top (before the `modelReadyRef.current === false` check).
  - Async null-branch now calls `checkReadyOrCloud()` instead of `checkModelReady()`.

**VoicePTTButton.spec.tsx**
- `makeIpc()` updated with `voiceGetPrefs` defaulting to `{ speed: 1.0, voiceId: '', useCloud: false }` — existing tests unaffected.
- New describe block "VoicePTTButton — cloud-aware PTT gate" with 4 tests:
  - Test A: click + cloud ON + model NOT ready → `startTurn` called, no modal.
  - Test B: Space keydown + cloud ON + model NOT ready → `startTurn` called, no modal.
  - Test C: click + cloud OFF + model NOT ready → download modal shown (D-08 preserved).
  - Test D: click + cloud OFF + model NOT ready → `startTurn` NOT called (D-08 preserved).

## Test Results

- 26/26 tests green (22 pre-existing + 4 new cloud-gate cases).
- 0 new TypeScript errors (baseline clean).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Redundant `cloudReadyRef.current !== true` check caused TypeScript error TS2367**
- **Found during:** Task 1 typecheck
- **Issue:** The plan described adding `cloudReadyRef.current !== true` to the `modelReadyRef.current === false` fast-path. TypeScript narrowed the type of `cloudReadyRef.current` to `false | null` after the cloud fast-path early-return (line 229), making the `!== true` comparison always-true and flagging it as unintentional.
- **Fix:** Removed the redundant `&& cloudReadyRef.current !== true` guard — the preceding `if (cloudReadyRef.current === true) { return; }` already guarantees the invariant.
- **Files modified:** `src/renderer/features/voice/VoicePTTButton.tsx`
- **Commit:** 8b253f3

## Commits

| Hash | Message |
|------|---------|
| 8b253f3 | feat(260609-j2b): cloud-aware PTT gate — skip download modal when useCloud=true |

## Self-Check: PASSED

- [x] `src/renderer/features/voice/VoicePTTButton.tsx` exists and contains `cloudReadyRef`
- [x] `src/renderer/features/voice/VoicePTTButton.spec.tsx` exists and contains "cloud enabled"
- [x] `src/renderer/features/voice/VoiceModelDownload.tsx` exists and contains `voiceGetPrefs`
- [x] Commit 8b253f3 exists in git log
- [x] 26/26 tests pass
- [x] 0 new TypeScript errors
