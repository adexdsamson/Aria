# Stack Research

**Domain:** Voice pipeline (hybrid local-first STT/TTS + cloud opt-in) for an Electron/Node/TS desktop app — Aria v2.0 milestone
**Researched:** 2026-06-02
**Confidence:** HIGH (versions verified against the npm registry on 2026-06-02; licenses verified against package metadata + project docs)

> Scope note: model *accuracy/quality* was already researched (Whisper large-v3-turbo, Kokoro-82M, Chatterbox-Turbo, etc.) and is NOT re-litigated here. This file is about the **runtime/glue stack** — how to RUN those models from Node/Electron, capture/transport audio, and the consent-gated cloud path. Aria is a **commercial** product, so every recommendation is checked for commercial-use fitness. This supersedes the v1.0 STACK.md.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **smart-whisper** | 0.8.1 (MIT) | Local STT — native `whisper.cpp` addon with model manager + auto offload/reload | Cleanest **library-mode** binding (no shelling out to a CLI). Loads a model once and runs multiple inferences against it, auto-offloads to free RAM, exposes a streaming-friendly transcribe API — the right shape for a duplex conversational loop. Main-process native addon fits Aria's existing pattern. **Caveat: last published 2024-10; see "Maintenance risk."** |
| **nodejs-whisper** | 0.3.0 (MIT) | Local STT — fallback / file-mode transcription via `whisper.cpp` | Actively maintained (last publish 2026-04-11). Wraps the `whisper.cpp` CLI; auto-converts audio to 16 kHz WAV and emits `.txt/.srt/.vtt/.json`. Process-spawn per call = not ideal for low-latency duplex, but a safe current fallback for batch jobs (uploaded meeting file) and insurance against smart-whisper bit-rot. |
| **whisper.cpp** | latest (`ggml-org/whisper.cpp`, MIT) | The STT inference engine both bindings compile | Canonical engine for Whisper large-v3-turbo on-device. CPU by default; **Metal** auto-enabled on macOS; **CUDA/Vulkan** opt-in at build time. This is the binary you ship. |
| **kokoro-js** | 1.2.1 (Apache-2.0) | Local TTS — Kokoro-82M via Transformers.js + ONNX Runtime | Pure-JS, runs Kokoro-82M (Apache-licensed weights) on `cpu` in Node or `webgpu`/`wasm` in renderer. Ships a `TextSplitterStream` for **chunk-by-chunk streaming** audio out — needed to start speaking before the LLM finishes. No native build, no API key. Best default local TTS. |
| **onnxruntime-node** | 1.26.0 (MIT) | ONNX inference runtime for TTS (and Chatterbox path) | Backend for ONNX TTS on the Node side. Prebuilt binaries for win/mac/linux incl. CUDA EP. Needed if you run Chatterbox-Turbo-ONNX or pin Kokoro to a specific ORT version rather than the bundled Transformers.js wasm. |
| **@ricky0123/vad-web** | 0.0.30 (ISC) | Voice Activity Detection (Silero VAD) in the renderer | De-facto JS VAD. Bundles Silero VAD (MIT model). ISC = commercial-safe. Runs in the renderer with `getUserMedia`, emits speech-start/speech-end events that drive turn-taking + barge-in. Actively maintained (2025-11). |
| **openai** | 6.41.0 (Apache-2.0) | Cloud opt-in STT + TTS + Realtime (consent-gated path) | Already in Aria's orbit (AI-SDK uses OpenAI). One SDK covers `audio.transcriptions` (Whisper/gpt-4o-transcribe), `audio.speech` (TTS), and the Realtime API. Reuse the existing key + the same consent/disclosure UX that gates frontier LLM calls. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **@ricky0123/vad-react** | 0.0.36 (ISC) | React hook wrapper around vad-web | Aria's renderer is React 18 — use `useMicVAD` instead of wiring vad-web by hand. |
| **@openai/agents-realtime** | 0.11.6 (MIT) | Higher-level WebRTC/WebSocket client for OpenAI Realtime | Only if you choose OpenAI Realtime as the *full-duplex cloud* tier. Handles session, audio in/out, interruptions. Optional — raw `openai` SDK + WebSocket also works. |
| **whisper-node-addon** | 1.0.2 (MIT) | Prebuilt cross-platform `whisper.cpp` `.node` binaries for Electron | Insurance if smart-whisper/nodejs-whisper native builds fight `electron-rebuild`. Ships prebuilt `.node` for win-x64, linux x64/arm64, mac x64/arm64 with runtime arch detection; "zero-config for Electron." Evaluate as the binding if build pain appears. |
| **sherpa-onnx-node** | 1.13.2 (Apache-2.0) | Alt all-in-one on-device STT **and** TTS via ONNX | Fallback engine family (k2-fsa). Actively maintained (2026-05). Worth knowing if Kokoro-via-Transformers.js or whisper bindings disappoint; hosts ASR + TTS through one ORT addon. Not the default — adds a second inference stack. |
| **@elevenlabs/elevenlabs-js** | latest (MIT SDK) | Premium cloud TTS (consent-gated, "max quality" tier) | If the cloud opt-in path wants best-in-class voice / cloning beyond OpenAI TTS. Flash v2.5 ~75 ms latency, WebSocket streaming. **Cost:** ~$300/1M chars overage vs OpenAI TTS-1 $15/1M — premium. Optional upsell tier, not default cloud. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `@electron/rebuild` | Rebuild native STT addons against Electron's ABI | smart-whisper / whisper-node-addon are native — same ABI-lock discipline Aria already lives with for better-sqlite3 (Electron 41, NODE_MODULE_VERSION 141). Add them to the dual-build matrix. |
| `electron-builder` `extraResources` / `asarUnpack` | Ship GGML model files + native `.node` outside the asar | `.bin` whisper models and `.node`/`.onnx` blobs must be **asarUnpack**ed or placed in `resourcesPath` (the same pattern Aria already uses for the brand icon via `resolveBrandIcon`). |
| AudioWorklet (Web Audio, no package) | Renderer-side 16 kHz/16-bit PCM downsampling | Capture is `getUserMedia` → `AudioWorklet` → resample to 16 kHz mono PCM (both whisper.cpp and VAD want 16 kHz). Bundle the worklet as an inline Blob URL to dodge Electron CSP/file-protocol issues. |

