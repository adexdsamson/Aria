---
phase: 15-audio-i-o-model-runtime
verified: 2026-06-04T07:00:00Z
status: human_needed
score: 9/10 must-haves verified (lazy-PTT gap closed post-verification in 1e848c6; remaining items are packaged-build / hardware human-verify only)
overrides_applied: 0
gap_closures:
  - truth: "Disabled PTT affordance routes to the download flow when model is not ready (D-07/D-08)"
    resolved_by: "1e848c6"
    note: "VoicePTTButton now calls voiceGetModelStatus() on PTT activate; when model not ready it opens <VoiceModelDownload variant='modal'> instead of startTurn(), with a distinct not-ready visual affordance. 6 new D-08/SC4 tests; 22/22 VoicePTTButton tests green; half-duplex 5/5 unchanged."
human_verification:
  - test: "Packaged app launches without NODE_MODULE_VERSION ABI crash (SC2)"
    expected: "App window appears with title 'Aria', onboarding gate visible, sidecar spawns successfully — no ABI crash in logs"
    why_human: "Requires signed/packaged build on the user's 16 GB machine; tests/e2e/packaged-launch.spec.ts is .skip by design until packaged artifact is present"
  - test: "Half-duplex gate holds on laptop speakers — Aria never transcribes its own TTS (SC3)"
    expected: "With Kokoro TTS playing on built-in laptop speakers (not headphones), mic stays fully gated (micGated=true) for the entire playback duration; Aria does not transcribe its own audio"
    why_human: "Real acoustic echo path cannot be unit-tested; Electron AEC is unreliable (#47043); only a live mic+speaker test on the actual hardware proves Chromium's no-op AEC doesn't bleed TTS audio back through STT"
  - test: "RAM ceiling acceptable on 16 GB no-GPU machine (phase goal)"
    expected: "10-second PTT session with Ollama 8B loaded keeps peak total memory below 12 GB (4 GB headroom); app stays responsive; no swap thrash; see 15-RAM-CEILING.md for procedure"
    why_human: "Hardware-bound measurement; dev machine is 8 GB (guaranteed swap territory); requires the 16 GB machine and a packaged build"
  - test: "First-run model download flow SC4 quality on a real fresh profile (SC4)"
    expected: "Size disclosed BEFORE download starts (600 MB visible), progress bar updates live, kill-and-resume correctly resumes from Range offset, 'Voice unavailable' state shown while downloading, 'Voice ready' shown on completion"
    why_human: "Network + actual HF CDN latency + real filesystem; kill-resume requires interrupting a live download to confirm Range header is sent on restart"
  - test: "Device hot-swap and permission-denied surfaced as actionable errors (SC5)"
    expected: "Unplugging/replugging a USB mic mid-session recovers without crash; denying mic permission surfaces a toast + HUD error state (not a silent failure)"
    why_human: "Physical device plug/unplug and OS permission dialog interaction cannot be automated"
  - test: "Lazy first-PTT modal triggers for users who skipped voice onboarding (D-07/D-08)"
    expected: "When a user who skipped the onboarding voice step first clicks/holds PTT, a VoiceModelDownload modal appears offering to download the model; PTT is disabled until model is ready or skipped again"
    why_human: "The lazy PTT-to-modal routing is NOT currently wired in VoicePTTButton.tsx (see WARNING in gaps section); this human test would FAIL — routing the gap to human-verify so the developer decides whether to fix it in this phase or defer to Phase 16/17"
