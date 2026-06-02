# Project Research Summary

**Project:** Aria — v2.0 Voice Interface milestone
**Domain:** Hybrid (local-first + cloud-opt-in) duplex voice interface layered over a shipped Electron/Node/TS local-first AI exec assistant
**Researched:** 2026-06-02
**Confidence:** MEDIUM-HIGH

## Executive Summary

v2.0 layers a **conversational voice channel** over Aria's already-shipped surfaces (briefing, triage, scheduling, /ask, drafting) without re-implementing any of them. Voice is purely a new **input modality** (speech in) and **output modality** (speech out) over the existing IPC + service layer; every action that writes still routes through the same assertApproved chokepoint. Experts build this as a **local cascading pipeline** — VAD to STT to LLM to sentence-split to TTS to playback — with VAD-driven turn-taking and barge-in. True single-model duplex (Moshi) needs A100-class hardware and is explicitly rejected; half-duplex-with-fast-barge-in is the 2026 norm and the locked approach.

The recommended runtime is **local by default, cloud strictly opt-in** (mirroring the existing hybrid-LLM consent pattern). STT = whisper.cpp (Whisper large-v3-turbo) run **in a worker/sidecar, never in-process on the main loop** — the research strongly prefers a sidecar to dodge the Electron native-addon ABI trap that has bitten Aria repeatedly via better-sqlite3. TTS = kokoro-js (Kokoro-82M, Apache-2.0) **in the renderer** so synthesized audio plays immediately with no audio hop back from main. VAD = Silero via @ricky0123/vad-web in the renderer next to capture. Cloud opt-in reuses the openai SDK already in Aria's orbit. The **single biggest commercial trap** is wake-word licensing: openWakeWord pretrained models are CC BY-NC-SA (non-commercial) and Porcupine is free only to 3 monthly-active-users, then $6k–$30k/yr — so always-listening must be gated on a separate license/build decision and **push-to-talk ships first**.

