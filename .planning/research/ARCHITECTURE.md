# Architecture Research

**Domain:** Duplex voice interface for a local-first Electron desktop AI assistant (Aria v2.0)
**Researched:** 2026-06-02
**Confidence:** HIGH on Electron main/preload/renderer boundaries, IPC/streaming transport, and approval-gate integration (verified against real Aria source); MEDIUM-HIGH on local STT/TTS runtime placement (kokoro-js + whisper.cpp Node addon verified current); MEDIUM on wake-word process model and the exact latency split (depends on user hardware).

> **Scope note:** Models are already chosen (Whisper large-v3-turbo via whisper.cpp; Kokoro-82M / Chatterbox-Turbo for TTS). This document is about INTEGRATION into the existing Electron architecture — where each stage runs, the renderer↔main streaming flow, the barge-in state machine, how voice intents reach the existing IPC handlers and gate through `assertApproved`, the wake-word process model, the latency budget, and a dependency-ordered build sequence (phases continue from 14).

## How This Grounds Against Real Aria Structure

Verified by reading source, not assumed:

- **IPC is a registry.** `src/shared/ipc-contract.ts` declares `CHANNELS` + `CHANNEL_METHODS`; `src/preload/index.ts` auto-maps every channel to a `window.aria.<method>` `ipcRenderer.invoke` wrapper. Push channels (e.g. `NAVIGATE`, `ENTITLEMENT_STATE_CHANGED`) are hand-overridden in preload with `ipcRenderer.on` returning an unsubscribe fn. **Voice adds new channels to this same registry — no new bridge mechanism needed.**
- **Handlers register through `registerHandlers(ipcMain, deps, opts)`** in `src/main/ipc/index.ts`, each `register<Feature>Handlers` owning a channel set, gated on `dbHolder.db` for DB-dependent blocks, with `skip`-set poisoning (the IPC-db-null trap from memory). **Voice handlers follow this exact shape: `registerVoiceHandlers(ipcMain, { logger, dbHolder, scheduler, emitToRenderer })`.**
- **Main→renderer push uses `makeRendererEmitter(win)`** = thin `win.webContents.send(channel, payload)` wrapper, already used by entitlement, transcripts, research. **Partial transcripts and TTS-text/state events ride this exact sink.**
- **The send chokepoint is `assertApproved(db, approvalId)`** in `src/main/approvals/gate.ts`, called as line 1 of the unified send adapter; a static-grep test forbids any other module reaching a provider's send method. **Voice-confirm does NOT bypass this — it produces an explicit approval transition, then the SAME adapter runs `assertApproved`.**
- **LLM dispatch is the AI SDK 6 router** (`src/main/llm/router.ts` + `src/main/ipc/ask.ts`): `router.classify({prompt, source})` → `generateText({model, prompt})` with frontier→local fallback. Currently uses `generateText` (non-streaming). **Voice needs `streamText` to feed TTS incrementally — this is the one router-adjacent change.**
- **Local models already run via Ollama sidecar** (`createOllama({baseURL: '127.0.0.1:11434/api'})`). Whisper/Kokoro are a NEW class of local runtime — they are NOT LLMs and do NOT belong in the Ollama path.

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│ RENDERER (Chromium)  — owns the microphone + speaker; Web Audio only   │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │ getUserMedia│→ │ AudioWorklet  │→ │ Silero VAD   │  │ Kokoro TTS  │  │
│  │  mic capture│  │ (PCM framing) │  │ (onnx, WASM) │  │ (kokoro-js, │  │
│  └────────────┘  └──────┬───────┘  └──────┬───────┘  │  WebGPU/WASM)│  │
│                         │ 20ms PCM frames │ speech/   │  + Audioout  │  │
│                         │ + endpoint flags│ silence   └──────▲──────┘  │
│  ┌──────────────────────┴─────────────────┴───────────┐     │         │
│  │ VoiceSession (renderer state machine + Zustand)     │     │         │
│  │  IDLE→LISTENING→THINKING→SPEAKING + BARGE-IN cancel  │─────┘         │
│  └──────────────┬───────────────────────────▲──────────┘               │
└─────────────────┼ window.aria.voice* (IPC)   │ webContents.send push ───┘
                  │ + MessagePort audio lane    │
