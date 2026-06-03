# Phase 15: Audio I/O + Model Runtime - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-03
**Phase:** 15-audio-i-o-model-runtime
**Areas discussed:** STT execution model, Default STT model + download flow, Push-to-talk interaction, Mic-state HUD placement, TTS scope (boundary clarification)
**Mode:** Advisor (full_maturity calibration tier; technical framing — `Learning: guided` non-technical signal overridden, user is a senior dev)

---

## STT execution model

| Option | Description | Selected |
|--------|-------------|----------|
| Sidecar CLI binary | Persistent prebuilt whisper.cpp CLI as a child process over stdio; zero Node-ABI (SC2 crash impossible by construction); crash-isolated; reuses resourcesPath pattern; per-platform binary signing cost | ✓ |
| utilityProcess + native addon | Electron-recommended crash isolation; still a .node (ABI-coupled, rebuild per Electron bump); verify #42978 | |
| smart-whisper in main process | Simplest/lowest latency; segfault crashes whole app; last published 2024-10 | |
| whisper-node-addon (prebuilt .node) | No compile toolchain; 14★; prebuilt ABI-141 matrix unverified | |

**User's choice:** Sidecar CLI binary (Recommended)
**Notes:** Decisive factor was SC2 ("no NODE_MODULE_VERSION crash") + the project's documented native-ABI pain history. utilityProcess kept as the documented fallback if binary signing proves intractable.

---

## Default on-device STT model

| Option | Description | Selected |
|--------|-------------|----------|
| large-v3-turbo q5_0 | 547MB / ~1.1-1.3GB RAM, WER ~2.5%; "last good quant"; best headroom on 16GB | ✓ |
| large-v3-turbo q8_0 | 874MB / ~1.7-2.0GB RAM, ~f16 accuracy; ~0.6GB heavier; needs under-load benchmarking | |
| small q8_0 default + turbo upgrade | 264MB bundled offline stub, WER ~3.4%; perceptible accuracy gap | |
| large-v3-turbo f16 (full) | 1.62GB / ~2.3GB RAM; no real gain over q8; tight on 16GB | |

**User's choice:** large-v3-turbo q5_0 (Recommended)
**Notes:** q8_0 / f16 retained as opt-in upgrades pending benchmarking / 32GB+ machines.

---

## First-run model-download flow

| Option | Description | Selected |
|--------|-------------|----------|
| Onboarding opt-in step + lazy fallback | Skippable wizard step + lazy first-PTT modal (skip path needs the fallback anyway); both carry progress/resume/size-disclosure/unavailable state | ✓ |
| Lazy first-PTT modal only | Leanest install; download as a surprise wait at first PTT | |
| Settings 'Enable Voice' toggle | Cleanest consent; voice undiscoverable until Settings visited | |
| Silent background after vault seal | Zero friction; ~547MB without explicit consent — weak fit for local-first | |

**User's choice:** Onboarding opt-in step + lazy fallback (Recommended)

---

## Push-to-talk interaction

| Option | Description | Selected |
|--------|-------------|----------|
| In-app hold + click-toggle | Focused-window DOM keydown/keyup hold (true turn-end) + click-toggle for hands-free; zero OS permission; global deferred to Phase 18 | ✓ |
| In-app hold-to-talk only | Simplest minimal-but-complete VOICE-01 path | |
| Add global toggle (globalShortcut) | Works from tray; toggle-only (no hold); OS-conflict handling | |
| Global hold via uiohook-napi | True global hold; native ABI rebuild + macOS Input Monitoring permission | |

**User's choice:** In-app hold + click-toggle (Recommended)
**Notes:** Electron globalShortcut has no keyup (#26301) → global hold impossible without a native module; deliberately kept out of an ABI-heavy phase.

---

## Mic-state indicator placement

| Option | Description | Selected |
|--------|-------------|----------|
| Hybrid: Topbar dot + HUD band | Always-visible StatusDot (SC3) + transient HUD band in the TrialBanner slot; no z-index war, no idle layout shift; aria-live; scales to Phase 16 | ✓ |
| Floating voice pill | Self-contained, zero layout shift; fights editorial aesthetic; z-index coordination | |
| Topbar-integrated widget | Minimum chrome; transcription expansion shifts content each turn | |
| Per-screen inline | (Not offered — fails SC3 always-visible by definition) | |

**User's choice:** Hybrid: Topbar dot + HUD band (Recommended)

---

## TTS scope this phase (boundary clarification)

| Option | Description | Selected |
|--------|-------------|----------|
| Real Kokoro engine, minimal trigger | Real kokoro-js playback + half-duplex gate, triggered by a fixed confirmation/echo; proves TTS packaging + RAM ceiling; verified on laptop speakers. Streaming briefing/answers = Phase 16 | ✓ |
| Placeholder tone only | Prove gate with a beep; defer all real Kokoro to Phase 16; leaves packaging + RAM unproven | |
| Full streaming spoken output now | Phase 16 scope pulled forward; overloads Phase 15 | |

**User's choice:** Real Kokoro engine, minimal trigger (Recommended)

---

## Claude's Discretion

- Sidecar stdio framing protocol; exact whisper.cpp binary procurement (release binaries vs CI build).
- Exact resumable-download library; precise migration number for the voice model-readiness pref (≥ 136).
- AudioWorklet bundling specifics; VAD threshold values (within the trim-vs-endpoint roles).
- `VoiceHUDBand` expansion technique (`grid-template-rows` vs `max-height`).

## Deferred Ideas

- Streaming cascade + barge-in + spoken briefing/answer playback — Phase 16.
- Voice-driven writes, read-back, dual-channel confirm UX, cloud opt-in + consent, voice settings — Phase 17.
- Always-listening wake-word + global/tray activation (Picovoice vs openWakeWord licensing) — Phase 18.
- q8_0 / f16 model opt-ins (post-benchmark); Chatterbox-Turbo as selectable alternate voice.