## Installation

```bash
# Local STT (smart-whisper primary; nodejs-whisper fallback)
npm install smart-whisper nodejs-whisper

# Local TTS
npm install kokoro-js onnxruntime-node

# VAD (renderer)
npm install @ricky0123/vad-web @ricky0123/vad-react

# Cloud opt-in (consent-gated) — openai already present via AI SDK
npm install openai
npm install @openai/agents-realtime   # optional, full-duplex cloud tier
# npm install @elevenlabs/elevenlabs-js  # optional premium TTS tier

# Optional fallbacks / build insurance
# npm install whisper-node-addon sherpa-onnx-node

# Native addon rebuild for Electron's ABI
npm install -D @electron/rebuild
```

> **Wake-word is intentionally NOT in the install block** — it carries a licensing trap that must be decided before adding a dependency. See "What NOT to Use" and the wake-word variant.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| smart-whisper (library binding) | nodejs-whisper (CLI wrapper) | Batch/file transcription (uploaded meeting recording) where spawn latency is irrelevant; or if smart-whisper's stale native build breaks on Electron 41. |
| smart-whisper | whisper-node-addon (prebuilt) | If you cannot get a clean native build under `electron-rebuild`; prebuilt `.node` per platform avoids node-gyp entirely. |
| kokoro-js (Transformers.js) | Chatterbox-Turbo-ONNX via onnxruntime-node | When you want Chatterbox's emotion/paralinguistic tags + voice cloning and sub-200 ms latency; heavier (350M params, prefers GPU) but MIT-licensed and ONNX-exported. Selectable local voice, not the default. |
| kokoro-js | sherpa-onnx-node TTS | If you want ASR+TTS unified under one ORT addon and Kokoro-via-wasm is too slow on low-end CPUs. |
| OpenAI Realtime (cloud duplex) | Local cascading STT→LLM→TTS | **Local is the default** per locked decision. Cloud Realtime only on explicit consent for lowest-latency/highest-quality duplex; mirrors hybrid-LLM routing. |
| OpenAI TTS (cloud default) | ElevenLabs Flash v2.5 | When the user opts into a "max quality / cloned voice" tier and accepts ~20x per-char cost. |
| @ricky0123/vad-web (Silero) | Picovoice Cobra VAD | Only if you're *already* paying Picovoice for wake-word and want one vendor; otherwise Silero (MIT) is free and commercial-safe. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **openWakeWord pretrained models** | Code is Apache-2.0 but the **pretrained models are CC BY-NC-SA 4.0 (non-commercial)** — training data has unknown upstream licensing. Shipping them in a commercial product violates the license. | Either (a) train your own openWakeWord models on licensed/synthetic data, or (b) license **Picovoice Porcupine** (`@picovoice/porcupine-node` 4.0.2). Porcupine free tier allows commercial use but **only up to 3 monthly active users**; real deployment needs Foundation ($6k/yr) or Enterprise ($30k/yr). **Flag this cost before committing to always-listening.** |
| **XTTS-v2 / Coqui** | CPML license = **non-commercial**. Already flagged in model research. | Kokoro-82M (Apache-2.0) or Chatterbox (MIT). |
| **Moshi / single-model duplex locally** | Needs A100-class GPU; won't run on a typical exec laptop. | Local **cascading** STT→LLM→TTS with VAD-driven turn-taking + barge-in (the locked architecture). |
| **whisper-node (`ariym`)** | Older CLI binding, stale; superseded. | smart-whisper / nodejs-whisper. |
| **mic / node-record-lpcm16** | Last published 2022; depend on external `sox`/`arecord` binaries you'd bundle per-OS; fragile in packaged Electron. | Capture audio in the **renderer** via `getUserMedia` + AudioWorklet; stream PCM to main over IPC. No native recorder binary. |
| **desktopCapturer for microphone** | It's for screen/system audio and has known Windows renderer-crash bugs (electron #42765, #46369); overkill for mic. | Plain `getUserMedia({audio:true})` in renderer. |