gaps:
  - truth: "Disabled PTT affordance routes to the download flow when model is not ready (D-07/D-08)"
    status: resolved
    resolved_by: "1e848c6"
    reason: "RESOLVED post-verification. VoicePTTButton.tsx now calls voiceGetModelStatus() on PTT activate; when the model is not ready it opens <VoiceModelDownload variant='modal'> (self-contained, not orphaned) instead of startTurn(), and shows a distinct not-ready affordance. Original finding (kept for history): the component gated startTurn() during playback (half-duplex) but did not gate/route when the model was absent."
    artifacts:
      - path: "src/renderer/features/voice/VoicePTTButton.tsx"
        issue: "No model-readiness check; no VoiceModelDownload import; does not call voiceGetModelStatus or show the lazy modal"
      - path: "src/renderer/app/App.tsx"
        issue: "No VoiceModelDownload(variant='modal') mounted or conditional PTT-gating on model readiness"
    missing:
      - "VoicePTTButton (or a wrapper in App.tsx) must call window.aria.voiceGetModelStatus() on mount and when clicked"
      - "If model is not ready, PTT click should open <VoiceModelDownload variant='modal' onSkip={...} onComplete={...} /> rather than trying startTurn()"
      - "A disabled/special visual state when model is absent (separate from the half-duplex gated state) is implied by D-08 'disabled affordance'"
---

# Phase 15: Audio I/O + Model Runtime — Verification Report

**Phase Goal:** Aria can capture the user's voice, detect speech endpoints, run local transcription that survives packaging, and play synthesized speech — proven on the packaged app on Windows + macOS, without echoing itself or breaking the native-addon ABI.
**Verified:** 2026-06-04T07:00:00Z
**Status:** human_needed (1 gap + 6 items pending human verification)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths — ROADMAP.md Success Criteria

| # | Truth (from ROADMAP SC) | Status | Evidence |
|---|------------------------|--------|----------|
| 1 | SC1: User holds a hotkey or clicks to talk and sees their words transcribed live on screen | VERIFIED | VoicePTTButton.tsx wires keydown/keyup Space + click-toggle to startTurn/stopTurn/feedAudio IPC; VoiceHUDBand.tsx renders live liveTranscript with aria-live="polite"; both wired in App.tsx + Topbar.tsx |
| 2 | SC2: Transcription runs fully on-device; no audio leaves machine; packaged app launches with no NODE_MODULE_VERSION ABI crash | PASS-pending-human-verify | VOICE-04 no-cloud ratchet (tests/static/voice-audio-no-cloud.spec.ts 2/2) + no-native-addon ratchet (stt-no-native-addon.spec.ts 4/4) prove the design invariant statically; whisper-binary-packaging.spec.ts 8/8 locks packaging config. packaged-launch.spec.ts is .skip awaiting packaged build on 16 GB machine |
| 3 | SC3: Mic state always visible; mic gated during TTS playback; Aria never transcribes its own speech (verified on laptop speakers) | PASS-pending-human-verify | half-duplex.spec.ts 5/5 proves gate holds in unit tests; VoiceStatusDot.tsx wired in Topbar; VoiceHUDBand.tsx wired in App.tsx; laptop-speaker acoustic test requires packaged build (human verify) |
| 4 | SC4: First-run model download is a designed flow (progress + resumable + size disclosure + graceful unavailable state) | PASS-pending-human-verify | VoiceModelDownload.tsx exists with both variants; OnboardingWizard has voice step; size disclosure present (DISCLOSED_BYTES=601_882_624); progress bar + pause/resume wired to VOICE_MODEL_PROGRESS. Lazy PTT-to-modal routing is NOT wired — see gap below. Network-based resumable test needs human verify |
| 5 | SC5: Plugging/unplugging audio device handled gracefully (device hot-swap + resample + permission-denied as actionable error) | PASS-pending-human-verify | useMicCapture.ts implements devicechange handler (device-lost) + NotAllowedError → permission-denied onError → ToastHost/HUD error routing; useMicCapture.spec.ts 11/11 passes. Physical device test needs human verify |

**Score:** 3/5 SCs VERIFIED, 2/5 PASS-pending-human-verify. Additional gap on SC4 (lazy PTT routing).

