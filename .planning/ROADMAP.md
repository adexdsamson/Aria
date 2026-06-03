# Aria Roadmap

**Project:** Aria — local-first desktop AI executive assistant

## Milestones

- **v1.0** — ✅ SHIPPED 2026-06-02 — Phases 1–13 (incl. 08.1). Daily briefing + approval-gated chief-of-staff actions (email/calendar/meetings/tasks), RAG + Knowledge Folders, insights/recap, subscription, editorial UI, research, background tray, open-source prep. Full detail: [milestones/v1.0-ROADMAP.md](./milestones/v1.0-ROADMAP.md) · audit: [v1.0-MILESTONE-AUDIT.md](./v1.0-MILESTONE-AUDIT.md) · summary: [MILESTONES.md](./MILESTONES.md)

---

## Current Milestone: v2.0 — Voice Interface

**Goal:** Aria becomes voice-driven — a full conversational, talk-to-Aria assistant layered over the existing briefing / triage / scheduling / ask / drafting surfaces. Voice is a new input/output **modality**, not a rebuild: every outbound action still routes through the existing `assertApproved` chokepoint.

**Locked decisions (carry into every phase's context):**
- **Hybrid audio, local-first default + cloud opt-in.** On-device STT (Whisper large-v3-turbo, MIT) + on-device TTS (Kokoro-82M / Chatterbox-Turbo) by default; consent-gated cloud STT/TTS opt-in mirrors the existing hybrid-LLM routing. Sensitivity-flagged turns stay on-device regardless of opt-in.
- **Push-to-talk first; wake-word last** (opt-in, OFF by default, licensing-gated).
- **Voice-confirm routes THROUGH `assertApproved`, never around it.** A spoken "yes" produces the same explicit approval transition the UI click does; the unified send adapter still runs the gate.
- **STT in a sidecar/worker** (mirrors the Ollama sidecar pattern) to dodge the Electron-41 native-addon ABI trap; renderer owns all audio I/O.
- **Half-duplex mic-gating during playback** — Chromium AEC no-ops in Electron (#47043); do not build on `echoCancellation: true`.

**Phase numbering continues from v1.0** (which ended at Phase 13). v2.0 = Phases 14–19.

### Phases

- [x] **Phase 14: Voice Safety / Confirm Contract** - Design the voice-confirm contract, the HARD GATE blocking voice from forced/high-severity, and the STATIC RATCHET on voice write-paths — before any fluency work. (completed 2026-06-03)
- [ ] **Phase 15: Audio I/O + Model Runtime** - Renderer mic/VAD/playback + STT sidecar that survives packaging; prove AEC + ABI + RAM + device handling on the packaged app.
- [ ] **Phase 16: Streaming Cascade + Barge-in (read-only)** - The "feels conversational" loop with zero write risk: streaming STT→LLM→TTS, barge-in, spoken briefing/answer playback.
- [ ] **Phase 17: Voice-Confirm + Writes Through the Gate** - Voice-driven triage/scheduling/drafting via the confirm flow + assertApproved; mishear recovery; cloud opt-in consent + voice settings.
- [ ] **Phase 18: Opt-in Wake-Word + Privacy Isolation** - "Hey Aria" in a privacy-isolated, provably-killable process, OFF by default — gated on the commercial wake-word licensing decision.
- [ ] **Phase 19: Cloud Opt-in Polish + Performance** - GPU whisper, MessagePort PCM, voice-priority p-queue lane, idle model unload, accessibility polish. (Optimization, not net-new capability.)

## Phase Details

### Phase 14: Voice Safety / Confirm Contract
**Goal**: The voice-to-approval safety contract exists and is enforced before any conversational fluency is built — voice can stage but never auto-execute, and high-stakes actions can never be authorized by voice alone.
**Depends on**: Nothing (first phase of v2.0; extends existing `assertApproved` / approval-transition / static-grep patterns)
**Requirements**: VOICE-10
**Success Criteria** (what must be TRUE):
  1. A voice-staged action lands as an approval row in `state='draft'` and is never executed without a separate explicit confirm turn.
  2. The approval gate rejects a voice-confirm (`approval_path='voice-explicit'`) for forced categories (financial/legal/HR) and `severity==='high'`, forcing the on-screen typed/clicked confirm — verifiable by a failing-then-passing gate test.
  3. The static-grep ratchet fails the build if the voice handler is a direct caller of `send.ts` / `write-event.ts` / `push-actions.ts`, proving voice routes through the same staging the UI uses.
  4. A voice confirm of a low/medium-severity action performs the SAME `approve()` transition the Approvals UI performs, then runs the unchanged unified send adapter (`assertApproved`).
**Plans**: 3 plans (2 waves)
  - [x] 14-01-PLAN.md — Schema + type foundation: ApprovalPath union extension + v134 CHECK-widening migration (.sql + embedded.ts)
  - [x] 14-02-PLAN.md — Named voice-forbidden-forced gate branch + dormant voiceConfirm seam + SC2/SC4 tests
  - [x] 14-03-PLAN.md — Two static ratchets (chokepoint caller allow-list + named voice ratchet) + ARCHITECTURE.md reconciliation

### Phase 15: Audio I/O + Model Runtime
**Goal**: Aria can capture the user's voice, detect speech endpoints, run local transcription that survives packaging, and play synthesized speech — proven on the packaged app on Windows + macOS, without echoing itself or breaking the native-addon ABI.
**Depends on**: Phase 14
**Requirements**: VOICE-01, VOICE-04, VOICE-07
**Success Criteria** (what must be TRUE):
  1. User holds a hotkey (or clicks) to talk and sees their words transcribed live on screen (push-to-talk + live transcription).
  2. Transcription runs fully on-device by default (local Whisper via the STT sidecar/worker) — no audio leaves the machine, and the packaged app launches with no `NODE_MODULE_VERSION` ABI crash.
  3. Mic state is always visible (listening / processing / speaking), and the mic is gated during TTS playback so Aria never transcribes its own speech (verified on laptop speakers, not just headphones).
  4. First-run model download is a designed flow (progress + resumable + size disclosure + graceful "voice unavailable until ready" state), not a bare spinner.
  5. Plugging/unplugging an audio device mid-session is handled gracefully (device hot-swap + 16 kHz resample + permission-denied surfaced as an actionable error).
**Plans**: TBD
**UI hint**: yes

### Phase 16: Streaming Cascade + Barge-in (read-only)
**Goal**: Aria holds a natural spoken conversation over read-only surfaces — it starts speaking before it finishes thinking, the user can interrupt and be heard immediately, and context carries across turns. Zero write risk.
**Depends on**: Phase 15
**Requirements**: VOICE-02, VOICE-03, VOICE-06
**Success Criteria** (what must be TRUE):
  1. Aria reads the daily briefing aloud with working pause / skip-section / speed (0.5–2x) controls.
  2. Aria speaks `/ask` answers aloud, streaming the first sentence while the rest is still generating (first-audio p50 well under ~900 ms, visible in per-stage telemetry).
  3. The user can talk over Aria and Aria stops promptly (<~200 ms): the single per-turn AbortController cancels the LLM stream, flushes the TTS queue, stops audio playback, and persists the spoken-so-far portion to context.
  4. Aria maintains context across turns (referent resolution like "that one" / "and then") so a multi-turn read-only conversation feels coherent.
  5. A backchannel ("mhm", "right") does not interrupt Aria, but a real interruption does.
**Plans**: TBD
**UI hint**: yes

### Phase 17: Voice-Confirm + Writes Through the Gate
**Goal**: The user can do real chief-of-staff work by voice — triage, schedule, draft, push tasks — and every action that writes is read back with resolved entities and explicitly confirmed before the existing gate runs. Hybrid local/cloud audio is available behind consent, and the user controls voice settings.
**Depends on**: Phase 16 (read-only loop + barge-in/cancellation battle-tested first) and Phase 14 (the confirm contract it now exercises)
**Requirements**: VOICE-05, VOICE-08, VOICE-09, VOICE-11
**Success Criteria** (what must be TRUE):
  1. User can drive triage / scheduling / `/ask` / drafting by voice, and each voice intent calls the same in-process service the existing IPC handler uses (never re-crossing the preload bridge).
  2. Before any send / calendar change / task push, Aria reads back the RESOLVED entities (resolved contact email, absolute date/time in the user's tz — never the raw transcript) and requires an explicit dual-channel confirm; high-severity / forced categories fall back to the on-screen tap.
  3. The user can correct or cancel a mis-recognized command (spoken "cancel / stop / never mind", recognized even mid-read-back) before it acts.
  4. User can opt into cloud STT/TTS via an explicit consent + data-handling disclosure gate; sensitivity-flagged turns stay on-device regardless of the opt-in.
  5. User can set voice / speed / local-vs-cloud output preferences in Settings, and the choice is honored per turn.
**Plans**: TBD
**UI hint**: yes

### Phase 18: Opt-in Wake-Word + Privacy Isolation
**Goal**: A user who opts in can say "Hey Aria" to start a turn hands-free, with the always-listening detector running in a privacy-isolated, provably-killable process — OFF by default, and never sending or persisting raw audio.
**Depends on**: Phase 17 (push-to-talk + indicator + consent must ship first); gated on the commercial wake-word licensing decision (openWakeWord pretrained = non-commercial; Porcupine free tier caps at 3 MAU)
**Requirements**: VOICE-12
**Success Criteria** (what must be TRUE):
  1. Wake-word is OFF by default and enabled only through an explicit consent + disclosure toggle in Settings.
  2. When enabled, the detector runs in a separate, mic-isolated process that emits only a boolean trigger to main — pre-trigger audio lives in a ring buffer that is never written to disk or forwarded.
  3. Toggling wake-word off provably terminates that process (mic goes cold), and a visible "mic active" indicator is shown whenever it is listening.
  4. OS mic permission is requested lazily at first voice use, not at app launch.
**Plans**: TBD
**UI hint**: yes

### Phase 19: Cloud Opt-in Polish + Performance
**Goal**: The voice loop is dialed in for latency, quality, and resource use across the local and cloud paths — fast enough to feel effortless on the target laptop, with accessibility polish. Optimization of capabilities already shipped in 14–18; no net-new requirement.
**Depends on**: Phase 17 (and Phase 18 if wake-word shipped)
**Requirements**: _(none net-new — tunes VOICE-04 / VOICE-05 / VOICE-06 already delivered)_
**Success Criteria** (what must be TRUE):
  1. GPU-build whisper (Metal / CUDA / Vulkan) is selected when available and measurably cuts STT decode latency vs the CPU path.
  2. A hardware-capability probe routes under-spec machines to a lighter model or recommends cloud opt-in, and STT+TTS+LLM co-resident stays within RAM budget (lazy-load + idle-unload, RTF ≤ 1 on a 16 GB no-GPU laptop).
  3. Interactive voice turns are not stalled by a background briefing/sync (voice-priority p-queue lane), and the tuned latency budget holds under load.
  4. Accessibility polish lands: eyes-free TTS plus on-screen captions of Aria's speech.
**Plans**: TBD
**UI hint**: yes

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 14. Voice Safety / Confirm Contract | 3/3 | Complete   | 2026-06-03 |
| 15. Audio I/O + Model Runtime | 0/0 | Not started | - |
| 16. Streaming Cascade + Barge-in | 0/0 | Not started | - |
| 17. Voice-Confirm + Writes Through the Gate | 0/0 | Not started | - |
| 18. Opt-in Wake-Word + Privacy Isolation | 0/0 | Not started | - |
| 19. Cloud Opt-in Polish + Performance | 0/0 | Not started | - |

### Research Flags

Phases likely needing deeper `/gsd-research-phase` during planning:
- **Phase 15** — highest uncertainty: whisper.cpp binding under Electron 41 (sidecar vs addon, empirical build); Chromium AEC no-op (#47043) verified on Win + macOS; RAM ceiling of STT+TTS+LLM on 16 GB no-GPU; Kokoro WASM vs WebGPU perf.
- **Phase 18** — the wake-word licensing/cost decision (pay Picovoice / train custom openWakeWord / defer to v2.1) must be resolved before any dependency is added.

Lighter research (standard patterns extending existing Aria source): Phase 14 (assertApproved / static ratchet / approval transitions), Phase 16 (AI SDK streamText + sentence-split + streaming TTS).
