---
phase: 15
slug: audio-i-o-model-runtime
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-03
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2 (main + renderer projects) + Playwright `_electron` for packaged E2E |
| **Config file** | `vitest.config.ts` / `electron.vite.config.ts` |
| **Quick run command** | `npm run typecheck` (esbuild skips tsc — type errors otherwise ship and crash at runtime) |
| **Full suite command** | `npx vitest run` (single spec at a time — parallel-projects race, see project memory) |
| **Estimated runtime** | ~30–90 seconds (typecheck); per-spec for vitest |

---

## Sampling Rate

- **After every task commit:** Run `npm run typecheck` (mandatory after any main/preload edit)
- **After every plan wave:** Run the wave's vitest specs (one project at a time)
- **Before `/gsd-verify-work`:** Full suite green + packaged-app smoke (SC2 launch, SC3 laptop-speaker gate)
- **Max feedback latency:** ~90 seconds for typecheck; manual for packaged-app criteria

---

## Per-Task Verification Map

> Populated by the planner. Each task maps to an automated `<verify>` command or a Wave 0 dependency.
> Static-ratchet vitest tests (`tests/static/*`) are the project's idiom for build-time guards
> (esbuild does not run tsc) — prefer them over type-only assertions.
> Wave 0 = Plan 15-01 (contracts + CSP fix + KV prefs + no-cloud-audio ratchet); it is complete
> ahead of every dependent wave. NOTE: model-readiness persists via the `settings(k,v)` KV table
> (`src/main/voice/prefs.ts`) — there is NO migration and NO `user_prefs.voice_model_ready` column.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command |
|---------|------|------|-------------|-----------|-------------------|
| 15-01-01 | 01 | 0 | VOICE-01/04/07 | typecheck | `npm run typecheck` |
| 15-01-02 | 01 | 0 | VOICE-04 | tdd | `npx vitest run src/main/voice/prefs.spec.ts -x` |
| 15-01-03 | 01 | 0 | VOICE-04/07 | static | `npx vitest run tests/static/csp-allows-blob.spec.ts tests/static/voice-audio-no-cloud.spec.ts -x` |
| 15-02-01 | 02 | 1 | VOICE-04 | tdd | `npx vitest run src/main/voice/stt/wav.spec.ts -x` |
| 15-02-02 | 02 | 1 | VOICE-04 | tdd | `npx vitest run src/main/voice/stt/sidecar-manager.spec.ts tests/static/voice-routes-through-staging.spec.ts -x` |
| 15-02-03 | 02 | 1 | VOICE-04 | static | `npx vitest run tests/static/stt-no-native-addon.spec.ts -x` |
| 15-03-01 | 03 | 1 | VOICE-04 | tdd | `npx vitest run src/main/voice/download/model-download.spec.ts tests/static/voice-audio-no-cloud.spec.ts -x` |
| 15-04-01 | 04 | 1 | VOICE-01 | tdd | `npx vitest run src/renderer/features/voice/capture/mic-worklet.spec.ts -x` |
| 15-04-02 | 04 | 1 | VOICE-01 | tdd | `npx vitest run src/renderer/features/voice/capture/useMicCapture.spec.ts -x` |
| 15-05-01 | 05 | 2 | VOICE-01/04 | tdd | `npx vitest run src/main/ipc/voice.spec.ts tests/static/chokepoint-caller-allow-list.spec.ts -x` |
| 15-05-02 | 05 | 2 | VOICE-01/04 | typecheck | `npm run typecheck` |
| 15-06-01 | 06 | 2 | VOICE-07 | tdd | `npx vitest run src/renderer/features/voice/tts/useKokoroPlayer.spec.ts -x` |
| 15-06-02 | 06 | 2 | VOICE-07 | tdd | `npx vitest run src/renderer/features/voice/useVoiceSession.spec.ts tests/unit/voice/half-duplex.spec.ts -x` |
| 15-07-01 | 07 | 3 | VOICE-01/07 | tdd | `npx vitest run src/renderer/features/voice/VoiceStatusDot.spec.tsx src/renderer/features/voice/VoiceHUDBand.spec.tsx -x` |
| 15-07-02 | 07 | 3 | VOICE-01/07 | tdd | `npx vitest run src/renderer/features/voice/VoicePTTButton.spec.tsx -x` |
| 15-07-03 | 07 | 3 | VOICE-01/07 | typecheck | `npm run typecheck` |
| 15-08-01 | 08 | 3 | VOICE-04 | tdd | `npx vitest run src/renderer/features/voice/VoiceModelDownload.spec.tsx -x` |
| 15-08-02 | 08 | 3 | VOICE-04 | tdd | `npx vitest run src/renderer/features/onboarding/OnboardingWizard.spec.tsx -x` |
| 15-09-01 | 09 | 4 | VOICE-04 | static | `npx vitest run tests/static/whisper-binary-packaging.spec.ts -x` |
| 15-09-02 | 09 | 4 | VOICE-04 | checkpoint:human-action | MANUAL — macOS binary procurement + signing (no Apple cert on dev machine); resolved by resume-signal |
| 15-09-03 | 09 | 4 | VOICE-04 | checkpoint:human-verify | `npx playwright test tests/e2e/packaged-launch.spec.ts` (+ manual SC3 laptop-speaker + RAM ceiling) |