┌─────────────────▼───────────────────────────┴──────────────────────────┐
│ MAIN (Node)  — owns transcription, intent routing, generation, gate     │
│  ┌───────────────┐   ┌───────────────────┐   ┌──────────────────────┐   │
│  │ STT engine    │   │ VoiceOrchestrator │   │ Intent Router        │   │
│  │ whisper.cpp   │──▶│ turn-taking +     │──▶│ (NL → existing IPC   │   │
│  │ Node addon /  │   │ barge-in machine  │   │  handler call)       │   │
│  │ worker_threads│   │ (AbortController) │   └──────────┬───────────┘   │
│  └───────────────┘   └─────────┬─────────┘              │               │
│                                │ streamText (AI SDK 6)   ▼               │
│                      ┌─────────▼─────────┐   ┌──────────────────────┐   │
│                      │ LLMRouter (exists) │   │ EXISTING handlers:   │   │
│                      │ local/frontier     │   │ briefing/triage/     │   │
│                      └────────────────────┘   │ scheduling/ask/      │   │
│                                                │ drafting             │   │
│                      ┌────────────────────┐    └──────────┬──────────┘   │
│                      │ assertApproved gate │◀──────────────┘ (writes)     │
│                      │ approvals/gate.ts   │   voice-confirm = explicit    │
│                      └────────────────────┘   approval transition         │
└──────────────────────────────────────────────────────────────────────────┘
            (optional) WAKE-WORD: separate utilityProcess, mic-isolated
```

### Key placement decisions (the "WHERE")

| Stage | Runs in | Why |
|-------|---------|-----|
| Mic capture (`getUserMedia`) | **Renderer** | `navigator.mediaDevices` only exists in Chromium. Main has no audio device access. Non-negotiable. |
| Frame/resample to 16 kHz mono PCM | **Renderer (AudioWorklet)** | Worklet runs on the audio render thread — no main-thread jank, deterministic 20 ms frames. Resampling at the edge keeps the transport small (16 kHz mono ≈ 32 KB/s vs raw 48 kHz stereo). |
| VAD / endpointing | **Renderer (Silero-VAD onnx, WASM)** | Must run on the mic stream with the lowest possible latency to drive barge-in. Keeping VAD next to capture means a barge-in can be raised in one frame without an IPC round-trip. |
| STT (Whisper-turbo) | **Main, in a `worker_thread` (or `utilityProcess`)** | whisper.cpp Node addon is a native module that blocks while decoding. It must NOT run on the main event loop (would freeze IPC + the gate). A worker thread keeps it off the loop while staying in the main-process trust boundary. The addon accepts PCM32 chunks + VAD, so it streams. |
| LLM generation | **Main (existing LLMRouter, switch to `streamText`)** | Reuse the entire hybrid local/frontier routing, redaction, fallback, and routing-log machinery. Zero duplication. |
| Intent routing → existing handlers | **Main (new `VoiceOrchestrator` + `IntentRouter`)** | Intents must call the same in-process functions the IPC handlers call, behind the same entitlement + approval gates. Routing in renderer would re-cross the bridge and risk bypassing gates. |
| TTS synthesis | **Renderer (kokoro-js, ONNX via WebGPU/WASM)** — primary; **Main worker** for Chatterbox | kokoro-js is a browser-first library (Transformers.js/ONNX) with `TextSplitterStream` for sentence-chunked streaming and built-in WebGPU acceleration. Synthesizing in the renderer means the produced `AudioBuffer` plays immediately with no audio-transport hop back from main. Chatterbox (if used for max-quality) is heavier → run in a main worker and stream PCM out. |
| Audio playback | **Renderer (Web Audio `AudioBufferSourceNode`)** | Same reason as capture: only the renderer has a speaker. Playback node is what barge-in `.stop()`s instantly. |
| Wake-word ("Hey Aria") | **Separate `utilityProcess`** (openWakeWord / Porcupine), opt-in | Privacy isolation: an always-listening process must be a distinct, killable, mic-scoped process that emits ONLY a boolean trigger — never raw audio — to main. (See §Wake-word.) |

**Rule of thumb that falls out of this:** *audio bytes stay in the renderer; only PCM-going-to-STT crosses to main, and only text/control crosses back.* The one exception is Chatterbox PCM-out from a main worker, which is why Kokoro-in-renderer is the default.

## Recommended Project Structure

```
src/
├── main/
│   ├── voice/                      # NEW — main-side voice subsystem
│   │   ├── orchestrator.ts         # VoiceOrchestrator: turn-taking + barge-in state machine
│   │   ├── stt/
│   │   │   ├── whisper-worker.ts    # worker_thread entry: whisper.cpp addon, PCM in → partials/final out
│   │   │   ├── stt-engine.ts        # spawns/owns worker, exposes feed(pcm)/flush()/abort()
│   │   │   └── cloud-stt.ts         # consent-gated cloud STT adapter (opt-in path)
│   │   ├── intent/
│   │   │   ├── intent-router.ts     # NL utterance → {surface, action, args}; dispatch to existing services
│   │   │   ├── intent-schema.ts     # Zod schema for generateObject intent classification
│   │   │   └── surfaces.ts          # registry: maps intent → existing in-process service call
│   │   ├── tts/
│   │   │   └── chatterbox-worker.ts # OPTIONAL main-worker TTS (PCM-out) for max-quality path
│   │   ├── confirm.ts              # voice-confirm flow → explicit approval transition (NOT a new gate)
│   │   └── session-registry.ts     # tracks active VoiceSession per webContents
│   └── ipc/
│       └── voice.ts                # NEW — registerVoiceHandlers (start/stop/feedAudio/cancel/setMode)
├── preload/
│   └── index.ts                    # MODIFY — add voice push-channel overrides (onPartialTranscript, etc.)
├── shared/
│   ├── ipc-contract.ts             # MODIFY — add VOICE_* channels + methods + VoiceSession DTOs
│   └── voice-types.ts              # NEW — shared VoiceState, IntentResult, TranscriptDelta types
└── renderer/
    ├── features/voice/             # NEW — renderer voice UI + capture/playback
    │   ├── VoiceSession.ts         # renderer state machine (mirror of orchestrator states)
    │   ├── useVoiceSession.ts      # Zustand store + IPC wiring + push subscriptions
    │   ├── capture/
    │   │   ├── mic-worklet.ts      # AudioWorklet processor: 48k→16k mono PCM framing
    │   │   └── vad.ts              # Silero-VAD onnx wrapper (speech/silence + endpoint)
    │   ├── tts/
    │   │   └── kokoro-player.ts     # kokoro-js TextSplitterStream → AudioBufferSourceNode playback
    │   ├── VoiceOrb.tsx            # the talk-button / push-to-talk + state visualization
    │   └── VoiceConfirmDialog.tsx  # spoken-action confirm surface (reads existing approval DTO)
    └── hooks/
        └── useWakeWord.ts          # opt-in wake-word toggle + status (drives main utilityProcess)