The load-bearing design of the whole milestone is the **voice-confirm safety contract**: voice may stage an action but never auto-execute. The pattern is **Stage to verbatim read-back of resolved entities to dual-channel explicit confirm to existing assertApproved gate**. Voice is **blocked from the forced-explicit / high-severity override** (financial/legal/HR and high severity still require the typed/clicked confirm), and the existing static-grep ratchet must be **extended to voice write-paths** so a misheard yes can never reach a provider send. The top engineering risks are echo/AEC (Chromium echoCancellation no-ops in Electron per bug #47043 — use half-duplex mic-gating), barge-in cancellation that must abort LLM+TTS+audio through one AbortController, perceived latency (must stream end-to-end), the whisper ABI question, and RAM pressure of STT+TTS+LLM co-resident on a 16GB no-GPU laptop.

## Key Findings

### Recommended Stack

The runtime split is **renderer owns all audio I/O** (mic capture, VAD, TTS playback — Web Audio is renderer-only in Electron) while **main owns STT/intent/generation/gate**. Versions and licenses were verified against the npm registry on 2026-06-02; everything is commercial-use-safe except the wake-word path, which is intentionally left out of the install set pending a license decision. Native STT addons must join Aria's existing electron-rebuild dual-ABI matrix — or, preferred, run as a sidecar.

**Local default path (no consent needed):**
- **whisper.cpp** via **smart-whisper 0.8.1** (MIT) primary / **nodejs-whisper 0.3.0** (MIT) fallback / **whisper-node-addon 1.0.2** (MIT, prebuilt) as ABI insurance — local STT (Whisper large-v3-turbo). **SIDECAR/worker recommended over in-process addon** to sidestep the Electron ABI trap and isolate crashes/memory.
- **kokoro-js 1.2.1** (Apache-2.0) — local TTS (Kokoro-82M) in the **renderer** via Transformers.js/ONNX with TextSplitterStream for chunk-by-chunk streaming. No native build, no key.
- **@ricky0123/vad-web 0.0.30 / vad-react 0.0.36** (ISC) — Silero VAD in the renderer, drives endpointing + barge-in.
- **AudioWorklet** (no package) — getUserMedia to 16 kHz mono PCM framing at the renderer edge.

**Cloud opt-in path (consent-gated, max quality):**
- **openai 6.41.0** (Apache-2.0) — audio.transcriptions + audio.speech, reuses the existing key + consent UX.
- **@openai/agents-realtime 0.11.6** (MIT) — optional full-duplex WebRTC tier.
- **@elevenlabs/elevenlabs-js** — optional premium TTS tier (~20x OpenAI per-char cost; upsell only).

**Wake-word (DEFERRED — licensing gate):** openWakeWord pretrained = **CC BY-NC-SA (non-commercial)**; **Picovoice Porcupine** free only <=3 MAU, then $6k–$30k/yr. Decision required before adding any dependency.

**Maintenance flags:** smart-whisper last published 2024-10 (keep nodejs-whisper / whisper-node-addon wired-but-disabled); vad-* are pre-1.0 (pin exact); Porcupine cost cliff is the single biggest commercial trap.

### Expected Features

**Must have (table stakes — P1):**
- **Push-to-talk + local STT** — the safe, precise baseline; everything depends on it; zero licensing cost.
- **Live transcription display + visible mic/state indicator** — trust + privacy clarity; the audit trail for what did I just ask.
- **Read-back + explicit confirm before any irreversible action** — the non-negotiable safety pattern (see contract below).
- **Spoken briefing playback** (pause/resume/skip-section/0.5-2x speed) — turns the wedge into an eyes-free ritual.
- **Spoken /ask answer playback** — natural pairing; reuses RAG AnswerService.
- **Voice-driven triage / scheduling / drafting** — the chief-of-staff payoff, each behind the confirm flow.
- **Multi-turn context** (referent resolution: that one, then) — without it voice feels broken.
- **Error/mishear recovery + confidence-aware routing** — low STT confidence clarifies rather than acts.
- **Cloud opt-in consent + disclosure gate** — must exist before any cloud audio path is offered.
- **Voice/output settings** — pick voice, speed, enable/disable spoken output.

**Should have (differentiators — P2):**
- **Fully on-device voice by default** — the positioning differentiator vs Copilot/Gemini/Siri.
- **Barge-in / interruption** (~200 ms) — borderline table-stakes; promote if dogfood feels robotic.
- **Voice-confirm flow tuned to assertApproved** — safely authorize irreversible work by voice.
- **Opt-in wake-word (Hey Aria)**, off by default, on-device, visible indicator.
- **Accessibility as a first-class win** — eyes-free TTS + captions of Aria's speech.

**Defer / anti-features (do NOT build as default):**
- **Open-mic always-listening (no wake word / no PTT)** — shreds privacy posture; PTT + opt-in wake-word instead.
- **Voice-only confirm for irreversible sends** (bare yes sends it) — spoofable by ambient speech; require phrase-or-click, high-severity forces click.
- **Autonomous auto-send** (just handle my email) — breaks the trust guarantee; human-in-the-loop only.
- **Cloud STT/TTS on by default** — sends raw biometric audio off-machine; local default, cloud opt-in only.
- Reading sensitive content aloud unprompted; voice biometric auth; true single-model full-duplex; custom/branded wake words; spoken notifications. (All deferred or cut.)

### The Voice-Confirm Safety Contract (load-bearing)

This is the gating design decision of the entire milestone. **Voice never invents a new authorization path.**

**Stage to Read-Back to Dual-Channel Explicit Confirm to existing assertApproved to Audit/Undo:**
1. Voice **stages** an approval row (state=draft), never auto-executes.
2. Aria reads back the **resolved entities** (resolved contact email, absolute date/time in user tz — never the raw transcript), so a mis-resolution is audible before it is actionable.
3. **Dual-channel confirm:** normal sensitivity accepts a confirmation phrase (yes, send it) or a click; **high-severity / forced categories (financial/legal/HR) require the typed/clicked confirm.**
4. The confirm performs the **same** approve() transition the UI does (approval_path=voice-explicit), then the **same unified send adapter runs assertApproved** — unchanged enforcement.
5. **[HARD GATE]** assertApproved must require that forced categories and high severity still demand the screen — **voice can never satisfy the forced-explicit override** (one-line extension of the existing isForced check).
6. **[STATIC RATCHET]** Extend tests/static/single-mail-send-site.test.ts (and write-event / push-action siblings) to prove the voice handler is NOT a direct caller of send.ts / write-event.ts / push-actions.ts. Same shape as the Phase 4/6 silent-write guards.

### Architecture Approach

The integration is grounded against real Aria source: IPC is a registry (ipc-contract.ts to preload auto-maps window.aria.*), handlers register via registerHandlers, main-to-renderer push uses makeRendererEmitter, the send chokepoint is assertApproved in approvals/gate.ts, and LLM dispatch is the AI SDK 6 router. Voice adds new channels to the same registry — **no new bridge mechanism**. The one router-adjacent change is adding a streamText entry point for incremental TTS.

**Major components / seams:**
1. **Renderer features/voice/** — owns mic/VAD/TTS playback; capture worklet (16 kHz PCM) + Silero VAD + kokoro-player share one AudioContext and the barge-in .stop() path. The renderer VoiceSession is a mirror of main's authoritative state.
2. **Main voice/ worker/sidecar (STT)** — whisper.cpp in a worker_thread/utilityProcess, never on the main event loop (would freeze IPC + the gate). PCM in to partials/final out.
3. **Main VoiceOrchestrator + IntentRouter** — authoritative turn-taking state machine; owns the per-turn AbortController. generateObject + Zod to typed IntentResult.
4. **intent/surfaces.ts — the single integration seam.** Maps intent to the **same in-process service function** the existing IPC handler calls (briefing/triage/scheduling/ask/drafting). It does **NOT re-cross the bridge** — one file to audit for does every voice action route through the same gates as the UI.
5. **confirm.ts** — deliberately NOT a gate; turns a spoken yes into the exact same approval-row transition the UI performs; real enforcement stays in assertApproved.
6. **Wake-word utilityProcess** — opt-in, mic-isolated, emits **only a boolean trigger** (never raw audio), independently killable.

**Key patterns:** dual-lane transport (control over IPC, PCM over MessagePort/zero-copy — start on ipcRenderer payloads, migrate to MessagePort as a perf milestone, not a launch blocker); streaming cascade (first sentence to TTS while the LLM still generates — 40-60% perceived-latency win); barge-in via **one AbortController per turn** threaded through LLM-abort + TTS-flush + audio-stop + partial-turn-persist. Latency target: user-stops to first audio <= ~900 ms local; barge-in cut < 150-200 ms.

### Critical Pitfalls

1. **Voice-triggering an irreversible action without read-back + explicit confirm (THE BIG ONE)** — a misheard recipient/time/name sends to the wrong exec. Avoid via the safety contract above: stage-only, resolved-entity read-back, dual-channel confirm, **[HARD GATE]** voice blocked from forced-explicit, **[STATIC RATCHET]** on voice write-paths.
2. **Mic captures Aria's own TTS to self-interruption / feedback loop (AEC failure)** — Chromium echoCancellation:true **no-ops in Electron (#47043)** and cannot see custom-buffer audio. Avoid: **half-duplex mic-gating during playback** as primary defense + ~1-1.5 s elevated-threshold cooldown; verify empirically on Win + macOS speakers; explicit AEC with TTS as reference only for true barge-in.
3. **Barge-in done wrong — fails to cancel in-flight LLM+TTS** — Aria finishes the old thought. Avoid: one AbortController per turn propagated to LLM stream + TTS queue + audio buffer; <200 ms suppression; backchannel-vs-barge-in classifier; persist the spoken-so-far portion to context.
4. **Perceived latency — full LLM/TTS before first audio** (2-4 s dead air, users repeat). Avoid: stream end-to-end, first sentence to TTS immediately, per-stage telemetry, instant ack earcon for retrieval latency.
5. **Electron native-addon ABI break for whisper bindings** — Aria has been bitten by this exact class (better-sqlite3 NODE_MODULE_VERSION). Avoid: **prefer sidecar/worker over in-process addon**; if unavoidable, fold into the existing electron-rebuild dual-build and smoke-test the packaged app.
6. **Cloud audio leaves the machine without true consent** — biometric audio cannot be PII-redacted pre-send. Avoid: sensitivity-flagged turns **stay local-only, period**; consent + provider disclosure; **[STATIC RATCHET candidate]** no cloud-STT site reachable without consent + sensitivity check.
7. **Local model RAM burden on 16GB no-GPU laptop** — STT + TTS + Ollama LLM + Electron compete. Avoid: holistic RAM budget, turbo + quantized models, lazy-load + idle-unload, resumable first-run download UX (not a bare spinner), hardware probe to recommend cloud/PTT-only if under spec.

## Implications for Roadmap

Research converged on a dependency-ordered build sequence continuing from **Phase 14** (v1.0 ended at Phase 13). The two non-negotiable prerequisites are the **safety/confirm contract** and the **audio/AEC/runtime** plumbing; everything else builds on them. Write-through-the-gate deliberately follows the read-only conversational loop so barge-in/cancellation is battle-tested before any spoken action can send.

### Phase 14: Voice Safety / Confirm Contract
**Rationale:** This is the gating architectural decision — design it BEFORE conversational fluency. Cheap to do first, catastrophic to retrofit.
**Delivers:** confirm.ts voice-to-approval-transition helper, the voice-explicit approval path, the **[HARD GATE]** extension to assertApproved (voice blocked from forced categories + high severity), and the **[STATIC RATCHET]** extension proving voice never directly calls send/write-event/push.
**Addresses:** Read-back + explicit confirm (table stakes); voice-confirm differentiator.
**Avoids:** Pitfall 1 (the product-killing one).

### Phase 15: Audio I/O + Model Runtime (sidecar)
**Rationale:** All features need capture/playback + a working STT runtime that survives packaging. AEC and ABI must be proven on the packaged app before building on top.
**Delivers:** renderer AudioWorklet 16 kHz PCM capture + Silero VAD + Kokoro playback of canned text; whisper STT in a **sidecar/worker** with packaged-app launch smoke; half-duplex mic-gating; device hot-swap + resample + permission-denied handling; first-run model download UX.
**Uses:** kokoro-js, vad-web, smart-whisper/whisper-node-addon (sidecar), AudioWorklet.
**Avoids:** Pitfalls 2 (AEC), 5 (VAD tuning), 8 (RAM), 9 (ABI), 10 (device hell).

### Phase 16: Streaming Cascade + Barge-in (read-only)
**Rationale:** The feels-conversational milestone, proven with **zero write risk**. Cancellation must be designed in, not retrofitted.
**Delivers:** streamText entry point + sentence-splitter to streaming TTS; the IDLE-LISTENING-SPEAKING state machine; barge-in via one AbortController; read-only intents (ask/briefing/summarize) through intent/surfaces.ts; per-stage latency telemetry; spoken briefing/answer playback.
**Implements:** VoiceOrchestrator, IntentRouter, dual-lane transport, streaming cascade, barge-in patterns.
**Avoids:** Pitfalls 3 (barge-in), 4 (latency).

### Phase 17: Voice-Confirm + Writes Through the Gate
**Rationale:** Highest trust stakes — do AFTER the read-only loop proves the conversation machinery. Also folds in hybrid voice routing + consent.
**Delivers:** write intents (send/schedule/draft/task) to confirm flow to assertApproved; VoiceConfirmDialog; high-severity-forces-visual-tap; consent-gated cloud STT/TTS adapters with per-turn sensitivity routing; hardware-aware model selection.
**Addresses:** voice-driven triage/scheduling/drafting; cloud opt-in route.
**Avoids:** Pitfalls 1 (reinforced), 6 (cloud consent), 8 (HW-aware routing).

### Phase 18: Opt-in Wake-Word + Privacy Isolation
**Rationale:** Independent, opt-in, riskiest privacy surface — ships only after PTT + indicator + consent are proven. **Gated on the wake-word licensing decision.**
**Delivers:** opt-in utilityProcess KWS, consent UX, mic-active indicator, powerMonitor suspend, off-by-default, provably-killable.
**Addresses:** opt-in wake-word differentiator.
**Avoids:** Pitfall 6 (wake-word privacy/false-fire/battery/permission).

### Phase 19: Cloud Opt-in Polish + Performance
**Rationale:** Optimization, not core. Pure perf/quality dial-in.
**Delivers:** GPU-build whisper (Metal/CUDA/Vulkan), MessagePort migration if profiling demands, voice-priority p-queue lane, idle model unload, tuned latency budget, accessibility polish.
**Uses:** MessagePort, GPU EPs, capability probe.

### Phase Ordering Rationale

- **Safety contract first (14)** because it is the gating trust decision and is far cheaper to design before fluency than to retrofit; the static ratchet must exist before any voice write-path is written.
- **Audio/runtime second (15)** because every feature depends on capture/playback and a packaged-app-survivable STT runtime; AEC + ABI are de-risked here, not later.
- **Read-only loop before write actions (16 before 17)** so barge-in/cancellation is battle-tested where a bug is harmless before any spoken command can send/move.
- **Wake-word isolated and late (18)** — independent of the core loop, riskiest privacy surface, and **blocked on a commercial licensing decision**.
- **Perf last (19)** — streaming gets good-enough in 16; GPU/MessagePort/queue-priority are optimizations.

### Research Flags

Phases likely needing deeper /gsd-research-phase during planning:
- **Phase 15 (Audio I/O + runtime):** highest-uncertainty phase. Open questions: **whisper.cpp binding under Electron 41 ABI** (sidecar vs addon — empirical build needed); **Chromium AEC no-op (#47043)** must be verified on Win + macOS; **RAM ceiling** of STT+TTS+LLM on a 16GB no-GPU laptop (RTF measurement); **Kokoro WASM vs WebGPU** perf on the target hardware.
- **Phase 18 (Wake-word):** the **licensing/cost decision** (pay Picovoice / train custom openWakeWord / defer to v2.1) must be resolved before any dependency is added; utilityProcess mic-isolation model needs validation.

Phases with standard patterns (lighter research):
- **Phase 14 (Safety contract):** mostly extends well-understood existing Aria patterns (assertApproved, static-grep ratchet, approval transitions). Architecture already mapped against real source.
- **Phase 16 (Streaming cascade):** patterns are well-documented (AI SDK streamText + sentence-split + streaming TTS); the seam is verified against source.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions/licenses verified against npm registry 2026-06-02; commercial-fitness checked per package. Wake-word licensing is the one HARD flag, not a gap. |
| Features | MEDIUM-HIGH | Strong 2026 voice-UX sources + verified against existing Aria surfaces; competitor analysis grounded. |
| Architecture | HIGH (boundaries/IPC/gate) / MEDIUM (latency split, wake-word process model) | Main/preload/renderer boundaries + gate integration verified against real Aria source; latency split depends on user hardware. |
| Pitfalls | MEDIUM-HIGH | AEC/latency/barge-in well-corroborated; RAM numbers MEDIUM; Aria-codebase mapping HIGH. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **whisper.cpp ABI under Electron 41:** unresolved — pick sidecar vs in-process addon and prove the packaged app launches in Phase 15 before building features. Default recommendation: sidecar.
- **Electron AEC no-op (#47043):** verify empirically on Win + macOS in Phase 15; do not build on echoCancellation:true — half-duplex gating is the primary defense.
- **RAM ceiling on 16GB no-GPU laptop:** measure RTF with STT+TTS+Ollama co-resident; design lazy-load/idle-unload + hardware-probe fallback in Phase 15/17.
- **Kokoro WASM vs WebGPU perf:** only matters if WASM synth becomes the latency tail; measure in Phase 15, optimize in Phase 19.
- **Wake-word licensing/cost:** resolve before Phase 18 — pay Picovoice ($6k–$30k/yr), train custom openWakeWord on licensed data, or defer always-listening to v2.1. PTT ships first regardless.
- **MessagePort vs ipcRenderer for PCM:** ship on ipcRenderer; migrate to MessagePort only if profiling shows IPC saturation (Phase 19 perf milestone).

## Sources

### Primary (HIGH confidence)
- Aria source (verified reads): ipc-contract.ts, preload/index.ts, ipc/index.ts, approvals/gate.ts, llm/router.ts, ipc/ask.ts — IPC registry, push emitter, the assertApproved chokepoint + forced-explicit override, AI SDK 6 router.
- npm registry (npm view, 2026-06-02) — versions/licenses/publish dates for all stack packages.
- electronjs.org docs + electron/electron#47043 (AEC no-op), #42765/#46369 (desktopCapturer mic crashes) — renderer getUserMedia + AudioWorklet pattern.
- whisper.cpp (ggml-org), kokoro-js (npm/HF) — engine + streaming TTS capabilities.
- Microsoft Support (Live Captions) — accessibility/transcription norm.

### Secondary (MEDIUM confidence)
- Future AGI Voice AI Barge-In and Turn-Taking 2026 — barge-in <200 ms, 95%+, cancellation, context preservation.
- LiveKit Turn Detection — VAD = energy + classifier + min-duration; model-based turn detection.
- Softcery / brain.co — cascading pipeline, streaming, first-audio <300 ms, barge-in cancellation path.
- Gladia Measuring Latency in STT — per-stage latency, RTF.
- DEV Echo Cancellation Problem — half-duplex gating, browser AEC cannot see custom audio.
- Smashing Magazine Designing Agentic AI — Intent Preview, Autonomy Dial, Action Audit & Undo.
- Picovoice wake-word guides — on-device KWS, 97%+ TP, privacy architecture, pricing tiers.
- developers.openai.com Realtime / pricing; ElevenLabs / Deepgram pricing — cloud tier costs.

### Tertiary (LOW confidence)
- HuggingFace memory-requirements discussion (Whisper large-v3 ~2.9GB file / ~3.9GB runtime) — RAM estimates, validate empirically.
- github.com binding-capability READMEs (smart-whisper, whisper-node-addon prebuilt-Electron claims) — verify the actual ABI build in Phase 15.
- Chatterbox-Turbo-ONNX (HF) — optional max-quality TTS path, not the default.

---
*Research completed: 2026-06-02*
*Ready for roadmap: yes*