### Additional Must-Haves (from PLAN frontmatter)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 6 | VOICE-04 no-cloud-audio ratchet enforces on-device by construction | VERIFIED | tests/static/voice-audio-no-cloud.spec.ts 2/2; walks main + renderer voice dirs; blocks 8 cloud endpoint patterns in production code |
| 7 | SC2 no-ABI-crash by construction (no .node addon in stt/) | VERIFIED | tests/static/stt-no-native-addon.spec.ts 4/4; bans smart-whisper, nodejs-whisper, whisper-node, and .node imports under src/main/voice/stt/** |
| 8 | VoiceStatusDot + VoiceHUDBand + VoicePTTButton wired into App.tsx and Topbar.tsx (not orphaned) | VERIFIED | App.tsx:16 imports VoiceHUDBand; App.tsx:109 renders VoiceHUDBandConnected; Topbar.tsx:17-18 imports + renders VoicePTTButton + VoiceStatusDot at line 194-195 |
| 9 | VoiceModelDownload reachable from OnboardingWizard (not orphaned) | VERIFIED | OnboardingWizard.tsx:28 imports VoiceModelDownload; OnboardingWizard.tsx:269 renders it in the 'voice' step |
| 10 | Disabled PTT affordance routes to download flow when model not ready (D-08) | FAILED | VoicePTTButton.tsx does not check model readiness or trigger the VoiceModelDownload modal variant; lazy first-PTT modal is orphaned in App/Topbar context |

**Score:** 8/10 must-haves verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|---------|----------|--------|---------|
| `src/shared/voice-types.ts` | VoiceState union including 'speaking' + DTOs | VERIFIED | Contains VoiceState, TranscriptDelta, VoiceModelStatus; 'speaking' present |
| `src/main/voice/prefs.ts` | settings(k,v) KV model-readiness persistence | VERIFIED | INSERT INTO settings with ON CONFLICT(k); db-null tolerant |
| `tests/static/voice-audio-no-cloud.spec.ts` | VOICE-04 no-cloud ratchet | VERIFIED | 2 tests; walks src/main/voice/** + src/renderer/features/voice/**; blocks 8 cloud patterns |
| `tests/static/stt-no-native-addon.spec.ts` | SC2 no-ABI-crash ratchet | VERIFIED | 4 tests; bans .node imports + 3 banned packages from src/main/voice/stt/** |
| `src/main/voice/stt/sidecar-manager.ts` | SttSidecarManager + resolveBinaryPath | VERIFIED | resolveBinaryPath mirrors icons.ts pattern; no .node imports; uses child_process.spawn |
| `src/main/voice/download/model-download.ts` | Resumable download with NDH + powerMonitor | VERIFIED | DownloaderHelper resumeIfFileExists/resumeOnIncomplete; size-mismatch guard blocks readiness flip |
| `src/renderer/features/voice/capture/useMicCapture.ts` | getUserMedia + 16 kHz + devicechange | VERIFIED | AudioContext at sampleRate 16000; devicechange → re-acquire; NotAllowedError → permission-denied |
| `src/main/ipc/voice.ts` | registerVoiceHandlers (4 invoke channels) | VERIFIED | VOICE_FEED_AUDIO, VOICE_GET_MODEL_STATUS, VOICE_DOWNLOAD_MODEL, VOICE_CANCEL_TTS all implemented |
| `src/main/index.ts` (voice bootstrap) | registerVoiceHandlers + SttSidecarManager + createModelDownload + powerMonitor lifecycle | VERIFIED | Lines 383-443; sttSidecar + downloadController constructed; stubs removed + real handlers registered; registerLifecycleCallbacks wired |
| `src/renderer/features/voice/tts/useKokoroPlayer.ts` | Real Kokoro-82M TTS (webgpu→wasm) | VERIFIED | kokoro-js@^1.2.1 in package.json; webgpu→wasm fallback; onPlaybackStart/onPlaybackEnd callbacks |
| `src/renderer/features/voice/useVoiceSession.ts` | State machine + micGated half-duplex gate | VERIFIED | HALF_DUPLEX_COOLDOWN_MS=800; startTurn() returns false when speaking; onPlaybackEnd schedules 800ms cooldown |
| `src/renderer/features/voice/VoiceStatusDot.tsx` | Topbar mic state dot (6 states, no new tokens) | VERIFIED | stateToKind maps all 6 VoiceStates; wraps editorial StatusDot; aria-label + aria-live; reduced-motion guard |
| `src/renderer/features/voice/VoiceHUDBand.tsx` | In-flow live-transcription HUD | VERIFIED | role="status" aria-live="polite" aria-atomic="false"; grid-template-rows 0fr/1fr collapse; reduced-motion; plain text transcript |
| `src/renderer/features/voice/VoicePTTButton.tsx` | Hold+click-toggle PTT (no globalShortcut) | VERIFIED | keydown/keyup Space; click-toggle; isGated blocks speaking; Space ignored in HTMLInputElement/HTMLTextAreaElement |
| `src/renderer/features/voice/VoiceModelDownload.tsx` | Download flow (step + modal variants, SC4 quality) | PARTIAL — modal variant ORPHANED | Component exists with both variants and all SC4 qualities; but modal variant is never triggered from PTT path |
| `src/renderer/features/onboarding/OnboardingWizard.tsx` | Skippable 'voice' step (never blocks seal) | VERIFIED | Step union includes 'voice'; password→voice→sealing flow; both onSkip and onComplete call seal() |
| `tests/static/whisper-binary-packaging.spec.ts` | Packaging config guard (8 invariants) | VERIFIED | 8/8; win32 + darwin extraResources with to:"."; mac.binaries signing; whisper.dll included; not in asarUnpack |
| `package.json` (extraResources win32 + darwin) | whisper-cli per-platform staging | VERIFIED | win32 filter includes whisper-cli.exe + whisper.dll + ggml*.dll; darwin filter includes whisper-cli; both to:"." |
| `build/whisper/windows/` | Windows binary staged on disk | VERIFIED | whisper-cli.exe + whisper.dll + ggml.dll + ggml-base.dll + ggml-cpu.dll present |
| `tests/e2e/packaged-launch.spec.ts` | SC2 E2E scaffold | VERIFIED (scaffold only) | .skip by design; full SC2 assertions present; awaiting packaged build |
| `15-RAM-CEILING.md` | RAM ceiling measurement template | VERIFIED (template) | Procedure, expected budget, result tables, pass/fail criteria documented; measurement OPEN |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| App.tsx | VoiceHUDBand | VoiceHUDBandConnected connector at line 109 | WIRED | Import at line 16; rendered unconditionally before TrialBanner |
| Topbar.tsx | VoicePTTButton + VoiceStatusDot | Direct component render at lines 194-195 | WIRED | Both imported at lines 17-18; in the Topbar right cluster |
| OnboardingWizard.tsx | VoiceModelDownload (step variant) | 'voice' Step at line 269 | WIRED | Import at line 28; both onSkip and onComplete → seal() |
| VoicePTTButton → VoiceModelDownload modal | (none) | (should be via model-readiness check on click/keydown) | NOT WIRED | This is the D-08 gap — lazy PTT-to-modal routing absent |
| src/main/index.ts | registerVoiceHandlers | SttSidecarManager + downloadController constructed; stubs removed; real handlers registered | WIRED | Lines 413-430 |
| src/main/index.ts | registerLifecycleCallbacks | powerMonitor suspend/resume for sidecar + download | WIRED | Lines 433-443 |
| VoiceHUDBandConnected | useVoiceSession() | voiceState + liveTranscript from live store | WIRED | App.tsx lines 241-243 |
| Topbar | useVoiceSession() | voiceState forwarded to VoiceStatusDot | WIRED | Topbar.tsx line 185+ |
| SttSidecarManager | VOICE_TRANSCRIPT_DELTA push | emitToRenderer forwarded from voiceEmitter forward-ref | WIRED | voice.ts line 92; index.ts line 396 |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---------|--------------|--------|-------------------|--------|
| VoiceHUDBand | liveTranscript | useVoiceSession() → createVoiceSessionStore() → IPC onVoiceTranscript → SttSidecarManager.transcribe() | Yes — real sidecar transcription | FLOWING |
| VoiceStatusDot | state (voiceState) | useVoiceSession() → VOICE_STATE_CHANGED push events from main | Yes — real state machine transitions | FLOWING |
| VoiceModelDownload (step) | progress, modelReady | voiceGetModelStatus IPC + onVoiceModelProgress subscription | Yes — real KV reads + NDH progress events | FLOWING |
| VoiceModelDownload (modal) | (n/a) | No call-site triggers the modal variant from PTT path | No flow path exists | DISCONNECTED (orphaned) |
| useKokoroPlayer | speak() → AudioBufferSourceNode | KokoroTTS.generate() → kokoro-js ONNX (wasm/webgpu) | Yes — real model inference | FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---------|---------|--------|--------|
| No-cloud-audio ratchet green | `npx vitest run tests/static/voice-audio-no-cloud.spec.ts` (per SUMMARY) | 2/2 pass (reported in 15-01, 15-03 SUMMARY) | PASS (trust SUMMARY — spec is deterministic file walk) |
| No-native-addon ratchet green | `npx vitest run tests/static/stt-no-native-addon.spec.ts` (per SUMMARY) | 4/4 pass (reported in 15-02 SUMMARY) | PASS |
| Whisper packaging guard green | `npx vitest run tests/static/whisper-binary-packaging.spec.ts` (per SUMMARY) | 8/8 pass (reported in 15-09 SUMMARY) | PASS |
| Half-duplex spec green | `npx vitest run tests/unit/renderer/voice/half-duplex.spec.ts` (per SUMMARY) | 5/5 pass (reported in 15-06 SUMMARY) | PASS |
| IPC handler count correct | `npx vitest run tests/unit/main/ipc/index.spec.ts` (per 15-05 SUMMARY) | 4/4 pass (149/149 handlers) | PASS |
| Windows binary runnable | `build\whisper\windows\whisper-cli.exe --help` (empirically verified in 15-09) | exit 0, 73 lines (per 15-09 SUMMARY) | PASS |
| Windows whisper.dll required | empirical test in 15-09 (without dll → exit 127) | ship-blocker fixed in a130077 | PASS (fixed) |
| VoiceStatusDot wired in Topbar | grep: Topbar.tsx imports + renders VoicePTTButton + VoiceStatusDot | WIRED (grep-confirmed above) | PASS |
| VoiceHUDBand wired in App.tsx | grep: App.tsx imports + renders VoiceHUDBandConnected | WIRED (grep-confirmed above) | PASS |
| VoiceModelDownload reachable from OnboardingWizard | grep: OnboardingWizard.tsx imports + renders VoiceModelDownload | WIRED (grep-confirmed above) | PASS |
| Lazy PTT modal triggered from VoicePTTButton | grep: VoicePTTButton.tsx for VoiceModelDownload | No import, no modal trigger | FAIL |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| VOICE-01 | 15-01, 15-04, 15-05, 15-07 | Push-to-talk + live transcription shown | SATISFIED | VoicePTTButton.tsx hold/click PTT; VoiceHUDBand live transcript; feedAudio IPC → SttSidecarManager → VOICE_TRANSCRIPT_DELTA |
| VOICE-04 | 15-01, 15-02, 15-03, 15-09 | On-device by default; no audio leaves machine; packaged survives ABI | SATISFIED (with SC2 human-verify pending) | No-cloud ratchet 2/2; no-native-addon ratchet 4/4; whisper-binary-packaging 8/8; packaged-launch .skip pending build |
| VOICE-07 | 15-01, 15-06, 15-07 | Mic state always visible; half-duplex gating | SATISFIED (with SC3 laptop-speaker test pending) | VoiceStatusDot always in Topbar; VoiceHUDBand; half-duplex.spec 5/5; micGated=true during speaking + 800ms cooldown |

---

## Anti-Patterns Found

| File | Pattern | Severity | Assessment |
|------|---------|----------|------------|
| `src/main/voice/stt/sidecar-manager.ts` | `eslint-disable @typescript-eslint/no-explicit-any` (SpawnFn type) | INFO | Acceptable — documented workaround for child_process.spawn overload incompatibility; isolated to type alias; no security impact |
| `tests/e2e/packaged-launch.spec.ts` | `test.describe.skip(...)` | INFO | Intentional by design; mirrors phase8-happy-path.spec.ts precedent; un-skip checklist in file header; NOT a debt marker |
| `src/main/index.ts` line 443 | `void _unregisterVoiceLifecycle;` | INFO | Retained for future teardown; explicit comment; not a stub |
| No TBD/FIXME/XXX markers found in phase-15 files | — | — | Clean |

No debt markers (TBD/FIXME/XXX) found in any Phase-15 modified files. All placeholder-looking patterns have explicit comments explaining their intentional nature.

---

## Human Verification Required

### 1. Packaged Launch — SC2 ABI Safety

**Test:** Build the packaged app (`npm run build && electron-builder --win`) on the 16 GB machine with whisper-cli.exe staged. Then run: `npx playwright test tests/e2e/packaged-launch.spec.ts` (after removing the `.skip`).
**Expected:** App window appears with title "Aria", no `NODE_MODULE_VERSION` in logs, sidecar spawns successfully on first PTT attempt.
**Why human:** Requires a signed/packaged build. The dev machine is Windows (can build win32 unsigned). macOS packaged build requires CI + Apple Developer ID (see build/whisper/README.md §Option A).

### 2. Laptop Speaker Acoustic Half-Duplex — SC3

**Test:** On a laptop with built-in speakers (not headphones), with a packaged app running: trigger a PTT session to speak a sentence. Wait for Kokoro to echo the transcript aloud via laptop speakers. Verify Aria does NOT transcribe its own TTS output.
**Expected:** During TTS playback, VoiceHUDBand shows "SPEAKING" state, NOT "LISTENING" or "PROCESSING". No spurious transcript segments appear from TTS audio. HUD returns to idle after playback + 800ms cooldown.
**Why human:** Chromium AEC is documented as unreliable in Electron (#47043). The half-duplex gate (micGated=true) is provably correct in unit tests, but the physical acoustic path — whether Chromium's WebRTC AEC bleeds TTS audio back into the microphone stream before the gate prevents capture — can only be verified on real laptop hardware.

### 3. RAM Ceiling — Phase Goal Proof

**Test:** Follow procedure in `.planning/phases/15-audio-i-o-model-runtime/15-RAM-CEILING.md`. Prerequisites: packaged build + Whisper model downloaded + `ollama run llama3.1:8b "hello"` (model resident). Hold PTT for ~10 seconds, note peak memory in Task Manager during STT decode + Kokoro TTS.
**Expected:** Peak total (Aria + ollama + Kokoro) stays below 12 GB on a 16 GB machine. No swap thrash. App stays responsive.
**Why human:** Hardware-bound measurement. Dev machine is 8 GB — guaranteed swap. Results must be recorded in 15-RAM-CEILING.md.

### 4. First-Run Model Download SC4 — Network/Resumable Test

**Test:** Fresh profile (no downloaded model). Open app. Navigate to PTT button. Observe disabled state (if the lazy PTT-to-modal wiring gap is fixed first) or go through onboarding voice step. Start download. After 20-30% progress, kill the app. Relaunch. Confirm download resumes from where it left off (not restarting from 0%).
**Expected:** Size disclosure (600 MB) shown before download starts; progress bar updates; Range resume on restart; "Voice ready" + "Continue" on completion; no UI spinner without context.
**Why human:** Network (HF CDN), real filesystem, and kill-resume sequence.

### 5. Device Hot-Swap + Permission-Denied — SC5

**Test:** (a) While a PTT session is active or app is open, unplug then replug a USB mic. (b) When mic permission dialog appears, deny it.
**Expected:** (a) Device reconnect is handled; useMicCapture re-acquires without crash; ToastHost shows "Audio device disconnected" error if re-acquire fails. (b) ToastHost shows "Microphone permission denied — check your system settings"; VoiceHUDBand shows error state.
**Why human:** Physical device event + OS permission dialog interaction.

### 6. Lazy PTT-to-Modal Routing Decision (Gap — needs developer decision)

**Test:** Launch app with a profile that has no voice model downloaded (or clear the model-readiness KV). Click or hold Space on VoicePTTButton.
**Expected (per D-07/D-08):** VoiceModelDownload modal variant appears offering to download the model; PTT does not try to start a STT session.
**Current behavior:** VoicePTTButton.tsx does not check model readiness. Clicking PTT when model is absent will call startTurn(), then VOICE_FEED_AUDIO → SttSidecarManager.transcribe() which will reject (empty modelPath), returning an error to the renderer. The error state will surface via VOICE_STATE_CHANGED → 'error' → VoiceHUDBand error display, but no download modal appears.
**Why human:** This is a gap (see gaps section). The developer needs to decide: (a) fix the lazy PTT routing in this phase, or (b) accept the error-state fallback as "good enough" for Phase 15 (voice is labeled beta, model download happens in onboarding). If option (b), an override should be added to this file.

---

## Gaps Summary

**1 gap identified** — the "disabled PTT affordance that routes to the download flow" (D-08 must-have from 15-08-PLAN.md):

The `VoiceModelDownload` component has a modal variant (`variant='modal'`) that is correctly built and tested in isolation. The `OnboardingWizard` correctly hosts the step variant. But the lazy first-PTT trigger — "for users who skipped onboarding, first click on PTT should open the download modal" — is not wired anywhere.

`VoicePTTButton.tsx` never calls `window.aria.voiceGetModelStatus()` and never conditionally renders or triggers the modal variant. The flow described in 15-08-PLAN.md must_haves truth #3 ("'Voice unavailable until ready' is a disabled PTT affordance that routes to the download flow") is partially implemented (the component exists) but the routing from PTT click to modal is absent.

**Impact assessment:** In Phase 15's scope, the most common first-time user path goes through the OnboardingWizard voice step, which DOES work correctly. A user who skips the voice step gets a PTT button that will show an error state (via VOICE_STATE_CHANGED→'error') rather than a helpful download modal. This is a degraded — not broken — experience. The STT and TTS pipelines still function once the model IS downloaded.

**Developer decision needed:** Fix the lazy routing in this phase (add model-readiness check to VoicePTTButton or App.tsx, trigger modal on first-PTT-without-model), OR add an override to accept the error-state fallback as sufficient for Phase 15.

---

## Summary Verdict

**Phase 15 is code-complete with one gap and six human-verify items pending.**

The core audio pipeline is fully implemented and statically verified:
- Push-to-talk (hold + click-toggle) wired end-to-end
- STT sidecar (whisper.cpp CLI) with no-native-addon guarantee by construction
- Half-duplex micGated gate with 800ms cooldown, tested in unit tests
- Kokoro TTS renderer playback path with webgpu→wasm fallback
- All voice UI components (VoiceStatusDot, VoiceHUDBand, VoicePTTButton) properly wired into App.tsx and Topbar.tsx — not orphaned
- VoiceModelDownload onboarding step wired into OnboardingWizard — not orphaned
- Packaging config (extraResources + mac.binaries) locked by static guard; Windows binaries staged and verified
- VOICE-04, VOICE-01, VOICE-07 all satisfiable by the code

The deferred items (macOS binary procurement, packaged launch on 16 GB machine, laptop-speaker acoustic test, RAM ceiling measurement) are correctly documented in 15-RAM-CEILING.md, build/whisper/README.md, and tests/e2e/packaged-launch.spec.ts — these are the expected remaining proof steps for a Windows-only dev environment.

The one code gap (lazy PTT-to-modal routing) is a UX degradation, not a safety issue. The developer should decide whether to close it in this phase or accept it with an override.

---

_Verified: 2026-06-04T07:00:00Z_
_Verifier: Claude (gsd-verifier)_