```

### Structure Rationale

- **`src/main/voice/` mirrors the existing feature-folder convention** (`briefing/`, `triage/`, `rag/`). The orchestrator is the brain; `stt/`, `intent/`, `tts/`, `confirm/` are its limbs. Keeps the worker-thread native-module blast radius inside one folder.
- **`intent/surfaces.ts` is the single integration seam.** It imports the SAME service functions the existing IPC handlers call (e.g. `generateBriefing`, `proposeSchedule`, `draftReply`, `AnswerService`) — it does NOT re-invoke IPC. One file to audit for "does every voice action route through the same gates as the UI."
- **`confirm.ts` is deliberately NOT a gate.** It is a thin helper that turns a spoken "yes, send it" into the `approval` row transition (`state→approved`, `approval_path='voice-explicit'`). The `'voice-explicit'` value is distinguishable from `'explicit'` so `assertApproved` can reject it for forced/high-severity (financial/legal/HR) actions. The real enforcement stays in `assertApproved`. This is the load-bearing trust decision.
- **Renderer `features/voice/` owns all audio I/O.** Capture worklet + VAD + Kokoro playback live together because they share the Web Audio `AudioContext` and the barge-in `.stop()` path.

## Architectural Patterns

### Pattern 1: Dual-lane transport — control over IPC, audio over MessagePort

**What:** Control/text (start, partial transcripts, intent results, state changes) uses the existing `ipcRenderer.invoke` / `webContents.send` registry. Raw PCM frames (renderer→main, ~50 frames/s) use a dedicated `MessageChannelMain` port handed to the renderer once at session start.

**When to use:** Always, for the live duplex session. The default IPC channel serializes through the main event loop and is fine for sparse control messages but wrong for a 50 Hz binary firehose.

**Trade-offs:** MessagePort adds one setup handshake and a second mental model. But it (a) keeps high-rate audio off the structured-clone IPC path, (b) lets you transfer `ArrayBuffer` ownership (zero-copy), and (c) decouples audio backpressure from control latency. For the first voice phase you *can* ship everything over `ipcRenderer` `Float32Array` payloads and migrate to MessagePort if profiling shows IPC saturation — flag this as a perf milestone, not a launch blocker.

**Example:**
```typescript
// main: registerVoiceHandlers — hand the renderer a port at session start
ipcMain.handle(CHANNELS.VOICE_START, (event) => {
  const { port1, port2 } = new MessageChannelMain();
  sttEngine.attachAudioPort(port1);            // main reads PCM frames here
  event.sender.postMessage(CHANNELS.VOICE_AUDIO_PORT, null, [port2]); // renderer writes here
  return { ok: true, sessionId };
});

