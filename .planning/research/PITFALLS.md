# Pitfalls Research

**Domain:** Adding a hybrid (local-first + cloud-opt-in) duplex VOICE interface to an existing Electron 41 / Node / React local-first AI exec assistant (Aria v2.0)
**Researched:** 2026-06-02
**Confidence:** MEDIUM-HIGH (architecture/latency/AEC findings well-corroborated; specific local-model RAM numbers MEDIUM; Aria-codebase mapping HIGH from direct reads)

> **Phase numbering:** v2.0 continues from Phase 14 (v1.0 ended at Phase 13). Phase names below are *suggested* labels for the roadmapper, not yet-existing phases. The two non-negotiable hard gates this research surfaces are flagged **[HARD GATE]** and **[STATIC RATCHET]**.

---

## Critical Pitfalls

### Pitfall 1: Voice-triggering an irreversible/approval-gated action without read-back + explicit voice-confirm (THE BIG ONE)

**What goes wrong:**
The user says "reply to Sarah and tell her yes, Tuesday works." STT mishears a name, a time, or a recipient ("Sarah" → "Sara" → wrong contact; "Tuesday" → "Thursday"; "send to all" instead of "send to Al"). Voice "feels" frictionless, so the build wires the spoken intent straight to the existing send/calendar adapters and auto-executes. An exec's email goes to the wrong person, or a meeting moves on the wrong day. In Aria's trust model — "the user is never surprised by something Aria sent or moved" — this is the single failure that destroys the product.

**Why it happens:**
Two compounding pressures. (1) Voice UX dogma says "minimize friction" — designers strip confirmation steps to feel magical. (2) The path of least engineering resistance is to have the voice agent's tool-call invoke the *same* function the UI button invokes, bypassing the human-in-the-loop screen the chokepoint was designed around. The `assertApproved` gate (`src/main/approvals/gate.ts`) only verifies that a row reached `state='approved'` via the correct `approval_path` — it does NOT know whether a *human looked at a screen* or whether a *voice agent auto-clicked approve*. Voice can satisfy the gate's letter while violating its spirit.

