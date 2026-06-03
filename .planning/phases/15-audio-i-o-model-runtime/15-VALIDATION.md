---
phase: 15
slug: audio-i-o-model-runtime
status: draft
nyquist_compliant: false
wave_0_complete: false
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

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 15-01-01 | 01 | 0 | VOICE-04 | — | sidecar binary is a pure CLI — `NODE_MODULE_VERSION` crash impossible by construction | static | `npx vitest run tests/static/<sidecar-no-addon>.spec.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Static ratchet spec proving the STT path ships no Node native addon (`.node`) — SC2 by construction (VOICE-04/SC2)
- [ ] Spike: confirm CSP allows `blob:` in `script-src` for the AudioWorklet (research open question a)
- [ ] Spike: confirm `navigator.gpu` (WebGPU) availability in Electron 41 / Chromium 130 for kokoro-js (open question b)
- [ ] Spike: confirm cmake-built macOS `whisper-cli` external dylib dependencies / whisper.cpp binary procurement path (open question c)
- [ ] Shared fixtures: fake PCM frame generator + mock sidecar stdio for unit tests with no real binary

*Planner refines exact file paths and which spikes become blocking Wave 0 tasks.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Packaged app launches with no `NODE_MODULE_VERSION` ABI crash | VOICE-04 / SC2 | Requires the signed/notarized packaged build on Win + macOS | Build packaged app; launch; confirm clean start + STT sidecar spawns |
| Half-duplex gate holds on **laptop speakers** (Aria never transcribes its own TTS) | VOICE-07 / SC3 | Real acoustic echo path; cannot be unit-tested | Trigger Kokoro TTS on laptop speakers (not headphones); confirm mic stays gated for full playback duration |
| First-run model download flow (progress + resumable + size disclosure + graceful unavailable) | VOICE-04 / SC4 | Network + UX flow on real first run | Fresh profile; trigger download; kill mid-download; confirm resume from Range; confirm size disclosed before start |
| Device hot-swap + permission-denied surfaced as actionable error | VOICE-01 / SC5 | Physical device plug/unplug + OS permission dialog | Unplug/replug mic mid-session; deny mic permission; confirm ToastHost + HUD error state |
| STT(q5_0) + Kokoro + Ollama 8B resident RAM measured on 16 GB no-GPU | (phase goal) | Hardware-bound measurement | Run all three concurrently on a 16 GB machine; record peak resident memory |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