// renderer: worklet → transfer PCM frame, zero-copy
audioPort.postMessage(pcmFrame.buffer, [pcmFrame.buffer]);
```

### Pattern 2: Streaming the cascade — first sentence wins

**What:** Switch the generation step from `generateText` to `streamText` (AI SDK 6). The orchestrator buffers the token stream into a sentence-boundary splitter; the FIRST complete sentence is pushed to TTS immediately while the LLM is still generating sentence two. TTS likewise streams audio chunks to playback.

**When to use:** Every spoken response. This is the single biggest perceived-latency win (40–60% per the kokoro-js streaming guidance) because the user hears speech start while the model is still thinking.

**Trade-offs:** You lose the ability to post-process the full text before speaking (e.g. a final safety pass over the whole answer). Mitigation: voice responses are read-only narration; anything that *acts* (send/schedule) goes through the confirm→approval→gate path BEFORE TTS ever speaks a confirmation. So streaming narration is safe; streaming an action is not — and the architecture already separates them.

**Example:**
```typescript
const { textStream } = streamText({ model, prompt });   // reuse LLMRouter-chosen model
const splitter = new SentenceSplitter();
for await (const delta of textStream) {
  emitToRenderer(CHANNELS.VOICE_ASSISTANT_DELTA, { text: delta }); // live caption
  for (const sentence of splitter.push(delta)) {
    if (orchestrator.aborted) break;                    // barge-in check each sentence
    ttsQueue.enqueue(sentence);                          // renderer Kokoro picks up
  }
}
```

### Pattern 3: Barge-in via a single AbortController per turn

**What:** Each assistant turn owns one `AbortController`. Renderer VAD detecting user speech during `SPEAKING` fires `VOICE_BARGE_IN` over the control lane. The orchestrator calls `controller.abort()`, which (a) cancels the in-flight `streamText` (AI SDK 6 honors `abortSignal`), (b) drains/clears the TTS queue, (c) tells the renderer to `.stop()` the active `AudioBufferSourceNode`, and (d) resets state to `LISTENING` with the new incoming audio already buffering.

**When to use:** Whenever the user talks over Aria. This is the defining feature of "feels conversational duplex."

**Trade-offs:** Requires the LLM call, the TTS pipeline, and the audio playback node to ALL be individually cancellable and wired to the same signal. The renderer must keep capturing during `SPEAKING` (half-duplex would drop the interruption). Echo from the speaker into the mic must be suppressed — rely on Chromium's built-in AEC (`echoCancellation: true` in `getUserMedia` constraints) plus gating VAD-triggered barge-in on an energy threshold to avoid Aria interrupting herself.

**Example:**
```typescript
// orchestrator turn lifecycle
let turn: AbortController | null = null;
function startAssistantTurn(prompt: string) {
  turn = new AbortController();
  streamText({ model, prompt, abortSignal: turn.signal });
}
function onBargeIn() {                       // VOICE_BARGE_IN from renderer VAD
  turn?.abort();                             // cancels streamText
  ttsQueue.clear();                          // stop feeding new sentences
  emitToRenderer(CHANNELS.VOICE_STOP_PLAYBACK); // renderer: source.stop()
  transitionTo('LISTENING');                 // re-arm STT on the new utterance
}
```

### Pattern 4: Intent routing reuses in-process services, never re-crosses IPC

**What:** The transcribed utterance goes to `generateObject` (AI SDK 6 + Zod) producing a typed `IntentResult { surface, action, args }`. `surfaces.ts` maps that to a direct call of the SAME service function the existing IPC handler wraps. Read-actions (briefing, ask, summarize) return text → TTS. Write-actions (send email, move meeting) build/queue an `approval` row and enter the confirm flow.

**When to use:** Every utterance that isn't a pure transport control.

**Trade-offs:** Requires factoring the existing handlers so their core logic is callable as a plain function, not only via `ipcMain.handle`. Several already are (e.g. RAG `AnswerService`, scheduling propose). Where a handler inlines logic in the `ipcMain.handle` closure, extract a service function first. Net: a one-time refactor, but it removes duplication and guarantees voice and UI share one code path (and one set of gates).

## Data Flow

### Duplex turn flow (the cascade)

```
[User speaks] → getUserMedia → AudioWorklet (16k PCM frames) → Silero VAD
     │                                                              │ endpoint
     │ PCM frames (MessagePort, zero-copy)                          ▼
     ▼                                                       VOICE_ENDPOINT (control)
  whisper-worker (main) ──partials──▶ VOICE_PARTIAL_TRANSCRIPT ──▶ renderer caption
     │ final transcript
     ▼
  IntentRouter (generateObject + Zod) ──▶ {surface, action, args}
     │
     ├─ READ action ──▶ existing service fn ──▶ streamText ──┐
     │                                                       │ sentence chunks
     │                                                       ▼
     │                                            renderer Kokoro TTS ──▶ AudioBufferSource ──▶ [User hears]
     │
     └─ WRITE action ──▶ build approval row ──▶ VoiceConfirmDialog (spoken + visual)
                              │ user says "yes" / clicks confirm
                              ▼
                   approval transition: state='approved', path='explicit'
                              ▼
                   existing send adapter ──▶ assertApproved(db, id) ──▶ provider send
                              ▼
                   "Done — email sent to Dana." ──▶ TTS