**How to avoid:**
- Voice never auto-executes a send/calendar-change/task-push. Voice can *draft and stage* an approval row (`state='draft'`), but the transition to `approved` MUST come from a **separate, explicit voice-confirm turn after a verbatim read-back**: Aria speaks back the *materialized* action ("I'll email sarah-chen@acme.com: 'Tuesday at 2pm works.' Send it?") and requires an unambiguous affirmative ("send it" / "yes send") — not a backchannel "mhm," not silence, not "okay" mid-sentence.
- **[HARD GATE]** Treat voice-confirm as a NEW `approval_path` value (e.g. `'voice-explicit'`), and make `assertApproved` require that forced categories (financial/legal/hr) and `severity==='high'` rows still demand the *typed/clicked* `'explicit'` path — i.e. **voice can never satisfy the forced-explicit override**. High-stakes sends must fall back to the screen. This is a one-line extension of the existing `isForced` check at gate.ts:84-99.
- **[STATIC RATCHET]** Extend the existing single-send-site static-grep test (`tests/static/single-mail-send-site.test.ts`) and the sibling write-event/push-action chokepoints so the voice command handler is provably NOT in the set of callers that reach `send.ts` / `write-event.ts` / `push-actions.ts` directly. Voice must route through the same approval staging the UI uses.
- Read-back must reflect the *resolved* entities (resolved contact email, absolute date, absolute time in user's tz), never the raw transcript — so a mis-resolution is audible before it's actionable.
- Provide a spoken "cancel / stop / never mind" that aborts the staged action and is recognized even mid-read-back (see barge-in, Pitfall 3).

**Warning signs:**
- A voice tool-call handler `import`s `send.ts`, `write-event.ts`, or `push-actions.ts`.
- Any code path sets `approval_path='explicit'` from a voice event.
- Demo flow shows "Aria, email Bob" → email sent with no second turn.
- No absolute-date/absolute-recipient in the spoken confirmation.

**Phase to address:** **Phase 14 (Voice safety / confirm contract)** — design this BEFORE any conversational fluency work. It is the gating architectural decision of the milestone.

---

### Pitfall 2: Mic captures Aria's own TTS → self-interruption / feedback loop (AEC failure)

**What goes wrong:**
With both mic and speaker open (full duplex), the microphone hears Aria's own spoken output. The VAD/barge-in logic interprets Aria's voice as the user "interrupting," so Aria cuts itself off mid-sentence; or STT transcribes Aria's own TTS and feeds it back into the LLM, producing a self-conversation / runaway loop. On laptop speakers (not headphones) this is the default outcome, not an edge case.

**Why it happens:**
Browser/Chromium AEC (`getUserMedia({ audio: { echoCancellation: true }})`) assumes the "far-end" reference audio is playing through an `<audio>` element or Web Audio graph the browser controls. If TTS audio arrives as raw PCM over a WebSocket/IPC stream and is played through a custom AudioContext/buffer the AEC doesn't "see," there is no reference signal and the echo is never subtracted. **Worse: there is an open Electron bug (electron/electron#47043, 2026) where `echoCancellation: true` does nothing in Electron even though identical code cancels echo in Chrome.** So the one knob developers reach for may silently no-op on Aria's exact runtime.

**How to avoid:**
- **Do not rely on `echoCancellation: true` alone in Electron — verify it empirically on Win + macOS before building on it.** Assume it may no-op.
- Primary defense = **half-duplex gating during playback**: while Aria is speaking, hard-suppress mic input (stop sending chunks to STT). This is the technique production builds converge on. Combine with an **extended cooldown (~1.0–1.5s) at an elevated VAD threshold after playback ends** to swallow room-resonance decay tails.
- For *true* barge-in (user can interrupt while Aria talks), you cannot fully gate — so feed Aria's TTS output as the **AEC reference signal** into a dedicated AEC stage (e.g. a WebRTC/Speex AEC module or a Koala-style echo/noise suppressor) rather than trusting Chromium's built-in. The TTS audio you generate is the known far-end signal; subtract it explicitly.
- Default to **headphone-friendly** UX and detect speaker-vs-headphone output to choose half-duplex (speakers) vs full barge-in (headset) behavior.

**Warning signs:**
- Aria interrupts herself when no one is talking.
- Transcript log contains Aria's own phrases as "user" turns.
- Works on headphones in testing, fails the moment a tester uses laptop speakers.
- Echo only on one OS (the Electron AEC no-op is platform-variable).

**Phase to address:** **Phase 15 (Audio I/O + AEC + duplex plumbing)** — must land before barge-in and before any always-listening mode.

---

### Pitfall 3: Barge-in done wrong — "finishing the old thought" / failing to cancel in-flight LLM+TTS

**What goes wrong:**
User starts speaking over Aria. The naive implementation keeps generating and playing the *previous* response (the LLM is still streaming tokens; TTS has 2–3 sentences buffered; the audio queue keeps draining). Aria talks over the user, "finishes the old thought," then answers the new one — feeling deaf and rude. Or the cancel fires but only stops *playback*, leaving the LLM still generating and the next answer contaminated by the interrupted-but-uncommitted context.

**Why it happens:**
A cascading pipeline (VAD → STT → LLM → sentence-chunk → TTS → audio-queue) has *several* in-flight buffers. Barge-in only works if a single cancel signal propagates to ALL of them: abort the LLM stream (AbortController), flush the TTS generation queue, flush the audio output buffer, AND correctly record what the user actually *heard* (partial assistant turn) so conversation state isn't corrupted. Most first cuts only `pause()` the audio element.

**How to avoid:**
- One `AbortController` (or cancellation token) per assistant turn, threaded through every stage: LLM `streamText` abort → TTS request cancel → audio buffer flush. Barge-in fires the abort once; every stage listens.
- Target metrics from 2026 production guidance: **user-speech-onset → TTS-suppression < 200ms**; barge-in detection accuracy 95%+; false-positive AND false-negative barge-in < 5%.
- Distinguish **backchannel** ("mhm", "right", "yeah") from a real **barge-in** — a turn-detection/endpointing model (LiveKit TurnDetector, Pipecat SmartTurnAnalyzer class) or at minimum an energy + min-duration + partial-transcript heuristic. Backchannels must NOT interrupt.
- On barge-in, persist the *spoken-so-far* portion as the assistant turn ("I was saying X… [interrupted]") so the LLM context reflects what the user actually heard, not the full unspoken generation.

**Warning signs:**
- "Stop" doesn't stop until the current sentence finishes.
- After interrupting, Aria answers the *old* question.
- A cough or "uh-huh" cuts Aria off.
- Cancelling kills audio but CPU stays pegged (LLM still generating).

**Phase to address:** **Phase 16 (Turn-taking + barge-in + cancellation)** — depends on Phase 15 audio plumbing; the cancellation token must be designed into the pipeline from the start, not retrofitted.

---

### Pitfall 4: Perceived latency — waiting for full LLM/TTS before first audio

**What goes wrong:**
Time-to-first-audio is 2–4s because the pipeline waits for the *complete* LLM response before starting TTS, and waits for the *complete* TTS render before playing. The user experiences dead air after speaking and assumes Aria didn't hear them — they repeat themselves, causing double-processing.

**Why it happens:**
Easiest-to-write code is sequential: `const text = await llm(); const audio = await tts(text); play(audio)`. Each `await` of a full result stacks 1–3s (LLM) + 200–500ms (TTS).

**How to avoid:**
- **Stream end-to-end:** LLM tokens → chunk at sentence/clause boundaries → stream each chunk to TTS → play audio chunks as they arrive. Production guidance puts first-audio under ~300ms this way.
- Send the FIRST sentence to TTS the moment it's complete; don't wait for the paragraph.
- Add per-stage telemetry (STT TTFB/final, LLM first-token, TTS first-audio, end-to-end) so regressions are visible. Local SQLite debug table mirrors the existing OpenTelemetry-local pattern.
- Use a short, instant **acknowledgement cue** (earcon or "let me check") to cover unavoidable retrieval latency (e.g. RAG lookups) instead of silence.

**Warning signs:**
- Users repeat themselves.
- First-audio metric > 800ms p50.
- `await fullResponse` anywhere between STT and TTS.

**Phase to address:** **Phase 16/17 (Streaming pipeline)** — bake streaming + telemetry into the pipeline contract.

---

### Pitfall 5: End-of-speech / VAD mistuning — Aria cuts the user off or waits forever

**What goes wrong:**
Endpointing too aggressive → Aria starts responding while the user is mid-thought (pausing to breathe). Too lax → multi-second awkward delay before Aria responds. Either makes the assistant feel broken.

**Why it happens:**
A single fixed silence-timeout VAD can't tell "thinking pause" from "done talking." Energy-only VAD also false-triggers on keyboard clicks, HVAC, breathing.

**How to avoid:**
- VAD = energy threshold + voice classifier + minimum-duration guard (not energy alone). Telephony-grade tuning lives between -50 and -30 dBFS; desktop near-field mics differ — tune empirically per device class.
- Prefer a **semantic/model-based turn detector** (classifies backchannel vs continued-speech vs end-of-turn) over a raw silence timer where feasible.
- Make endpointing sensitivity a user-tunable setting (some execs speak with long pauses).

**Warning signs:** Aria responds to half-sentences; or 2–3s silence before responses; VAD triggers on background noise.

**Phase to address:** **Phase 16 (Turn-taking)** — co-designed with barge-in.

---

### Pitfall 6: Always-listening wake-word — false activations, privacy, OS permission, and battery

**What goes wrong:**
(a) An always-on mic recording in the background spooks privacy-conscious execs (the exact persona) and may trip corporate device policy. (b) DIY wake-word (run STT continuously and string-match) burns CPU/battery and produces frequent false activations — Aria "wakes up" during a meeting and starts capturing audio it shouldn't. (c) On macOS, the OS mic-permission prompt and the menu-bar "orange dot" appear; if Aria requests mic at launch (not lazily at first voice use) users deny it and the feature is dead. (d) False wake during a confidential conversation = audio buffered/processed when it shouldn't be.

**Why it happens:**
Always-listening is treated as "just keep the mic open." Continuous full STT is the wrong tool; it's expensive and inaccurate as a trigger.

**How to avoid:**
- Use a purpose-built on-device wake-word engine (Picovoice Porcupine: 97%+ true-positive, <1 false-alarm/hour, fixed-point C, negligible CPU; or openWakeWord). Audio for wake-detection never leaves the machine and is never persisted.
- **Default always-listening OFF** (CLAUDE memory already locked "autoLaunch off default" posture; mirror it). Push-to-talk is the default activation; wake-word is explicit opt-in with a clear consent + disclosure screen.
- **Lazy, just-in-time OS mic permission** (request at first voice use, not at launch) — mirrors the locked "lazy mac permission" decision from the Phase 12 tray work.
- Ring-buffer only; pre-roll audio before the wake word is discarded unless wake fires. No raw audio written to disk.
- Visible always-listening indicator (tray/in-app) so the user always knows the mic is hot — trust posture demands it.

**Warning signs:** mic permission requested at startup; CPU baseline rises when "idle"; Aria activates on TV/podcast audio; no visible "listening" affordance.

**Phase to address:** **Phase 18 (Wake-word / always-listening, opt-in)** — explicitly AFTER push-to-talk ships, so the safe default exists first.

---

### Pitfall 7: Cloud opt-in audio leaves the machine without true consent — local-first guarantee violated

**What goes wrong:**
The cloud opt-in path (for higher-quality STT/TTS) streams the exec's *raw voice* — and whatever they said, which may include PII, financials, legal, HR content — to a third-party API. If this isn't gated identically to the existing hybrid-LLM PII routing, it silently breaks "data never leaves the machine except as scoped LLM prompts with PII pre-routed to a local model." Voice audio is *more* sensitive than text: it's biometric, and it can't be PII-redacted before sending the way text can.

**Why it happens:**
Cloud STT is easier and higher quality, so it becomes a tempting default. Consent gets bolted on as a checkbox no one reads.

**How to avoid:**
- **Local-first default, cloud strictly opt-in with explicit per-feature disclosure** (already a locked Key Decision). Voice audio routing MUST reuse/extend the existing sensitivity classifier: sensitive-flagged conversations stay on-device STT/TTS even when cloud opt-in is enabled.
- Voice biometric audio cannot be "PII-redacted" pre-send — so the rule is stricter than text: if a turn is sensitivity-flagged, **no raw audio off-machine, period** (route to local Whisper). Only non-sensitive turns may use cloud STT, and only after consent.
- Consent UX before any audio leaves: name the provider, what's sent, retention. Persist consent state; surface an always-visible indicator when a turn used cloud.
- **[STATIC RATCHET candidate]** A test asserting no cloud-STT call site is reachable without the consent flag + sensitivity check, paralleling the LLM-routing guard.

**Warning signs:** cloud STT default-on; no per-turn local-vs-cloud routing; sensitivity classifier not consulted on audio; consent is a single global toggle with no disclosure.

**Phase to address:** **Phase 17 (Hybrid voice routing + consent)** — reuse the v1 hybrid-LLM routing pattern; do not invent a parallel consent system.

---

### Pitfall 8: Local model resource burden — RAM/CPU/VRAM, multi-GB downloads, terrible first-run UX

**What goes wrong:**
Whisper large-v3-turbo (~809M params; GGUF roughly 1.5–3GB on disk, large-v3 full ~3–4GB runtime) + Kokoro/Chatterbox TTS + the existing local LLM (Ollama 7–8B, ~5–6GB) + Electron/Chromium all compete for RAM on a typical exec ultrabook (16GB, no discrete GPU). Result: swapping, fans, real-time-factor > 1 (transcription slower than speech), and a multi-GB first-run download that blocks the user with a spinner. Execs abandon.

**Why it happens:**
Models picked for quality in isolation, not for the *combined* footprint of STT+TTS+LLM running concurrently on integrated-GPU/CPU-only laptops.

**How to avoid:**
- Budget RAM holistically: STT + TTS + LLM + app must coexist in ~8–10GB headroom. Prefer large-v3-**turbo** (distilled, much lighter than large-v3) and Kokoro-82M (tiny). Quantize (Q4/Q5 GGUF). Consider unloading the local LLM while actively transcribing if memory is tight (serialize via the existing p-queue pattern).
- **First-run model download is a designed flow, not a spinner:** progress UI, resumable downloads, background fetch, size disclosure up front, graceful "voice unavailable until download completes" state. Ship the app without bundling GB of models.
- Detect hardware at first voice-enable; if under spec, recommend cloud opt-in (with consent) or push-to-talk-only / disable always-listening.
- Measure real-time-factor on CPU-only; if RTF > 1, fall back to a smaller STT model or cloud.

**Warning signs:** install size balloons; fans spin on transcription; RTF > 1 on a 16GB laptop; first-run blocks on a multi-GB download with no progress.

**Phase to address:** **Phase 15 (model lifecycle/download) + Phase 17 (hardware-aware routing)**.

---

### Pitfall 9: Electron native-addon ABI break for whisper.cpp bindings (Aria has been bitten by this exact class)

**What goes wrong:**
whisper.cpp Node bindings are a native addon (`.node`). Aria's MEMORY already records repeated better-sqlite3 ABI pain: Electron 41 needs `NODE_MODULE_VERSION` matched via electron-rebuild's dual-ABI dance, and a Node-ABI binary stranded an Electron launch (`NODE_MODULE_VERSION 141 vs 145`). A whisper addon built against system Node will crash at runtime inside Electron exactly the same way — and esbuild/electron-vite never typechecks or rebuilds native deps, so it ships and crashes on the user's machine.

**Why it happens:**
Native addons must be compiled against Electron's V8/Node ABI, not the host Node. electron-vite doesn't handle this; the existing dual-build workaround is bespoke. A new native addon is a new ABI surface.

**How to avoid:**
- Strongly prefer a **sidecar/worker process** for STT/TTS over an in-process native addon: run whisper.cpp (and a TTS server if applicable) as a child process / localhost service — mirrors the existing Ollama-sidecar pattern (port 11434). This sidesteps the Electron ABI problem entirely and isolates crashes/memory from the main process.
- If an in-process addon is unavoidable, fold it into the **existing electron-rebuild dual-ABI build** (same machinery that pins electron@41.6.1 for better-sqlite3) and add it to the ABI-mismatch recovery runbook in MEMORY. Prefer bindings that ship prebuilt `.node` per Electron ABI (e.g. whisper-node-addon) and pin versions.
- Run `npm run typecheck` + a smoke launch of the *packaged* app after adding the binding — the "esbuild skips typecheck" memory says runtime is the only place these surface.
- Don't run STT/TTS on the main thread regardless — it blocks the single-writer SQLite/IPC loop. Worker or sidecar, always.

**Warning signs:** `NODE_MODULE_VERSION X vs Y` at launch; addon works in `node` REPL but crashes in Electron; CI green but packaged app dies; main-process jank during transcription.

**Phase to address:** **Phase 15 (Audio I/O + model runtime)** — pick sidecar-vs-addon and prove the packaged build launches BEFORE building features on top.

---

### Pitfall 10: Audio device hell — wrong device, sample-rate mismatch, hot-swap, permissions

**What goes wrong:**
Aria grabs the wrong input (laptop mic instead of the user's headset), or the user plugs in AirPods mid-conversation and audio dies. Sample-rate mismatch (Whisper wants 16kHz mono; the device delivers 44.1/48kHz stereo) produces garbage transcription if resampling is skipped. On Windows, exclusive-mode devices and Bluetooth HFP-vs-A2DP profile switching mangle quality (Bluetooth mic = narrowband). Permission denied silently yields a dead mic with no error.

**Why it happens:**
"It works on my mac with my mic" — device enumeration, hot-plug handling, and resampling are unglamorous and skipped in the demo.

**How to avoid:**
- Explicit device selection UI + sensible default; listen for `devicechange` and handle hot-swap gracefully (re-acquire stream, don't crash).
- Always resample to whisper's expected 16kHz mono in the pipeline; never assume device rate.
- Handle permission-denied and no-device states with a visible, actionable error (not silent failure).
- Warn on Bluetooth-mic narrowband quality; recommend wired/built-in for accuracy.
- Test the Win Bluetooth HFP profile switch (enabling the BT mic drops the BT speaker to narrowband — affects AEC and TTS quality simultaneously).

**Warning signs:** transcription garbage at certain sample rates; wrong mic used; app crashes on device unplug; silent dead mic.

**Phase to address:** **Phase 15 (Audio I/O)**.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Voice tool-call invokes send/write-event directly (skip approval staging) | Fast demo, "magical" feel | Bypasses the chokepoint; a single mis-hear sends to the wrong exec → product-killing | **Never** |
| Rely on `echoCancellation:true` for AEC | One-line "fix" | No-ops in Electron (#47043); ships self-interruption to users on speakers | Never as sole defense; only as a bonus atop half-duplex gating |
| In-process whisper native addon (no sidecar) | Simpler IPC, no child process | New Electron ABI surface; crashes take down main process; main-thread jank | Only if prebuilt-per-ABI binding + folded into existing dual-build + smoke-tested on packaged app |
| Sequential STT→LLM→TTS (no streaming) | Trivial to write | 2–4s perceived lag; users repeat themselves | Prototype only; replace before any UAT |
| Cloud STT default-on for quality | Best transcription out of the box | Violates local-first guarantee; biometric exec audio leaks | Never default; opt-in + consent + sensitivity-gated only |
| Single fixed silence-timeout VAD | Quick endpointing | Cuts users off / long waits; no backchannel handling | MVP push-to-talk only; upgrade for duplex |
| Always-listening on by default | "Always there" feel | Privacy alarm for exec persona; battery/CPU; corporate-policy risk | Never default; explicit opt-in |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Chromium `getUserMedia` AEC (Electron) | Assume `echoCancellation:true` cancels TTS echo | It no-ops in Electron and can't see WebSocket/custom-buffer audio anyway; gate mic during playback + explicit AEC with TTS as reference |
| whisper.cpp Node addon | Build against system Node | Build against Electron ABI via electron-rebuild dual-build, OR run as sidecar; pin versions; smoke-test packaged app |
| Local LLM (existing Ollama) | Run STT/TTS in same memory budget blindly | Holistic RAM budget; serialize heavy ops via existing p-queue; consider unload-while-transcribing |
| Cloud STT/TTS provider | Treat like the LLM provider; send all audio | Stricter: sensitivity-flagged turns NEVER leave machine (can't redact biometric audio); consent + provider disclosure first |
| Existing `assertApproved` gate | Add a `'voice'` path that satisfies forced-explicit | Voice path must be *blocked* from forced categories/high severity; those still require typed/clicked explicit |
| OS mic permission (macOS) | Request at app launch | Lazy request at first voice use; mirror locked Phase 12 lazy-permission decision |
| Wake-word | Continuous full STT + string match | Purpose-built on-device engine (Porcupine/openWakeWord); ring-buffer; no disk persistence |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Non-streaming pipeline | 2–4s first-audio; users repeat | Stream LLM→chunk→TTS→play; target <300ms first-audio | Immediately, every turn |
| STT/TTS on main thread | UI/IPC/SQLite jank during speech | Worker or sidecar process | First long utterance |
| RTF > 1 on CPU-only | Transcription lags behind speech; backlog | turbo + quantized model; hardware detect; cloud fallback | 16GB no-GPU laptop (the persona's machine) |
| All models resident at once | Swapping, fans, OOM | Holistic RAM budget; serialize/unload via p-queue | STT+TTS+LLM+app concurrently on 16GB |
| In-flight buffers not cancelled on barge-in | CPU pegged after "stop"; old answer plays | Single AbortController threaded through all stages | Every interruption |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Raw exec audio to cloud STT without sensitivity gate | Biometric + PII/financial/legal/HR leak off-machine; breaks local-first guarantee | Sensitivity-flagged turns local-only; consent + disclosure; reuse hybrid-routing classifier |
| Voice satisfies forced-explicit approval path | Mis-heard high-stakes action auto-sent | `assertApproved`: voice path blocked from forced categories & high severity **[HARD GATE]** |
| Always-listening audio persisted to disk | Confidential conversations recorded inadvertently | Ring-buffer only; discard pre-wake audio; never write raw audio |
| No visible mic-hot indicator | User unaware mic is live | Always-on listening indicator in tray/UI |
| Wake-word false-fire during confidential meeting | Unintended capture/processing | High-precision on-device engine; tunable sensitivity; visible state; easy mute |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Auto-execute spoken actions | Wrong send/move; broken trust | Read-back resolved entities + explicit voice-confirm turn |
| Silence after user speaks | User thinks Aria didn't hear; repeats | Instant earcon/ack cue; stream first-audio fast |
| Aria talks over user / finishes old thought | Feels deaf and rude | <200ms barge-in suppression + full-pipeline cancel |
| Backchannel ("mhm") interrupts Aria | Choppy, can't acknowledge | Backchannel-vs-barge-in classifier |
| Multi-GB blocking first-run download | Abandonment | Resumable progress UI; voice-unavailable-until-ready state |
| Mic permission at launch | Denied → feature dead | Lazy just-in-time permission at first voice use |
| Read-back of raw transcript not resolved entities | Mis-resolution not audible | Speak resolved email/date/time |

## "Looks Done But Isn't" Checklist

- [ ] **Voice send/calendar flow:** Often missing the *separate explicit confirm turn after resolved-entity read-back* — verify voice cannot reach `send.ts`/`write-event.ts`/`push-actions.ts` and cannot set `approval_path='explicit'`; verify forced categories fall back to screen.
- [ ] **AEC:** Often "works on headphones" only — verify on laptop *speakers* on both Win and macOS; verify `echoCancellation` isn't the sole defense.
- [ ] **Barge-in:** Often only pauses audio — verify LLM stream aborts AND TTS queue flushes AND partial-spoken turn is persisted to context.
- [ ] **Streaming:** Often awaits full response — verify first-audio p50 < ~800ms via telemetry; no `await fullResponse` between STT and TTS.
- [ ] **Native addon:** Often CI-green/packaged-dead — verify packaged app launches with no `NODE_MODULE_VERSION` mismatch; STT off main thread.
- [ ] **Cloud opt-in:** Often global toggle — verify per-turn local-vs-cloud routing honors sensitivity classifier; consent discloses provider/retention.
- [ ] **Wake-word:** Often always-on/persisted — verify default OFF, ring-buffer only, visible indicator, lazy permission.
- [ ] **Model first-run:** Often a bare spinner — verify resumable download + progress + size disclosure + graceful unavailable state.
- [ ] **Device handling:** Often single-device assumption — verify hot-swap (`devicechange`), 16kHz resample, permission-denied error surfaced.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Voice auto-executed wrong action | HIGH (reputational) | The whole reason for the chokepoint — design prevents recovery being needed. If shipped: emergency disable of voice-action path; audit `action_audit_log`; the existing approve→write silent-failure followup applies. |
| AEC self-loop in the field | MEDIUM | Ship half-duplex gating as hotfix (stop mic during playback) — works without proper AEC; add explicit AEC later |
| Native-addon ABI crash | MEDIUM | Same runbook as better-sqlite3: rebuild against Electron ABI / copy correct variant; better: migrate to sidecar |
| RTF>1 / OOM on user laptop | MEDIUM | Hardware-detect fallback to smaller model or cloud opt-in; disable always-listening |
| Cloud audio leaked before consent fix | HIGH | Disclose; purge provider-side if possible; sensitivity-gate retroactively; consent re-prompt |
| Wake-word false-fires | LOW | Raise sensitivity threshold; swap to higher-precision engine; expose tuning |

## Pitfall-to-Phase Mapping

> Suggested phases for v2.0 (numbering from 14). Roadmapper should treat Phase 14 (voice safety contract) and Phase 15 (audio/AEC/runtime) as prerequisites for everything else.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Voice-triggered irreversible action **[HARD GATE]** | Phase 14 — Voice safety / confirm contract | Static-grep: voice handler not a caller of send/write-event/push; gate test: voice path rejected for forced categories & high severity; UAT: read-back + explicit confirm required |
| 2. AEC / mic captures own TTS | Phase 15 — Audio I/O + AEC | Speaker test on Win+Mac; no self-turns in transcript; half-duplex verified independent of `echoCancellation` |
| 3. Barge-in cancellation | Phase 16 — Turn-taking + barge-in | <200ms suppression metric; LLM-abort + TTS-flush + partial-turn-persist asserted |
| 4. Perceived latency | Phase 16/17 — Streaming pipeline | first-audio p50 telemetry; no full-response await |
| 5. VAD/endpointing mistuning | Phase 16 — Turn-taking | Backchannel-vs-endpoint test; user-tunable sensitivity |
| 6. Wake-word privacy/false-fire/battery | Phase 18 — Always-listening (opt-in, after PTT) | Default-off verified; ring-buffer; visible indicator; lazy permission; false-alarm rate |
| 7. Cloud audio consent/leak | Phase 17 — Hybrid voice routing + consent | Per-turn routing honors sensitivity; **[STATIC RATCHET candidate]** no cloud-STT site reachable without consent+sensitivity check |
| 8. Local model resource burden | Phase 15 (download/runtime) + Phase 17 (HW-aware routing) | RAM budget on 16GB no-GPU; RTF≤1; resumable download UX |
| 9. Electron native-addon ABI | Phase 15 — model runtime | Packaged-app launch smoke; STT off main thread; sidecar preferred |
| 10. Audio device hell | Phase 15 — Audio I/O | Hot-swap, 16kHz resample, permission-denied surfaced |

## Sources

- [Voice AI Barge-In and Turn-Taking: A 2026 Implementation Guide — futureagi.com](https://futureagi.com/blog/voice-ai-barge-in-turn-taking-2026/) — barge-in metrics (<200ms, 95%+, <5% FP/FN), cancellation, context preservation
- [Turn Detection for Voice Agents: VAD, Endpointing, Model-Based — LiveKit](https://livekit.com/blog/turn-detection-voice-agents-vad-endpointing-model-based-detection) — VAD = energy+classifier+min-duration; model-based turn detection
- [Real-Time vs Turn-Based (Cascading) Voice Agent Architecture — Softcery](https://softcery.com/lab/ai-voice-agents-real-time-vs-turn-based-tts-stt-architecture) — cascading pipeline stages, streaming, first-audio <300ms
- [Chained Voice Agent Architectures — brain.co](https://brain.co/blog/chained-voice-agent-architectures-speech-to-speech-vs-chained-pipeline-vs-hybrid-approaches) — pipeline cancellation path on barge-in
- [Measuring Latency in STT (TTFB, Partials, Finals, RTF) — Gladia](https://www.gladia.io/blog/measuring-latency-in-stt) — per-stage latency, RTF
- [I Built a Voice AI with Sub-500ms Latency: The Echo Cancellation Problem — DEV](https://dev.to/remi_etien/i-built-a-voice-ai-with-sub-500ms-latency-heres-the-echo-cancellation-problem-nobody-talks-about-14la) — half-duplex gating, two-tier RMS, cooldown, browser AEC can't see custom audio
- [echoCancellation does nothing in Electron — electron/electron#47043](https://github.com/electron/electron/issues/47043) — the Electron AEC no-op bug
- [Echo Issue While Sharing Screen with Audio — electron/electron#48446](https://github.com/electron/electron/issues/48446) — Electron audio loopback/echo
- [Porcupine Wake Word — Picovoice](https://picovoice.ai/products/voice/wake-word/) — on-device, 97%+ TP, <1 false-alarm/hr, negligible CPU, no audio leaves device
- [Wake Word Detection Guide 2026 — Picovoice](https://picovoice.ai/blog/complete-guide-to-wake-word/) — must run locally for privacy/latency/resources
- [whisper-node-addon (cross-platform prebuilt Electron bindings) — GitHub](https://github.com/Kutalia/whisper-node-addon) — prebuilt .node per platform/ABI, zero-config Electron
- [whisper.cpp — ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp) — addon.node example, VAD, quantization
- [Whisper Model Sizes Explained — OpenWhispr](https://openwhispr.com/blog/whisper-model-sizes-explained) — turbo = distilled 809M, lighter than large-v3
- [whisper-large-v3 Model Memory Requirements — HuggingFace](https://huggingface.co/openai/whisper-large-v3/discussions/83) — ~2.9GB file / ~3.9GB runtime for large-v3
- [USPTO 11935529 — virtual assistant execution of ambiguous command](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11935529) — reversible-first / confirm-before-irreversible safety pattern
- Aria codebase (direct read): `src/main/approvals/gate.ts` (assertApproved, forced-explicit override, CR-01 fail-closed), `tests/static/single-mail-send-site.test.ts` (chokepoint ratchet), CLAUDE.md stack (Ollama sidecar pattern, electron@41 pin, p-queue serialization), MEMORY (better-sqlite3 ABI history, esbuild-skips-typecheck, lazy-mac-permission, autoLaunch-off-default)

---
*Pitfalls research for: adding a hybrid duplex voice interface to Aria (Electron 41, local-first, approval-gated)*
*Researched: 2026-06-02*