## Stack Patterns by Variant

**Local default path (always available, no consent needed):**
- Capture: renderer `getUserMedia` → AudioWorklet → 16 kHz mono PCM
- Gate: `@ricky0123/vad-web` (Silero, MIT) detects speech start/end → barge-in support
- STT: `smart-whisper` in **main** process running `whisper.cpp` + Whisper large-v3-turbo (Metal on mac, CPU elsewhere, CUDA opt-in)
- Reasoning: existing Vercel AI-SDK hybrid router (local Ollama / frontier per sensitivity)
- TTS: `kokoro-js` (Kokoro-82M) streaming chunks back to renderer for playback
- Because: zero data leaves the machine; preserves Aria's local-first guarantee as the default.

**Cloud opt-in path (consent-gated, "max quality"):**
- Same capture + VAD in renderer
- Route to **OpenAI Realtime** (`@openai/agents-realtime` WebRTC) for full duplex, OR `openai.audio.transcriptions` + `openai.audio.speech` for cascaded cloud, OR ElevenLabs for premium TTS only
- Gate behind the **same consent/disclosure UX** that governs frontier LLM prompts; PII pre-routing rules still apply
- Because: mirrors the existing hybrid-LLM routing decision; crosses the network only on explicit opt-in.

**Push-to-talk (default activation):**
- No wake-word dependency — a hotkey/UI button starts capture. Zero licensing cost. Ship this first.

**Always-listening wake-word (opt-in activation):**
- Requires **Porcupine** (commercial license needed beyond 3 MAU) because openWakeWord's pretrained models are non-commercial.
- This is the one feature with a hard licensing/cost gate. Requirements must decide: (a) pay Picovoice, (b) train custom openWakeWord models, or (c) defer always-listening to v2.1.

**Audio transport (renderer ↔ main):**
- Renderer owns capture + playback (Web Audio is renderer-only in Electron). Main owns the native STT/TTS engines.
- Stream PCM frames renderer→main and synthesized audio main→renderer over the existing **typed IPC** layer (Aria already has a preload IPC surface). Use transferable `ArrayBuffer`/chunked messages; avoid a localhost socket sidecar unless a binding forces it.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| smart-whisper / whisper-node-addon | Electron 41 (NODE_MODULE_VERSION 141) | Native addons — **must** run through `@electron/rebuild` and join Aria's dual-build/ABI matrix (same lock that bites better-sqlite3). Verify before each Electron bump. |
| kokoro-js 1.2.1 | onnxruntime-node 1.26 / Transformers.js | kokoro-js bundles its own ORT-web (wasm) for Node `cpu`; only pin `onnxruntime-node` separately if you need a specific EP (CUDA) or run Chatterbox-ONNX alongside. |
| @ricky0123/vad-web 0.0.30 | renderer (Web Audio / wasm) | Runs in renderer, not main. Pairs with vad-react 0.0.36. Pre-1.0 — pin exact versions. |
| openai 6.41.0 | @openai/agents-realtime 0.11.6 | Both current as of 2026-06-01. Realtime model is GA (`gpt-realtime`, ~$0.06/min audio in, $0.24/min out). |
| .bin GGML models / .onnx / .node | electron-builder asar | Must be `asarUnpack`ed or shipped via `resourcesPath` (reuse the `resolveBrandIcon` pattern). |