```

### Barge-in interrupt flow

```
[User talks during SPEAKING] → VAD speech-detected (renderer) → VOICE_BARGE_IN (control lane)
     ▼
orchestrator.turn.abort()  →  streamText cancelled (AI SDK 6 abortSignal)
     ▼                      →  ttsQueue.clear()
VOICE_STOP_PLAYBACK (push)  →  renderer source.stop()  (audio cut < 100 ms)
     ▼
transitionTo(LISTENING)     →  new utterance already buffering in worklet → STT
```

### State machine (renderer + main mirror the same states)

```
        ┌──────────────────────────────────────────────┐
        ▼                                                │
     IDLE ──(PTT down / wake-word / VAD speech)──▶ LISTENING
        ▲                                                │ endpoint (VAD silence ≥ N ms)
        │ session end                                    ▼
        │                                            TRANSCRIBING
        │                                                │ final transcript
        │                                                ▼
        │                                          ROUTING_INTENT
        │                                        ┌───────┴────────┐
        │                                   READ │                │ WRITE
        │                                        ▼                ▼
        │                                  THINKING/SPEAKING   CONFIRMING
        │                                        │              │ approved → act → SPEAKING
        └────────────────────────────────────────┴──────────────┘
                                                 │ barge-in (any speaking state)
                                                 ▼
                                              LISTENING  (cancel turn, re-arm)
```

**Single source of truth:** the **main** `VoiceOrchestrator` owns the authoritative state (it holds the AbortController, the gate, the DB). The renderer `VoiceSession` is a *mirror* updated by `VOICE_STATE` push events — it drives the UI orb and decides when to capture vs play, but it does not own correctness. This matches the existing pattern where main owns the approval state and the renderer reflects it.

## Latency Budget — "feels conversational"

Target: **user stops talking → first audio of Aria's reply ≤ ~900 ms** for the local cascade on a modern laptop (human conversational turn-taking gap is ~200–500 ms; ≤1 s reads as responsive, >1.5 s reads as laggy). Budget for the all-local path:

| Stage | Budget | Where spent / notes |
|-------|--------|---------------------|
| VAD endpoint debounce | 150–250 ms | Silence window before declaring end-of-turn. Tunable; too short = clips the user, too long = feels slow. The dominant *fixed* cost. |
| Final STT decode (Whisper-turbo, last chunk) | 100–250 ms | Streaming partials hide most of this; only the tail chunk after endpoint counts. GPU/Metal/CUDA addon build cuts this ~3×. |
| Intent classify (generateObject, local) | 50–150 ms | Small prompt, local model. Can be skipped for obvious continuations. |
| LLM time-to-first-token (streamText) | 150–400 ms | Frontier API TTFT ~200–400 ms; local 8B TTFT ~100–200 ms. This is why streaming matters — we only wait for the FIRST token, not the whole answer. |
| First-sentence TTS synth (Kokoro) | 80–200 ms | Kokoro-82M synthesizes a short sentence well under 200 ms; WebGPU ~2–10× faster than WASM. |
| Audio scheduling / playback start | 20–50 ms | AudioBufferSourceNode start. |
| **Total to first audio** | **~550–1000 ms** | Streaming overlaps STT-tail, intent, TTFT, and TTS so they don't fully sum in practice. |

**Where to spend optimization effort, in order:**
1. **Stream everything** (Pattern 2) — biggest win, removes whole-answer wait.
2. **GPU-build whisper.cpp** (Metal on mac, CUDA/Vulkan on Win) — STT is the heaviest CPU stage.
3. **Tune the VAD endpoint window** — pure UX dial, costs nothing.
4. **Kokoro on WebGPU** — only matters if WASM synth becomes the tail bottleneck.
5. **Cloud opt-in path** — for users who accept it, cloud STT/TTS (e.g. Deepgram/ElevenLabs) can beat local TTFT, but routes audio off-device → consent-gated, mirrors the hybrid-LLM disclosure UX.

**Barge-in cut latency target: < 150 ms** from user-speech-onset to Aria's audio stopping — this is what makes interruption feel natural and is mostly `source.stop()` + a one-hop control message.

## Voice-Confirm ↔ Approval Gate Integration (the trust seam)

This is the highest-stakes integration point. The rule: **voice never invents a new authorization path.**

```
WRITE intent (send email / move meeting / push task)
   ▼