*All `auto`/`tdd`/`static` tasks carry an `<automated>` command. The two `15-09` checkpoint tasks are human-action / human-verify by necessity (macOS-runner binary procurement + signed packaged-build acoustic test) — their backstops are the 15-09-01 static guard and the 15-09-03 Playwright packaged-launch E2E.*

---

## Wave 0 Requirements (COMPLETE — Plan 15-01)

- [x] Voice DTO contract + IPC channel registry + preload subscriptions (`npm run typecheck`) — 15-01 Task 1
- [x] Model-readiness KV prefs via `settings(k,v)` / `src/main/voice/prefs.ts` (NO migration, NO `user_prefs` column) — 15-01 Task 2
- [x] CSP allows `blob:` in `script-src` for the AudioWorklet + no-cloud-audio static ratchet — 15-01 Task 3
- [x] Static ratchet proving the STT path ships no Node native addon (`.node`) — SC2 by construction — 15-02 Task 3
- [x] Shared seam: injectable `spawnFn` + fake child stdio for unit tests with no real binary — 15-02 Task 2

*WebGPU availability is no longer a Wave-0 spike: the Plan 15-06 webgpu→wasm Kokoro fallback makes it irrelevant. macOS dylib/binary procurement is the blocking Plan 15-09 Task 2 human-action checkpoint, not a Wave-0 task.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Packaged app launches with no `NODE_MODULE_VERSION` ABI crash | VOICE-04 / SC2 | Requires the signed/notarized packaged build on Win + macOS | Build packaged app; launch; confirm clean start + STT sidecar spawns (15-09 Task 3) |
| Half-duplex gate holds on **laptop speakers** (Aria never transcribes its own TTS) | VOICE-07 / SC3 | Real acoustic echo path; cannot be unit-tested | Trigger Kokoro TTS on laptop speakers (not headphones); confirm mic stays gated for full playback duration |
| First-run model download flow (progress + resumable + size disclosure + graceful unavailable) | VOICE-04 / SC4 | Network + UX flow on real first run | Fresh profile; trigger download; kill mid-download; confirm resume from Range; confirm size disclosed before start |
| Device hot-swap + permission-denied surfaced as actionable error | VOICE-01 / SC5 | Physical device plug/unplug + OS permission dialog | Unplug/replug mic mid-session; deny mic permission; confirm ToastHost + HUD error state |
| STT(q5_0) + Kokoro + Ollama 8B resident RAM measured on 16 GB no-GPU | (phase goal) | Hardware-bound measurement | Run all three concurrently on a 16 GB machine; record peak resident memory (15-09 Task 3) |
| macOS `whisper-cli` procurement + signing | VOICE-04 / SC2 | Needs a macOS runner + Apple Developer cert not present on the dev machine | 15-09 Task 2 human-action checkpoint: build whisper-cli, verify `otool -L` self-containment, sign |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (only the two 15-09 checkpoints are human-gated by necessity, each with an automated backstop)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 90s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved
