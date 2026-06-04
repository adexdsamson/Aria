---
phase: 15-audio-i-o-model-runtime
plan: "08"
subsystem: voice-model-download-ux
tags: [voice, onboarding, download, sc4, tdd, d-07, d-08]
dependency_graph:
  requires:
    - src/shared/ipc-contract.ts (VOICE_DOWNLOAD_MODEL / VOICE_MODEL_PROGRESS / VOICE_GET_MODEL_STATUS — Plan 15-01)
    - src/preload/index.ts (onVoiceModelProgress subscription override — Plan 15-01)
    - src/main/voice/download/model-download.ts (DISCLOSED_MODEL_SIZE_BYTES + download controller — Plan 15-03)
  provides:
    - src/renderer/features/voice/VoiceModelDownload.tsx (both step + modal variants)
    - src/renderer/features/voice/VoiceModelDownload.spec.tsx (25 spec tests)
    - src/renderer/features/onboarding/OnboardingWizard.tsx (voice step inserted)
    - src/renderer/features/onboarding/OnboardingWizard.spec.tsx (7 spec tests)
  affects:
    - Plan 15-07 (VoicePTTButton routes to VoiceModelDownload modal variant when model not ready)
    - Plan 15-16+ (voice step wired into live onboarding flow)
tech_stack:
  added: []
  patterns:
    - _testIpc prop injection for test isolation (mirrors VoicePTTButton._testSession pattern)
    - __forceStep__ test-only prop for wizard step injection (avoids full nav simulation)
    - VoiceModelDownload two-variant component (step card vs Modal size="md")
    - onSkip/onComplete callbacks wired to seal() — voice never blocks seal
key_files:
  created:
    - src/renderer/features/voice/VoiceModelDownload.tsx
    - src/renderer/features/voice/VoiceModelDownload.spec.tsx
    - src/renderer/features/onboarding/OnboardingWizard.spec.tsx
  modified:
    - src/renderer/features/onboarding/OnboardingWizard.tsx
decisions:
  - "__forceStep__ test-only prop added to OnboardingWizard to allow direct step injection without simulating full 6-step navigation chain"
  - "password step 'Finish setup' now calls setStep('voice') instead of seal() directly; seal() called from voice step handlers"
  - "sealing state extracted into its own render branch (separated from password) for clean UX separation"
  - "VoiceModelDownload subscribes to onVoiceModelProgress via useEffect with cleanup (unsubscribe on unmount)"
  - "DISCLOSED_BYTES=601_882_624 hardcoded in component matching model-download.ts DISCLOSED_MODEL_SIZE_BYTES"
metrics:
  duration: "~35 minutes"
  completed: "2026-06-04"
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 1
---

# Phase 15 Plan 08: First-Run Model Download UX Summary

VoiceModelDownload with SC4-quality flow (size-before-start, progress bar, pause/resume, graceful "voice unavailable" state) in both onboarding step and lazy modal variants; skippable 'voice' step wired into OnboardingWizard between 'password' and 'sealing' — seal never blocked on voice readiness.

## Tasks Completed

| # | Task | Commit | Type |
|---|------|--------|------|
| 1 | VoiceModelDownload spec (TDD RED) | d932205 | test |
| 1 | VoiceModelDownload implementation (TDD GREEN) | 05ebb6b | feat |
| 2 | OnboardingWizard voice step spec (TDD RED) | 123dcdf | test |
| 2 | OnboardingWizard voice step wired (TDD GREEN) | 0d5efda | feat |

## Verification

- `npx vitest run src/renderer/features/voice/VoiceModelDownload.spec.tsx` — 25/25 pass
- `npx vitest run src/renderer/features/onboarding/OnboardingWizard.spec.tsx` — 7/7 pass
- Both specs together — 32/32 pass
- `npm run typecheck` — 84 errors (0 new; same pre-existing baseline as Plans 15-01 through 15-07)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Card component does not forward data-testid**
- **Found during:** Task 1 GREEN phase (test run)
- **Issue:** The `Card` editorial primitive's `CardProps` does not include `data-testid` or spread arbitrary HTML attributes — so `<Card data-testid="voice-model-download-step">` silently dropped the testid.
- **Fix:** Wrapped the `Card` in a plain `<div data-testid="voice-model-download-step">` container.
- **Files modified:** `src/renderer/features/voice/VoiceModelDownload.tsx`
- **Commit:** 05ebb6b (GREEN commit — fix applied inline before final pass)

**2. [Rule 2 - Auto-add] Extracted sealing step to its own render branch**
- **Found during:** Task 2 implementation
- **Issue:** The original wizard combined 'password' and 'sealing' in a single `if (step === 'password' || step === 'sealing')` branch. With 'voice' inserted between them, the sealing UI had to be cleanly separated so password → voice → sealing flows correctly.
- **Fix:** Split into `if (step === 'password')` and `if (step === 'sealing')` with the sealing branch rendering the "Sealing your vault…" UI only (no input, no button — seal is already running).
- **Files modified:** `src/renderer/features/onboarding/OnboardingWizard.tsx`
- **Commit:** 0d5efda

## Success Criteria Check

- [x] VoiceModelDownload renders SC4 flow: size-before-start (testid voice-download-size-disclosure), progress bar (role=progressbar, aria-valuenow), pause/resume link, "Voice ready" + "Continue →" on complete, "Set up later" skip
- [x] Two variants: step (voice-model-download-step testid) and modal (voice-model-download-modal testid, Modal size="md")
- [x] Progress fill animation suppressed under @media (prefers-reduced-motion: reduce)
- [x] OnboardingWizard Step union includes 'voice' between 'password' and 'sealing'
- [x] Voice step renders VoiceModelDownload variant='step'
- [x] Skip and Complete both transition to 'sealing' (seal called from voice step handlers)
- [x] No code path blocks seal on voice step (T-15-24)
- [x] VoiceModelDownload reachable from OnboardingWizard — NOT orphaned (spec verifies)

## Known Stubs

None — the IPC calls (`voiceGetModelStatus`, `voiceDownloadModel`, `onVoiceModelProgress`) are wired to real `window.aria` channels set up in Plans 15-01 and 15-05. No placeholder data flows to UI rendering.

## Threat Flags

None — T-15-24 (voice step blocking seal) is mitigated by construction: both `onSkip` and `onComplete` call `seal()` directly. The voice step renders `VoiceModelDownload` which issues only a parameterless `voiceDownloadModel` IPC call; the download URL and destination are main-process-controlled (Plan 15-03).

## TDD Gate Compliance

- RED gate Task 1: `test(15-08)` commit d932205 exists — spec fails with "Cannot find module ./VoiceModelDownload"
- GREEN gate Task 1: `feat(15-08)` commit 05ebb6b exists — 25/25 pass
- RED gate Task 2: `test(15-08)` commit 123dcdf exists — 7 tests fail with "cannot find __forceStep__"
- GREEN gate Task 2: `feat(15-08)` commit 0d5efda exists — 7/7 pass

## Self-Check: PASSED

- [x] src/renderer/features/voice/VoiceModelDownload.tsx exists
- [x] src/renderer/features/voice/VoiceModelDownload.spec.tsx exists (25 tests)
- [x] src/renderer/features/onboarding/OnboardingWizard.spec.tsx exists (7 tests)
- [x] OnboardingWizard.tsx includes 'voice' step
- [x] VoiceModelDownload is imported in OnboardingWizard.tsx
- [x] Commits d932205, 05ebb6b, 123dcdf, 0d5efda all exist in git log
- [x] 32/32 combined spec tests pass
- [x] typecheck baseline unchanged (84 errors, 0 new from this plan)