VoiceOrchestrator builds the SAME approval row the UI path builds
   (state='proposed' or 'generating' → 'ready', severity/categories from classifier)
   ▼
CONFIRMING state: Aria speaks the action + shows VoiceConfirmDialog (reads existing approval DTO)
   ▼
User confirms — by voice ("yes, send it") OR by click
   ▼
voice confirm helper writes:  approve(approvalId)
   → state='approved', approval_path='voice-explicit'
   ▼
SAME unified send adapter runs:  assertApproved(db, approvalId)  ← unchanged enforcement
   → forced-explicit / high-severity / financial-legal-hr rules still apply verbatim
   ▼
provider send (Gmail/Graph/calendar/Todoist)
```

**Non-negotiables for the roadmapper:**
- **Voice-confirm produces `approval_path='voice-explicit'`** — NOT `'explicit'`. The `'voice-explicit'` value clears the `assertApproved` gate for low/medium severity actions (same flow as a UI click for those tiers), but is **REJECTED** by the dedicated `voice-forbidden-forced` branch for forced/high-severity (financial/legal/HR) actions. A voice "yes" is NOT a first-class explicit approval for high-stakes actions — it forces the on-screen click. This is the hard gate (VOICE-10).
- **High-severity / financial-legal-hr categories require the visual confirm.** When `assertApproved` sees `approval_path='voice-explicit'` for a `forced`/high-severity row, it throws `ApprovalGateError` — the user must tap the UI. This prevents mishearing "yes" on an irreversible action from executing without explicit on-screen confirmation.
- **The static-grep ratchet** (`single-mail-send-site.test.ts` and siblings) must be extended to assert the new voice write-paths ALSO route through the unified adapter — same shape as the Phase 4/6 silent-write-failure guards in memory. Add a voice send-path test in the same family.

## Wake-Word: Process Model & Privacy Isolation

**Process model:** Opt-in only, OFF by default. When enabled, run the detector in a **separate Electron `utilityProcess`** (not the renderer, not main):

- It opens its OWN minimal audio capture (or receives frames from a dedicated renderer worklet) and runs a tiny on-device KWS model (openWakeWord ONNX or Picovoice Porcupine).
- It emits **only a boolean trigger event** to main (`VOICE_WAKE_TRIGGERED`) — it MUST NOT forward, buffer-to-disk, or transcribe audio. Pre-trigger audio is discarded in a ring buffer that never leaves the process.
- It is independently killable: toggling wake-word off in Settings terminates the `utilityProcess` entirely, so "always listening" can be provably stopped.

**Why a separate process (not just a flag):**
- **Auditable isolation** — a distinct PID with a single output (a trigger) is the privacy story you can show users and document.
- **Crash/leak containment** — an always-on native model that wedges takes down only itself, not the app.
- **Resource scoping** — easy to suspend on `powerMonitor` sleep (reuse the existing suspend/resume pattern from `lifecycle/powerMonitor.ts`).

**Privacy/consent UX:** Wake-word enablement is a distinct consent toggle with a tray/menubar "mic active" indicator. The cloud-audio opt-in is a SEPARATE consent — wake-word being local-only is the default and never sends audio anywhere. Mirror the existing hybrid-LLM disclosure copy.

**Latency note:** wake-word adds an activation step but not turn latency — once triggered it hands the live mic stream straight into the normal LISTENING state.

## Scaling Considerations

Single-user desktop app; "scale" = device capability and concurrency of voice with background work, not user count.

| Dimension | Concern | Adjustment |
|-----------|---------|------------|
| Low-end CPU (no GPU) | Whisper-turbo decode slow; WASM TTS slow | Ship a "lite" path: smaller Whisper (base/small) auto-selected by a capability probe; warn that cloud opt-in gives best latency. Reuse the `autoPickModel.ts` capability-probe pattern. |
| Voice during cron/sync | LLM `p-queue` (concurrency=1) means a running briefing-gen blocks the voice turn | Give voice turns priority in the queue, or a dedicated small queue for interactive voice so a background briefing doesn't stall a live conversation. **Roadmap flag:** the single concurrency=1 queue is a contention point for interactive voice. |
| Memory | whisper.cpp + Kokoro + Ollama models co-resident | Lazy-load STT/TTS on first voice use; unload after idle timeout. Don't hold all models hot. |
| GPU contention | Local LLM (Ollama) + Whisper-GPU + Kokoro-WebGPU all want the GPU | Document expected hardware; serialize GPU-heavy stages where needed; cloud opt-in as the pressure valve. |

## Anti-Patterns

### Anti-Pattern 1: Capturing or playing audio in the main process
**What people do:** Try to open the mic / speaker from Node in main.
**Why it's wrong:** Main has no media device API; you'd bolt on a native audio lib, duplicating what Chromium already does well (incl. AEC, device switching, permissions).
**Do this instead:** Renderer owns all device I/O via Web Audio; main only sees PCM destined for STT and text/control.

### Anti-Pattern 2: Running whisper.cpp on the main event loop
**What people do:** Call the native addon synchronously in the IPC handler.
**Why it's wrong:** Native decode blocks the loop → IPC, the gate, and the UI all freeze during transcription. (Same class of bug as the better-sqlite3 ABI/blocking notes in memory.)
**Do this instead:** `worker_thread` (or `utilityProcess`) for STT; stream frames in, post partials out.

### Anti-Pattern 3: Voice actions taking a side-door around assertApproved
**What people do:** Let the voice handler call the provider send directly because "the user already said yes out loud."
**Why it's wrong:** Recreates the exact silent-write-failure shape caught in Phases 4 and 6 — a write path that skips the gate. A misheard "yes" then sends real email.
**Do this instead:** Voice "yes" → explicit approval transition → unified adapter → `assertApproved`. Extend the static-grep ratchet to the voice path.

### Anti-Pattern 4: Half-duplex (stop capturing while speaking)
**What people do:** Mute the mic during TTS to avoid echo.
**Why it's wrong:** Kills barge-in — the user can't interrupt, which is the whole point of "conversational duplex."
**Do this instead:** Keep capturing during SPEAKING; rely on Chromium AEC + a VAD energy threshold to distinguish the user from Aria's own output.

### Anti-Pattern 5: Whole-answer-then-speak
**What people do:** `generateText` the full reply, then synthesize.
**Why it's wrong:** Adds the entire generation time to perceived latency; a 3-sentence answer feels like a 2-second pause.
**Do this instead:** `streamText` + sentence splitter + streaming TTS (Pattern 2).

## Integration Points

### New runtimes / libraries

| Runtime | Integration pattern | Notes / gotchas |
|---------|---------------------|------------------|
| whisper.cpp (Node addon, e.g. whisper-node-addon) | Native module in a `worker_thread`; feed PCM32 chunks + VAD; receive partial + final text | Native build per-platform (electron-builder rebuild step); GPU build (Metal/CUDA/Vulkan) is the latency unlock. ABI must match Electron's Node (mirror the better-sqlite3 ABI-pinning discipline). |
| kokoro-js (Transformers.js / ONNX) | Renderer; `TextSplitterStream` → audio chunks → `AudioBufferSourceNode` | Browser-first; WebGPU optional accel with WASM fallback. ~82M model downloaded/cached on first use. |
| Chatterbox-Turbo (optional max-quality TTS) | Main `worker_thread`, PCM-out streamed to renderer playback | Heavier; only on the quality-priority path. Audio-out hop is why Kokoro-in-renderer is default. |
| Silero-VAD (ONNX) | Renderer AudioWorklet-adjacent | Drives endpointing + barge-in; tiny, runs in WASM. |
| openWakeWord / Porcupine | Separate `utilityProcess`, opt-in | Emits trigger boolean only; never audio. |
| Cloud STT/TTS (opt-in) | Main adapter behind consent gate | Mirrors hybrid-LLM disclosure; audio leaves device only after explicit opt-in. |

### Internal boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| renderer mic/worklet ↔ main STT | MessagePort (PCM, zero-copy) + control IPC | High-rate binary on the port; control on the registry channels. |
| main STT ↔ orchestrator | in-process worker messages | partials + final transcript. |
| orchestrator ↔ LLMRouter | direct call, `streamText` w/ abortSignal | reuse hybrid routing + redaction + fallback unchanged. |
| orchestrator ↔ existing services | direct in-process call via `intent/surfaces.ts` | the single integration seam; same fns the IPC handlers use. |
| orchestrator ↔ approvals gate | build approval row → `assertApproved` in unified adapter | unchanged enforcement; voice-confirm = explicit path. |
| main ↔ renderer (state/partials/TTS-text) | `makeRendererEmitter` push channels | reuse existing push pattern. |
| wake-word utilityProcess ↔ main | single trigger event | privacy-isolated. |

## New vs Modified — Build Order (phases continue from 14)

**NEW modules:** `src/main/voice/**`, `src/main/ipc/voice.ts`, `src/shared/voice-types.ts`, `src/renderer/features/voice/**`, `src/renderer/hooks/useWakeWord.ts`.
**MODIFY:** `src/shared/ipc-contract.ts` (add VOICE_* channels/methods/DTOs), `src/preload/index.ts` (push-channel overrides), `src/main/ipc/index.ts` (`registerVoiceHandlers` call), the chosen existing handlers (extract core logic to callable services where still inlined), `src/main/llm` call sites that voice uses (add a `streamText` entry point alongside `generateText`), `App.tsx` (mount VoiceOrb + route VoiceConfirmDialog), static-grep ratchet tests (extend to voice write-paths).

Suggested dependency-ordered sequence:

1. **Phase 14 — Audio capture + playback spike (renderer-only).** Worklet PCM framing, Silero VAD, Kokoro playback of canned text. Proves the renderer audio path end-to-end with no main involvement. Deliverable: press-to-talk records, VAD endpoints, a hardcoded sentence speaks. *No gate risk; pure plumbing.*
2. **Phase 15 — STT in a worker + transport.** whisper.cpp Node addon in `worker_thread`, PCM transport (start with `ipcRenderer` Float32 payloads, MessagePort if needed), partial+final transcripts pushed to renderer captions. Deliverable: speak → see live transcript. *Flag: native build/ABI.*
3. **Phase 16 — Streaming cascade + VoiceOrchestrator (read-only).** `streamText` entry point, sentence-splitter → streaming TTS, the IDLE→LISTENING→…→SPEAKING state machine, and BARGE-IN with AbortController. Wire ONLY read intents (ask/briefing/summarize) through `intent/surfaces.ts`. Deliverable: full duplex conversation over read surfaces with interruption. *This is the "feels conversational" milestone.*
4. **Phase 17 — Voice-confirm + write actions through the gate.** Intent routing for write surfaces (send/schedule/draft/task), `confirm.ts` → explicit approval transition → `assertApproved`, `VoiceConfirmDialog`, high-severity-forces-visual-tap rule, extend static-grep ratchet. Deliverable: "Aria, reply to Dana that I'll make it" → drafts, confirms, sends through the existing gate. *Highest trust stakes; do AFTER read-only proves the loop.*
5. **Phase 18 — Wake-word + privacy isolation.** Opt-in `utilityProcess` KWS, consent UX, mic-active indicator, powerMonitor suspend, off-by-default. Deliverable: "Hey Aria" activates a turn; toggling off provably kills the process.
6. **Phase 19 — Cloud opt-in + latency/quality polish.** Consent-gated cloud STT/TTS adapters, capability-probe model selection, GPU-build whisper, voice-priority queue lane, idle model unload. Deliverable: hybrid local/cloud audio mirroring the hybrid-LLM disclosure; tuned latency budget.

**Ordering rationale:** audio plumbing → transcription → the read-only conversational loop (where barge-in/cancellation is proven with zero write risk) → write actions through the gate (only once the loop is trustworthy) → wake-word (independent, opt-in) → cloud + perf polish (optimization, not core). Write-through-gate deliberately follows the read-only loop so the barge-in/cancellation machinery is battle-tested before any spoken action can send.

## Sources

- Aria source (verified): `src/shared/ipc-contract.ts`, `src/preload/index.ts`, `src/main/ipc/index.ts`, `src/main/approvals/gate.ts`, `src/main/llm/router.ts`, `src/main/ipc/ask.ts`, `src/main/llm/providers.ts`, `src/main/ipc/entitlement.ts` (makeRendererEmitter), `src/main/lifecycle/scheduler.ts`.
- [whisper.cpp (ggml-org)](https://github.com/ggml-org/whisper.cpp) and [streaming example](https://github.com/ggml-org/whisper.cpp/blob/master/examples/stream/README.md) — chunked streaming + VAD mode.
- [whisper-node-addon (Kutalia)](https://github.com/Kutalia/whisper-node-addon) — Node addon accepting PCM32 chunks, VAD, GPU accel.
- [kokoro-js (npm)](https://www.npmjs.com/package/kokoro-js) and [StreamingKokoroJS](https://rhulha.github.io/StreamingKokoroJS/) — `TextSplitterStream` sentence-chunked streaming, WebGPU/WASM.
- [Deploy Open-Source TTS 2026 (Spheron)](https://www.spheron.network/blog/deploy-open-source-tts-gpu-cloud-2026/) — Kokoro/Chatterbox 2026 landscape (confirms model choices already locked in PROJECT.md).
- Electron docs (training-data, HIGH confidence on the API surface): `MessageChannelMain`/`MessagePortMain` for binary lanes, `utilityProcess` for isolated workers, `webContents.send` for push.
- AI SDK 6 (CLAUDE.md stack + ask.ts usage): `streamText` `textStream` + `abortSignal` for cancellable streaming; `generateObject` + Zod for typed intent.

---
*Architecture research for: Aria v2.0 duplex voice interface*
*Researched: 2026-06-02*