### Maintenance risk flags (HIGH-value for downstream)

- **smart-whisper last published 2024-10** — functional but not actively updated. If it fails to build against a future Electron, migration target is `whisper-node-addon` (prebuilt, MIT, 2025-08) or `nodejs-whisper` (CLI, 2026-04). Keep both wired-but-disabled to de-risk.
- **@ricky0123/vad-* are pre-1.0 (0.0.x)** — stable in practice and widely used, but pin exact versions and expect occasional API churn.
- **Porcupine cost cliff** — free past 3 monthly-active-users requires a paid plan ($6k–$30k/yr). Single biggest commercial trap in the voice stack; surface in requirements before scoping always-listening.

## Sources

- npm registry (`npm view`) — verified versions/licenses/publish dates on 2026-06-02: smart-whisper 0.8.1 (MIT, 2024-10), nodejs-whisper 0.3.0 (MIT, 2026-04), kokoro-js 1.2.1 (Apache-2.0, 2025-05), @ricky0123/vad-web 0.0.30 (ISC, 2025-11), @ricky0123/vad-react 0.0.36 (ISC), onnxruntime-node 1.26.0 (MIT, 2026-05), openai 6.41.0 (Apache-2.0, 2026-06), @openai/agents-realtime 0.11.6 (MIT, 2026-06), @picovoice/porcupine-node 4.0.2 (Apache-2.0, 2026-04), whisper-node-addon 1.0.2 (MIT, 2025-08), sherpa-onnx-node 1.13.2 (Apache-2.0, 2026-05). — HIGH
- Context7 `/ggml-org/whisper.cpp`, `/ariym/whisper-node` — whisper.cpp engine + Node binding landscape — HIGH
- github.com/JacobLinCool/smart-whisper, github.com/ChetanXpro/nodejs-whisper, github.com/Kutalia/whisper-node-addon — binding capabilities + Electron prebuilt claims — MEDIUM
- npmjs.com/package/kokoro-js + HF post (Xenova) — Apache weights, TextSplitterStream streaming, cpu/wasm/webgpu devices — HIGH
- github.com/resemble-ai/chatterbox + HF ResembleAI/chatterbox-turbo-ONNX — MIT, 350M Turbo, ONNX export, paralinguistic tags — MEDIUM
- github.com/dscripka/openWakeWord + picovoice.ai/pricing + introducing-picovoices-free-tier — **openWakeWord pretrained = CC BY-NC-SA 4.0 (non-commercial)**; Porcupine free ≤3 MAU, Foundation $6k/yr, Enterprise $30k/yr — HIGH (licensing), MEDIUM (exact pricing)
- developers.openai.com/api/docs/guides/realtime + realtime-webrtc + pricing; openai.com/index/introducing-gpt-realtime — GA gpt-realtime, WebRTC/WS/SIP, ~$0.06/$0.24 per min audio — HIGH
- elevenlabs.io/text-to-speech-api + pricing; deepgram TTS-API comparison — ElevenLabs Flash v2.5 ~75 ms, WebSocket; OpenAI TTS-1 $15/1M vs ElevenLabs ~$300/1M overage — MEDIUM
- electronjs.org/docs/api/desktop-capturer + electron issues #42765/#46369 + web.dev microphone-process — renderer getUserMedia + AudioWorklet 16 kHz PCM pattern; desktopCapturer mic crashes on Windows — HIGH

---
*Stack research for: hybrid local-first + cloud-opt-in voice pipeline on Electron/Node/TS (Aria v2.0)*
*Researched: 2026-06-02*
