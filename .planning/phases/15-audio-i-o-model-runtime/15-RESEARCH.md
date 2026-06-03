# Phase 15: Audio I/O + Model Runtime — Research

**Researched:** 2026-06-03
**Domain:** Local audio pipeline (renderer mic capture / Silero VAD / Kokoro TTS) + whisper.cpp CLI sidecar + model download lifecycle — proven on packaged Electron app, Windows + macOS
**Confidence:** HIGH on architecture/patterns/versions; MEDIUM on whisper.cpp macOS binary procurement; MEDIUM-LOW on RAM ceiling empirics (requires on-device measurement)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01** STT = persistent child-process sidecar wrapping whisper.cpp CLI binary (prebuilt, per-platform). NOT a Node native addon. Zero Node-ABI coupling; segfault isolated from app process.
- **D-02** Bundle per-platform binaries via electron-builder `extraResources`. Mirror `resolveBrandIcon`/`resourcesPath` pattern. Must be code-signed/notarized on macOS — this is an explicit Phase-15 packaging task.
- **D-03** Sidecar persistent — load model once, stream in/out over stdio. Lifecycle managed by `powerMonitor` (suspend on sleep, resume on wake). Zombie cleanup on crash.
- **D-04** If macOS binary signing proves intractable, fallback = utilityProcess + native addon (wire-but-disable). Do NOT re-architect mid-phase.
- **D-05** Default model = Whisper large-v3-turbo q5_0 GGML (~547 MB / ~1.1-1.3 GB RAM). Community "last good quant" — WER ~2.5%.
- **D-06** Model not bundled in installer — downloaded post-install from `ggml-org/whisper.cpp` HF repo into `userData`. q8_0 and f16 are opt-in.
- **D-07** Two download entry points: (a) skippable OnboardingWizard step; (b) lazy first-PTT modal. Both carry SC4 qualities: progress, resumable (HTTP Range), size disclosure before download, graceful "voice unavailable" state.
- **D-08** "Voice unavailable" = disabled PTT affordance routing to download flow. Mirror `TrialBanner`/entitlement-gate disabled-state. Persist model-readiness in `user_prefs` via migration ≥ 136.
- **D-09** Resumable download in main process. Pause on sleep/battery via `powerMonitor`. (Discretion: exact download library.)
- **D-10** PTT in-app/focused-window only. Hold-to-talk: renderer DOM keydown/keyup. Click-toggle on same hook. No `globalShortcut` (no keyup event per electron #26301).
- **D-11** VAD plays two roles: under hold = trailing-silence trim (conservative, does NOT end turn — keyup does); under toggle = turn-ender via `onSpeechEnd`. Use `redemptionMs` and `positiveSpeechThreshold` tuning.
- **D-12** No global hotkey, no `uiohook-napi` this phase. Wake-word = Phase 18.
- **D-13** Half-duplex gate: `micGated = true` on turn-start AND during all TTS playback. PTT blocked while Aria speaks. Verified on laptop speakers.
- **D-14** Persistent `StatusDot` in Topbar right cluster. States: idle=gray, listening=gold (slow pulse), processing=gold+spinner-arc, speaking=moss, muted-during-playback=gray+struck-mic, error=rose. No new design tokens.
- **D-15** Transient `VoiceHUDBand` in App shell at TrialBanner slot (in-flow between Topbar and scrollable main). Not a floating overlay. `role="status" aria-live="polite" aria-atomic="false"`. Collapses to dot-only when idle.
- **D-16** `prefers-reduced-motion` replaces transitions with instant toggle+static fill. Errors route through `ToastHost`.
- **D-17** State model MUST represent `speaking` state now so Phase 16 drops in without redesign.
- **D-18** Real `kokoro-js` (Kokoro-82M) playback path + half-duplex gate. Trigger with minimal utterance (echo transcript or fixed confirmation). A placeholder beep was explicitly rejected (leaves TTS packaging + RAM unproven).
- **D-19** Capture = renderer `getUserMedia` → AudioWorklet → 16 kHz mono PCM. Bundle worklet as inline Blob URL to dodge CSP/file-protocol. PCM renderer→main over typed IPC preload using transferable `ArrayBuffer`/chunked messages. No native recorder. Not desktopCapturer.
- **D-20** Device hot-swap + 16 kHz resample in AudioWorklet (renderer-side). Permission-denied = actionable error via ToastHost + HUD error state.

> **D-08 storage reconciliation (Spec-vs-codebase correction, PATTERNS.md correction 1):** D-08's literal "persist model-readiness in `user_prefs` via migration ≥ 136" is reconciled to the `settings(k,v)` KV table via `src/main/voice/prefs.ts` — `user_prefs` does NOT exist in the schema. NO migration is created and NO `embedded.ts` snapshot change is needed. See the Plan 15-01 Task 2 implementation and the CONTEXT.md D-08 addendum.

### Claude's Discretion
- Sidecar stdio framing protocol (length-prefixed PCM vs JSON lines) and exact whisper.cpp binary procurement (ship release binaries vs build in CI).
- Exact resumable-download library.
- AudioWorklet bundling specifics and VAD threshold values (within D-11 roles).
- Whether `VoiceHUDBand` uses `grid-template-rows: 0fr/1fr` or `max-height` expansion.

### Deferred Ideas (OUT OF SCOPE)
- Streaming STT→LLM→TTS cascade, barge-in, spoken briefing/answer playback — Phase 16.
- Voice-driven writes, cloud opt-in STT/TTS, voice settings — Phase 17.
- Always-listening wake-word, uiohook-napi, global tray activation — Phase 18.
- q8_0 / f16 model opt-ins — deferred pending headroom benchmarking.
- Chatterbox-Turbo-ONNX as alternate voice — Phase 17+.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VOICE-01 | User can talk to Aria via push-to-talk (hold hotkey / click) with live transcription shown | AudioWorklet capture + Silero VAD + whisper.cpp sidecar + VoiceHUDBand live text; D-10/D-11/D-15 cover implementation |
| VOICE-04 | Voice runs on-device by default; no audio leaves the machine | whisper.cpp CLI sidecar (never a cloud call); D-01 design constraint; sidecar framing protocol keeps PCM local |
| VOICE-07 | Mic state always visible; mic gated during playback so Aria never transcribes own TTS | StatusDot + VoiceHUDBand (D-14/D-15); half-duplex gate (D-13); verified on laptop speakers (SC3) |
</phase_requirements>

---

## Summary

Phase 15 stands up Aria's local audio pipeline end-to-end: renderer mic → Silero VAD → 16 kHz PCM → main-process whisper.cpp CLI sidecar → live transcript → Kokoro TTS playback + half-duplex gate. The phase doubles as the RAM ceiling proof (STT + TTS + Ollama 8B co-resident on a 16 GB no-GPU machine) and the packaging proof (sidecar binary code-signed, launching without NODE_MODULE_VERSION crash on both platforms).

The three most consequential research findings that the planner MUST account for are:

1. **whisper.cpp official releases do NOT include macOS CLI binaries.** Release v1.8.6 (latest as of 2026-06-03) ships Windows x64 and Win32 bins plus CUDA variants, but macOS only provides an xcframework for Swift/Xcode integration. The planner must decide: build macOS binaries in Aria's own CI (via cmake), or rely on a third-party community distribution. This is the single most uncertain item in the phase.

2. **whisper-cli does NOT natively support stdin PCM streaming.** The CLI is file-based; true streaming requires writing VAD-gated audio segments to temp WAV files (or named pipes on macOS/Linux) and spawning the CLI per utterance, OR using the whisper-stream example binary (which owns the microphone directly, unsuitable for our renderer-captures-audio model). The persistent-sidecar framing protocol (D-03) must account for this: the sidecar wraps the CLI in a Node.js process that accepts PCM chunks, assembles WAV segments on PTT endpoints, and shells to `whisper-cli`, streaming JSON-line results back on stdout.

3. **kokoro-js (Kokoro-82M) runs in the renderer** on `wasm` or `webgpu`; it uses `@huggingface/transformers` and downloads ~160 MB ONNX model to the HF cache on first use. This download is SEPARATE from the Whisper model and must have its own disclosure + progress flow — but the model is smaller and faster to acquire. The library supports `device: 'cpu'` in Node.js but in-renderer `webgpu`/`wasm` is preferred because synthesized audio plays without an IPC audio hop.

**Primary recommendation:** Build macOS binaries in Aria's CI (GitHub Actions, `cmake -DWHISPER_METAL=ON`), ship alongside the Windows prebuilt, sign both with electron-builder's `binaries` option, and stage the sidecar wrapper as a Node.js child that owns the VAD-endpoint→WAV→whisper-cli→JSON-line protocol.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Mic capture (`getUserMedia`) | Renderer | — | `navigator.mediaDevices` is Chromium-only; main has no audio device access |
| 16 kHz resample + device hot-swap | Renderer (AudioWorklet) | — | Worklet runs on audio render thread, deterministic 20ms frames |
| Silero VAD / endpoint detection | Renderer (`@ricky0123/vad-web`) | — | Must run adjacent to capture for lowest-latency PTT; ONNX WASM |
| PCM frames → main transport | IPC preload bridge (transferable ArrayBuffer) | — | Typed IPC surface; start on invoke, migrate to MessagePort in Phase 19 |
| STT transcription (whisper.cpp) | Main (child_process sidecar) | — | CLI binary, not a native addon; crash-isolated; off main event loop |
| Transcript → renderer | Main push via `makeRendererEmitter` | — | Existing push pattern (ENTITLEMENT_STATE_CHANGED / NAVIGATE precedent) |
| TTS synthesis (Kokoro) | Renderer (kokoro-js, WASM/WebGPU) | — | Audio plays immediately; no IPC audio hop; WebGPU accel when available |
| Half-duplex gate (`micGated`) | Renderer state + main signal | — | Renderer owns playback; main tells renderer "speaking" state |
| Mic-state indicator (StatusDot) | Renderer (Topbar right cluster) | — | D-14; uses existing StatusDot editorial component |
| VoiceHUDBand (live transcript + state) | Renderer (App shell, TrialBanner slot) | — | D-15; in-flow, no z-index conflict |
| Model download manager | Main process | — | Needs `userData` path, `powerMonitor`, `http` Range; D-09 |
| Model-readiness pref | SQLite `settings(k,v)` KV via `src/main/voice/prefs.ts` (no migration) | — | D-08; persisted across restarts |
| Onboarding voice step | Renderer (OnboardingWizard) | — | D-07; appended step after existing password step |

---

## Standard Stack

### Core Audio + STT + TTS

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@ricky0123/vad-web` | 0.0.30 (ISC) | Silero VAD in renderer — speech start/end events | De-facto JS VAD; commercial-safe; ONNX WASM; drives D-11 dual-role |
| `@ricky0123/vad-react` | 0.0.36 (ISC) | React hook wrapper for vad-web (`useMicVAD`) | Aria renderer is React 18; use hook not raw wiring |
| `kokoro-js` | 1.2.1 (Apache-2.0) | Local TTS — Kokoro-82M ONNX via `@huggingface/transformers` | No native build; WebGPU/WASM; `TextSplitterStream` for Phase 16 streaming; Apache-2.0 weights |
| `node-downloader-helper` | 2.1.11 | Resumable HTTP download for model files (main process) | Zero external deps; HTTP Range resume; progress events; works in Electron main; last updated 2026-03 |

**whisper.cpp CLI binary** — NOT an npm package. See Binary Procurement section below.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@huggingface/transformers` | ≥3.5.1 (peer dep of kokoro-js) | ONNX Runtime Web — pulled in automatically by kokoro-js | Don't install separately unless pinning ORT version |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `node-downloader-helper` | Native `https` + Range header | NDH handles retries, resume-from-file, progress events out of the box; hand-rolling adds ~100 lines of retry/seek logic |
| `@ricky0123/vad-web` | Picovoice Cobra VAD | Only if paying Picovoice for wake-word (Phase 18); free version is commercial-safe, Silero (MIT model) |
| `kokoro-js` WASM | `kokoro-js` cpu (Node.js main) | Node.js cpu is slower and requires routing audio back over IPC; renderer WASM/WebGPU is preferred |

**Installation:**
```bash
pnpm add @ricky0123/vad-web@0.0.30 @ricky0123/vad-react@0.0.36 kokoro-js@1.2.1 node-downloader-helper@2.1.11
```

---

## Architecture Patterns

### System Architecture Diagram

```
RENDERER (Chromium)
  getUserMedia (mic)
      │ 48 kHz stereo
  AudioWorklet
      │  resample to 16 kHz mono PCM, 20ms frames
      │  device hot-swap / permission-denied surfaced
      │
  @ricky0123/vad-react (useMicVAD, Silero ONNX WASM)
      │  under hold: trailing-trim (conservative)
      │  under toggle: onSpeechEnd = turn-ender
      │
  VoiceSession (Zustand store)
      │  state: IDLE → LISTENING → TRANSCRIBING → (result) → IDLE
      │  micGated flag: true on turn-start + during TTS playback
      │
  Typed IPC bridge (window.aria.voiceFeedAudio)
      │  transferable ArrayBuffer, chunked
      │
      │           MAIN (Node.js)
      │
  SttSidecarManager (child_process.spawn)
      │  whisper.cpp CLI binary (per-platform, extraResources)
      │  sidecar wrapper: PCM chunks → VAD endpoint → WAV temp file → CLI → JSON-line out
      │  lifecycle: persistent process; powerMonitor sleep/wake; zombie cleanup
      │
  transcript lines (JSON-line: { text, final, start_ms, end_ms })
      │
  makeRendererEmitter push (VOICE_TRANSCRIPT_DELTA)
      │
  VoiceHUDBand (live text, role=status aria-live=polite)
  StatusDot in Topbar (state color)
      │
  Kokoro TTS (kokoro-js, renderer, WASM/WebGPU)
      │  KokoroTTS.from_pretrained, device: 'webgpu'|'wasm'
      │  TextSplitterStream ready for Phase 16
      │  audio → AudioBufferSourceNode → speaker
      │
  half-duplex gate signal (VOICE_TTS_PLAYING → micGated = true)
      │  VOICE_TTS_DONE → micGated = false, cooldown ~800ms elevated threshold
```

### Recommended Project Structure

```
src/
├── main/
│   └── voice/
│       ├── confirm.ts            (EXISTING — dormant, do not modify)
│       ├── confirm.spec.ts       (EXISTING — do not modify)
│       ├── prefs.ts              # settings(k,v) KV model-readiness prefs (D-08; NO migration)
│       ├── stt/
│       │   ├── sidecar-manager.ts  # spawn/kill/restart whisper-cli; VAD-endpoint-gated WAV→CLI protocol
│       │   └── sidecar-manager.spec.ts
│       └── download/
│           ├── model-download.ts   # NDH-based resumable download; powerMonitor pause; progress IPC push
│           └── model-download.spec.ts
├── main/
│   └── ipc/
│       └── voice.ts              # registerVoiceHandlers: start/stop/feedAudio/cancelTts/getModelStatus
├── shared/
│   ├── ipc-contract.ts           # MODIFY: add VOICE_* channels
│   └── voice-types.ts            # NEW: VoiceState, TranscriptDelta, ModelStatus DTOs
├── preload/
│   └── index.ts                  # MODIFY: add onVoiceTranscript, onVoiceState, onModelProgress push overrides
└── renderer/
    └── features/voice/
        ├── useVoiceSession.ts     # Zustand store + IPC wiring + push subscriptions
        ├── capture/
        │   ├── mic-worklet.ts     # AudioWorklet processor source (bundled as Blob URL)
        │   └── useMicCapture.ts   # getUserMedia + worklet setup + device hot-swap
        ├── VoicePTTButton.tsx     # Hold-to-talk + click-toggle button
        ├── VoiceHUDBand.tsx       # In-flow HUD: live transcript + state label
        ├── VoiceStatusDot.tsx     # Topbar StatusDot wrapper with voice states
        ├── VoiceModelDownload.tsx # Progress modal: size disclosure + pause/resume + lazy first-PTT gate
        └── tts/
            └── useKokoroPlayer.ts # kokoro-js KokoroTTS.from_pretrained + TextSplitterStream + playback
```

### Pattern 1: Sidecar Stdio Framing (recommended: JSON-lines over stdout)

**What:** The sidecar is a Node.js child process (`child_process.spawn`) that wraps the whisper.cpp CLI binary. It accepts an internal command over its own stdin (newline-delimited JSON): `{ cmd: 'transcribe', wavPath: '/tmp/aria-voice-XXXX.wav' }`. The CLI is spawned as a subprocess, captures its stdout (with `--output-json` flag), and emits JSON-line results back on the sidecar's stdout.

**Why JSON-lines over binary framing:** The whisper-cli is NOT a persistent streaming process (see constraint below) — it processes a file and exits. The sidecar wraps this as a persistent process by keeping itself alive between calls, managing the temp-file lifecycle, and serializing invocations. JSON-lines are debuggable and TypeScript-friendly. Length-prefixed binary framing would only be needed if we were streaming raw PCM into the binary, which is unsupported.

**Critical constraint (VERIFIED):** The whisper.cpp CLI (`whisper-cli`) does NOT support raw PCM stdin streaming. Issue #3521 (opened Nov 2025) is open with no resolution. The `whisper-stream` example owns the microphone directly (unusable — renderer owns the mic per D-19). The only viable CLI-based approach is: buffer audio for a PTT segment, write a 16-bit WAV temp file, invoke `whisper-cli -m <model> -f <wav> --output-json --no-timestamps`, parse stdout JSON. This is the segment-per-utterance approach.
[CITED: github.com/ggml-org/whisper.cpp/issues/3521]

**Latency implication:** Segment-per-utterance means there is no incremental partial transcript from the CLI itself. Partials shown in the HUD are VAD activity indicators ("listening…") not word-by-word STT output. True word-level partials require a different execution model (the whisper-node-addon or nodejs-whisper with streaming). The planner should note this trade-off: D-01's sidecar choice gives zero ABI risk and SC2 by construction, at the cost of no mid-utterance partial word stream.

**Example:**
```typescript
// sidecar-manager.ts — Node.js wrapper process spawned from main
// The whisper-cli binary is at: path.join(process.resourcesPath, 'whisper-cli<.exe>')
// Protocol:
// stdin: JSON-lines → { cmd: 'transcribe', wavPath: string }
// stdout: JSON-lines → { text: string, final: boolean, segments?: Segment[] }

import { spawn } from 'node:child_process';
import * as path from 'node:path';

// Source: whisper-cli flag reference [CITED: deepwiki.com/ggml-org/whisper.cpp/3.1-command-line-interface]
function buildArgs(modelPath: string, wavPath: string): string[] {
  return [
    '-m', modelPath,
    '-f', wavPath,
    '--output-json',     // emit JSON to stdout
    '-t', '4',           // CPU threads (tune per platform)
    '--language', 'auto',
    '--no-timestamps',   // simpler output for Phase 15
  ];
}
```

[VERIFIED: github.com/ggml-org/whisper.cpp issues; deepwiki.com CLI reference]

### Pattern 2: Blob URL AudioWorklet (dodge CSP / file:// protocol)

**What:** The AudioWorklet processor source is a TypeScript/JS string, compiled to a Blob URL at runtime, and registered via `audioContext.audioWorklet.addModule(blobUrl)`. This avoids Electron's CSP `script-src` restrictions on `file://` URLs.

**Known issue:** Blob URLs require `blob:` to be in the CSP `script-src` directive. Electron's default `session.defaultSession.webRequest.onHeadersReceived` CSP must allow `blob:` in `script-src`. Check Aria's existing CSP header in `src/main/index.ts` before building the worklet.

**Why:** `AudioWorklet` cannot load from `file://` without a relaxed CSP; a `blob:` URL is the canonical workaround.
[CITED: github.com/WebAudio/web-audio-api-v2/issues/109 — Alternatives for module loading of AudioWorklet]

```typescript
// mic-worklet.ts — inline worklet source as template literal
const WORKLET_SOURCE = `
class MicProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]?.[0]; // mono channel
    if (input?.length) {
      this.port.postMessage({ pcm: input.buffer }, [input.buffer]);
    }
    return true;
  }
}
registerProcessor('mic-processor', MicProcessor);
`;

export async function setupWorklet(audioCtx: AudioContext): Promise<AudioWorkletNode> {
  const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  await audioCtx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url); // clean up after registration
  return new AudioWorkletNode(audioCtx, 'mic-processor');
}
```

[ASSUMED — the exact CSP value in Aria's src/main/index.ts was not verified in this session; planner must check]

### Pattern 3: Kokoro TTS in Renderer (webgpu / wasm fallback)

**What:** Load `KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { device: 'webgpu', dtype: 'fp32' })` (with `wasm` fallback) in the renderer. Keep the instance as a React ref. For Phase 15's minimal trigger (echo transcript), call `tts.generate(text, { voice: 'af_heart' })` and feed the resulting `Float32Array` audio to an `AudioBufferSourceNode`.
[CITED: npmjs.com/package/kokoro-js — device options; github.com/hexgrad/kokoro README — TextSplitterStream]

**Model download:** kokoro-js downloads from HuggingFace on first use via `@huggingface/transformers`. The model cache is controlled by `env.cacheDir` (transformers.js). In Electron, the renderer does NOT have write access to arbitrary paths; the ONNX model cache lands in the user's browser cache partition or in `userData` if `env.cacheDir` is set. For Phase 15, allow the default HF cache; a controlled `userData` path is a Phase 19 concern.

**Model size:** ~160 MB ONNX download on first use (then cached).
[VERIFIED: dev.to/emojiiii — "Running Kokoro-82M ONNX TTS Model in the Browser"; huggingface.co/posts/Xenova]

**Separating the two download flows:** The Kokoro model (~160 MB) downloads lazily on first TTS use in the renderer — no explicit progress bar needed for Phase 15 (the model is small and downloads in seconds on a reasonable connection). The Whisper model (~547 MB) is the explicit designed download flow with progress, pause, resume, and size disclosure (D-07/D-09). Do NOT conflate the two.

### Pattern 4: Resumable Download with node-downloader-helper

**What:** In main process, use `DownloadHelper` from `node-downloader-helper` for the Whisper model download. The library handles HTTP Range headers for resume, emits `progress` events, and supports `pause()`/`resume()`/`stop()`.

```typescript
// model-download.ts — main process
import { DownloadHelper } from 'node-downloader-helper';

const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin';
// File: ggml-large-v3-turbo-q5_0.bin, ~574 MB (601,882,624 bytes)
// [VERIFIED: search result — WebSearch huggingface.co ggerganov/whisper.cpp]

export function createModelDownload(destDir: string): DownloadHelper {
  const dl = new DownloadHelper(MODEL_URL, destDir, {
    resumeIfFileExists: true,       // HTTP Range resume
    resumeOnIncomplete: true,       // retry on interrupted download
    resumeOnIncompleteMaxRetry: 5,
    httpsRequestOptions: { headers: { 'User-Agent': 'Aria/1.0' } },
  });
  return dl;
}
// Emit progress via makeRendererEmitter on 'progress' event
// Pause on powerMonitor 'suspend'; resume on 'resume'
// On complete, flip model-readiness via the settings(k,v) KV prefs (src/main/voice/prefs.ts) — NO migration
```

**HF CDN Range support:** Hugging Face uses AWS CloudFront as CDN for model files. CloudFront supports `Accept-Ranges: bytes` for files under 50 GB (confirmed). The ~574 MB q5_0 model is well under this limit.
[CITED: huggingface.co/blog/rearchitecting-uploads-and-downloads]
[VERIFIED: node-downloader-helper 2.1.11 npm registry, last modified 2026-03-06]

### Pattern 5: VAD Threshold Configuration (D-11 dual-role)

VAD parameters from `@ricky0123/vad-web` `FrameProcessorOptions` (verified against source):
[VERIFIED: github.com/ricky0123/vad/blob/master/packages/web/src/frame-processor.ts]

| Parameter | Default | D-11 Hold role | D-11 Toggle role |
|-----------|---------|----------------|------------------|
| `positiveSpeechThreshold` | 0.3 | RAISE to ~0.5 (conservative, avoids false turn-end) | 0.35 (normal sensitivity) |
| `negativeSpeechThreshold` | 0.25 | RAISE to ~0.45 (same conservatism logic) | 0.25 (default) |
| `redemptionMs` | 1400 ms | RAISE to ~2000 ms (suppress trailing trim — keyup ends the turn) | 1400 ms (default — turn-ender) |
| `minSpeechMs` | 400 ms | 400 ms | 400 ms |
| `preSpeechPadMs` | 800 ms | 800 ms | 800 ms |

**Key insight for D-11:** Under **hold**, we NEVER want VAD to fire `onSpeechEnd` and end the turn — that is `keyup`'s job. So raise thresholds + redemptionMs to make VAD a trailing-silence TRIMMER only. Under **toggle**, we want normal sensitivity so VAD fires `onSpeechEnd` to end the turn after a natural pause.

Implement via a `setVadMode('hold' | 'toggle')` that reconfigures the `useMicVAD` options on mode switch.

### Anti-Patterns to Avoid

- **Streaming raw PCM to whisper-cli via stdin:** Not supported; issue #3521 is open/unresolved. Always write a WAV segment file first.
- **Running kokoro-js in the main process for Phase 15:** `device: 'cpu'` in Node.js works but requires an IPC audio hop back to renderer; WASM/WebGPU in renderer plays immediately. Keep kokoro in renderer.
- **Using `desktopCapturer` for microphone:** Causes Windows renderer crashes (#42765/#46369); use `getUserMedia` only.
- **`echoCancellation: true` as sole AEC defense:** No-ops in Electron (#47043). Primary defense is the half-duplex gate (D-13).
- **Adding the whisper binary to `asarUnpack`:** `asarUnpack` is for `.node` native addons; plain executables go in `extraResources`, not in the asar at all.
- **Expecting utilityProcess for the sidecar CLI binary:** `utilityProcess` is Node.js-only (not for native CLI executables). Use `child_process.spawn` for the whisper-cli wrapper.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Resumable HTTP download with progress | Custom fetch + Range loop | `node-downloader-helper` 2.1.11 | Handles Range, retries, resume-from-file, progress events, Electron-compatible |
| Voice Activity Detection | Energy threshold + silence timer | `@ricky0123/vad-web` (Silero ONNX) | Classifier-based, not energy-only; WASM runs in renderer; proven in production |
| TTS ONNX inference | Custom ONNX runtime wrapping | `kokoro-js` 1.2.1 | Manages transformers.js/ONNX runtime, model download, `TextSplitterStream` |
| CSP Blob URL worklet setup | Per-app CSP exception | Standard inline-Blob pattern | The documented workaround for AudioWorklet in non-standard URL origins |

**Key insight:** In voice pipeline work the complexity is in integration (AEC, device hot-swap, temp-file lifetime, sidecar crash recovery) — hand-rolling the above means maintaining that complexity too.

---

## whisper.cpp Binary Procurement (Critical Discretion Item)

### Official Release Artifacts (v1.8.6 latest — VERIFIED via GitHub API)

| Artifact | Platform | Content | Size |
|----------|----------|---------|------|
| `whisper-bin-x64.zip` | Windows x64 | CLI binary + DLLs (CPU) | 4.0 MB |
| `whisper-blas-bin-x64.zip` | Windows x64 | CLI binary + OpenBLAS (faster CPU) | 16.5 MB |
| `whisper-cublas-12.4.0-bin-x64.zip` | Windows x64 CUDA | GPU-accelerated | 460 MB |
| `whisper-v1.8.6-xcframework.zip` | macOS/iOS Swift | XCFramework for Xcode — NOT a CLI binary | 50 MB |

[VERIFIED: github.com API /repos/ggml-org/whisper.cpp/releases/latest assets list]

**CRITICAL:** The official releases do NOT include macOS CLI binaries. There is no `whisper-cli-macos-arm64` artifact in the official release.

### macOS Binary Procurement Decision (Claude's Discretion)

Three options, in recommended order:

**Option A (RECOMMENDED): Build macOS binaries in Aria's own GitHub Actions CI**
- Fork/trigger a build job: `cmake -B build -DWHISPER_METAL=ON && cmake --build build -j --config Release`
- Produces `build/bin/whisper-cli` for arm64 (Metal-accelerated) and x64
- Store artifacts in `build/binaries/` in the repo (or download at build time)
- Pros: Full control, Metal acceleration, no third-party trust, reproducible
- Cons: macOS runner required in CI (~$0.08/min GitHub-hosted macOS); build adds ~5 min
- This is how production apps that ship whisper.cpp (e.g., Whisper Transcription, MacWhisper) do it

**Option B: Third-party community distribution (bizenlabs/whisper-cpp-macos-bin)**
- Provides arm64-Metal and x64 builds at github.com/bizenlabs/whisper-cpp-macos-bin
- Unverified commercial licensing / provenance / code-signing status
- MEDIUM risk for a production commercial app; depends on third-party maintenance
- Use only as a temporary expedient while CI build is set up

**Option C: Bundle Homebrew formula (mac-only dev hack)**
- `brew install whisper-cpp` → `/opt/homebrew/bin/whisper-cpp` or similar
- NOT suitable for a packaged Electron app; requires Homebrew on user machine

**Recommendation:** Implement Option A (CI build) in Wave 1 as the first task, because code-signing the binary requires a reproducible artifact with known provenance. Use Option B only if CI proves blocked and mark it as temporary.

[MEDIUM confidence — Option A is standard practice but requires verifying the CI workflow produces a signed-ready binary; no official whisper.cpp CI documentation for "distribution binary" exists]

### macOS Binary Signing

Aria's `package.json` already configures `hardenedRuntime: true` and `entitlements.mac.plist` with `allow-jit + allow-unsigned-executable-memory + network.client`.
[VERIFIED: build/entitlements.mac.plist read — 2026-06-03]

For the whisper.cpp CLI binary in `extraResources`:

1. electron-builder's `binaries` array (in `build.mac`) must list the path to the sidecar binary so it is code-signed with the Developer ID certificate during `electron-builder` packaging.
2. The sidecar binary inherits the app's entitlements via `entitlementsInherit` (already set in `package.json`).
3. Notarization covers all binaries inside the `.app` bundle including `Resources/` — no separate notarization step for the sidecar.
4. The binary does NOT need additional entitlements for microphone access because it never opens a microphone; PCM arrives as a WAV file argument.

```json
// package.json build.mac addition
"mac": {
  "binaries": ["Contents/Resources/whisper-cli"]
}
```

[CITED: electron.build/docs/mac — `binaries` option for signing additional executables]
[ASSUMED: the exact electron-builder `binaries` path format — verify against electron-builder docs during execution]

### Windows Binary

`whisper-bin-x64.zip` from the official release contains `whisper-cli.exe` and required DLLs (GGML libs). Windows OV signing of the app (deferred per Phase 8 context) also covers binaries in the installer at signing time. No separate step needed for the sidecar.

---

## Kokoro-js Deep Dive

### Execution Model (VERIFIED)

| Mode | Where | RAM | Performance | Use When |
|------|-------|-----|-------------|----------|
| `device: 'webgpu'` | Renderer | ~100-200 MB GPU | 6s audio/s on RTX4070, measurably faster on iGPU | GPU available (default attempt) |
| `device: 'wasm'` | Renderer | ~200-300 MB CPU | Slower; adequate for short utterances | WebGPU unavailable (fallback) |
| `device: 'cpu'` | Main/Node | Similar to wasm | No IPC audio hop benefit | Not recommended for Phase 15 |

[CITED: quick-tts.com/blog/kokoro-webgpu-benchmarks.html — WebGPU benchmarks]

### First-Use Model Download

- Model ID: `onnx-community/Kokoro-82M-v1.0-ONNX`
- Size: ~160 MB ONNX download on first use [VERIFIED: Xenova HF post; dev.to/emojiiii]
- Cache: `@huggingface/transformers` caches in browser IndexedDB/OPFS by default; override with `env.cacheDir` for a `userData` path
- Phase 15 approach: allow default cache; display a brief "Loading voice model…" indicator before first TTS; do NOT add this to the D-07 designed download flow (that is for Whisper ~547 MB)

### Phase 15 Minimal TTS Trigger

Per D-18, trigger with a fixed short utterance (e.g., `"Transcription received."` + echo of the detected text). This proves:
- kokoro-js loads and plays
- The half-duplex gate (`micGated = true`) fires before audio starts and releases after
- RAM ceiling can be measured under STT + TTS + Ollama 8B co-resident

```typescript
// useKokoroPlayer.ts — renderer
import { KokoroTTS } from 'kokoro-js';

const ttsRef = useRef<KokoroTTS | null>(null);

async function initTts(): Promise<void> {
  // Try WebGPU; fall back to WASM
  try {
    ttsRef.current = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      device: 'webgpu', dtype: 'fp32',
    });
  } catch {
    ttsRef.current = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      device: 'wasm', dtype: 'q8',
    });
  }
}
// Source: kokoro-js npm README [CITED: npmjs.com/package/kokoro-js]
```

---

## Common Pitfalls

### Pitfall 1: whisper-cli is NOT a streaming server
**What goes wrong:** Building a "persistent sidecar" that tries to keep whisper-cli running and pipe PCM to its stdin fails silently. Issue #3521 confirms raw PCM stdin is unimplemented.
**Root cause:** whisper-cli is a batch transcription tool, not a streaming server. The `whisper-stream` example owns the mic itself.
**Prevention:** The persistent sidecar is a Node.js wrapper that manages the temp-WAV lifecycle and spawns whisper-cli per utterance. The "persistence" is in the wrapper, not whisper-cli itself.
**Warning signs:** whisper-cli exits with no output; transcript never emits.
[VERIFIED: github.com/ggml-org/whisper.cpp/issues/3521; github.com/ggml-org/whisper.cpp/issues/3080]

### Pitfall 2: macOS binary must be in `binaries` array to be signed
**What goes wrong:** Binary added to `extraResources` but not to `mac.binaries`. On macOS 15+, Gatekeeper quarantines the unsigned executable even inside a notarized `.app` bundle. `spawn()` fails with EPERM or "operation not permitted."
**Root cause:** electron-builder only signs files explicitly listed in `binaries`; it doesn't recursively sign everything in Resources.
**Prevention:** Add the binary to `build.mac.binaries` AND test on a clean macOS machine with Gatekeeper enabled.
**Warning signs:** Works on dev machine (where quarantine was cleared), fails on clean install.
[CITED: electron.build/docs/mac — `binaries` option; forasoft.medium.com — signing extras]

### Pitfall 3: `useMicVAD` wasm model assets not found in Electron
**What goes wrong:** `@ricky0123/vad-web` loads ONNX model assets and wasm files from a relative path. In Electron renderer with `file://` protocol, relative paths fail unless the assets are in the same directory as the renderer HTML.
**Root cause:** The library uses configurable `baseAssetPath` and `onnxWASMBasePath`. In a Vite-bundled Electron renderer, these paths default to the web root of the dev server but break in production.
**Prevention:** In Vite build config, use `vite-plugin-static-copy` or copy the VAD wasm assets to the renderer output dir, then set `baseAssetPath` and `onnxWASMBasePath` to the correct `file://` path.
**Warning signs:** `Failed to fetch` errors for `.onnx` or `.wasm` files in DevTools; VAD never fires.
[CITED: github.com/ricky0123/vad/issues/230 — Model file not loaded issue]

### Pitfall 4: Temp WAV file not cleaned up on crash
**What goes wrong:** Sidecar crashes mid-transcription; temp WAV file remains in `os.tmpdir()`. On Windows, the temp file may be locked by the crashed process. On long sessions, dozens of stale temp files accumulate.
**Prevention:** Track temp files in an array; clean up on normal completion AND in a crash/exit handler. Use `try/finally` in the sidecar wrapper. Apply `powerMonitor` cleanup on suspend too.

### Pitfall 5: Topbar right-cluster insertion order
**What goes wrong:** The `StatusDot` for mic state is inserted into the Topbar without coordinating with the existing right cluster (⌘K button → bell → AvatarMenu). The dot either covers the bell or shifts the avatar off-screen.
**Root cause:** Topbar is a flex row; inserting a new element requires understanding the existing layout.
**Prevention:** Read `src/renderer/components/Topbar.tsx` (verified in this session — right cluster is `cmdk button → bell span → AvatarMenu`). Insert the `VoiceStatusDot` between the bell and the AvatarMenu, or to the left of the ⌘K button. D-14 says "Topbar right cluster" — pick one slot and document it.
[VERIFIED: src/renderer/components/Topbar.tsx read 2026-06-03]

### Pitfall 6: `esbuild` skips typecheck — voice types can drift
**What goes wrong:** New voice IPC channel types added to `ipc-contract.ts` but not mirrored in `preload/index.ts` push overrides. Build succeeds, runtime crashes with undefined method.
**Prevention:** Run `npm run typecheck` after every main/preload edit. Per project memory: esbuild skips tsc; only vitest tests and typecheck catch these errors.
[CITED: project MEMORY — esbuild_skips_typecheck]

### Pitfall 7: model-readiness persists in the settings KV table — NO migration
**What goes wrong:** An executor reads D-08's literal "persist in `user_prefs` via migration ≥ 136" and adds a `user_prefs` column / a `136_*.sql` migration + `embedded.ts` snapshot edit. But `user_prefs` does NOT exist in the schema, so the migration targets a non-existent table and the readiness pref never persists.
**Prevention:** Persist model-readiness in the existing `settings(k,v)` KV table via `src/main/voice/prefs.ts` (Plan 15-01 Task 2). There is NO migration, NO `ALTER TABLE`, NO `user_prefs` column, and therefore NO `embedded.ts` snapshot change. This is the Spec-vs-codebase reconciliation recorded in CONTEXT.md (D-08 addendum) and PATTERNS.md correction 1.
[CITED: PATTERNS.md correction 1; CONTEXT.md D-08 addendum; src/main/db/migrations/embedded.ts verified — latest migration = 135, no user_prefs table]

---

## RAM Ceiling Measurement

Phase 15 requires an explicit RAM measurement as a success check. The target: STT (q5_0 ~1.1-1.3 GB) + Kokoro TTS (~200-300 MB) + Ollama 8B (~5 GB) + Electron/Chromium (~300 MB) must co-reside on a 16 GB machine with headroom.

**Expected totals:** ~6.9-9.0 GB peak under full concurrency. On an 8 GB machine (the dev machine in this environment), this WILL swap. The dev machine has only 8 GB RAM — testing the RAM ceiling requires a 16 GB machine (user's primary machine). Do NOT attempt the concurrent RAM test on the 8 GB dev machine.
[ASSUMED — dev machine spec is 8 GB per `node -e os.totalmem()`; user's production machine spec not verified]

**Measurement procedure (SC4 check — planner should task this explicitly):**
```bash
# Windows: Task Manager → Processes → sort by Memory while PTT is held
# macOS: Activity Monitor → Memory tab — check "Memory Pressure" chart
# In-app: log process.memoryUsage() in main + renderer at PTT start, STT decode, TTS play
```

**What "success" looks like:** App responsive, no perceptible swap thrash, no OOM kill during a 10-second PTT session with Ollama 8B loaded.

---

## Model-Readiness Persistence (settings KV — NO migration)

> **SUPERSEDED:** An earlier draft of this section proposed a `136_voice_model_prefs.sql` migration adding `voice_model_ready` / `voice_model_path` columns to `user_prefs`. That is struck — `user_prefs` does NOT exist in Aria's schema (latest migration is `135_repair_approval_child_fks.sql`; the KV store is `settings(k,v)`).

Model-readiness state persists in the existing `settings(k,v)` KV table via `src/main/voice/prefs.ts` (Plan 15-01 Task 2). There is **NO migration**, **NO `ALTER TABLE`**, **NO `user_prefs` column**, and therefore **NO `embedded.ts` snapshot change**.

- Backing store: `settings(k,v)` rows (e.g. key `voice.model.status` → `0` not-downloaded / `1` ready / `2` downloading; key `voice.model.path` → absolute path).
- Accessors: `getVoiceModelStatus(db)`, `setVoiceModelReady(db, path)`, `setVoiceModelDownloading(db)` in `src/main/voice/prefs.ts`.
- This reconciles D-08's literal "user_prefs via migration ≥ 136" wording — see the CONTEXT.md D-08 addendum and PATTERNS.md correction 1.

[VERIFIED: ls migrations/ 2026-06-03 — latest is 135; no user_prefs table. CITED: PATTERNS.md correction 1]

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| smart-whisper addon (in-process) | whisper.cpp CLI sidecar | D-01 locked | Zero ABI risk; SC2 by construction |
| echoCancellation:true as AEC | Half-duplex gate | Electron #47043 | Half-duplex is the primary defense; no barge-in this phase |
| Always-listening VAD | Push-to-talk (D-10) | Phase 15 design | Zero OS permission needed; no wake-word licensing issue |
| nodejs-whisper spawn-per-call | Persistent Node.js wrapper (sidecar concept) | D-03 | One model load; warm latency ~100-200ms/segment |
| OpenAI Realtime for duplex | Local cascading pipeline | Locked v2.0 decision | Local-first; no biometric audio off-device |

**Deprecated/outdated for this project:**
- `smart-whisper` (last published 2024-10): functional but stale; sidecar choice renders it moot
- `keytar`: use `safeStorage` (already locked in CLAUDE.md)
- `mic` / `node-record-lpcm16`: stale; external sox/arecord dependency; don't use

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The exact electron-builder `binaries` path format for extraResources executables | macOS Binary Signing | Build sign step silently skips binary → Gatekeeper blocks on user machine |
| A2 | Aria's existing CSP in main/index.ts allows `blob:` in `script-src` | AudioWorklet Blob URL | Worklet registration fails silently; mic capture never starts |
| A3 | kokoro-js ONNX model caches in IndexedDB/OPFS by default in Electron renderer | Kokoro TTS section | Model re-downloads on every app launch if cache path is wrong |
| A4 | Kokoro WebGPU is available in Electron 41's Chromium version | Kokoro TTS section | Falls back to WASM silently; lower TTS performance |
| A5 | Hugging Face CDN serves Accept-Ranges for the q5_0 model file | Model download | Resume doesn't work; download restarts from 0 on interruption |
| A6 | macOS CI build of whisper-cli from source produces a code-sign-ready binary | Binary Procurement | May require specific cmake flags, frameworks (Metal), or dylib bundling |
| A7 | User's production machine has ≥ 16 GB RAM (dev machine has 8 GB only) | RAM Ceiling section | RAM ceiling test on dev machine will always swap; misleading results |

---

## Open Questions (RESOLVED)

1. **macOS Binary CI Build Feasibility**
   - RESOLVED: handled by the blocking human-action checkpoint in Plan 15-09 Task 2 (CI-build whisper-cli, verify `otool -L` self-containment, then electron-builder signing) before the packaged build runs.
   - What we know: No official macOS CLI binary in whisper.cpp releases. cmake builds work. bizenlabs provides third-party builds.
   - What's unclear: Does a cmake-built `whisper-cli` on macOS produce a self-contained binary (no external dylib deps) or does it require Metal.framework linkage? Does electron-builder's `binaries` array handle arbitrary executables or only those inside `Contents/MacOS`?
   - Recommendation: Wave 0 spike task — build whisper-cli on a macOS runner and verify `otool -L` shows only system frameworks, then test electron-builder signing on a test app before the full phase.

2. **Electron 41 Chromium WebGPU availability**
   - RESOLVED: made irrelevant by the webgpu→wasm device fallback in Plan 15-06 — Kokoro probes `navigator.gpu` at runtime and degrades to WASM, so default WebGPU availability is no longer a blocker.
   - What we know: Electron 41 uses Chromium ~130. WebGPU was in origin-trial then graduated to GA in Chrome 113+.
   - What's unclear: Does Electron 41's Chromium 130 expose WebGPU to renderer by default? Is `navigator.gpu` available in production build?
   - Recommendation: In Wave 0, render a quick feature-probe: `typeof navigator.gpu !== 'undefined'`. Use result to set Kokoro device.

3. **CSP `blob:` for AudioWorklet**
   - RESOLVED: addressed by Plan 15-01 Task 3, which reads the `src/main/index.ts` CSP and ensures `blob:` is present in `script-src` for the AudioWorklet Blob URL.
   - What we know: Electron sets a custom CSP via `onHeadersReceived`. The worklet Blob URL requires `blob:` in `script-src`.
   - What's unclear: Does Aria's current CSP allow `blob:` or does it use a restrictive default?
   - Recommendation: Wave 0 task — read `src/main/index.ts` CSP configuration and verify or add `blob:` to `script-src`.

4. **VoiceHUDBand expansion technique (Claude's Discretion)**
   - `grid-template-rows: 0fr/1fr` is animation-friendly with no `overflow: hidden` needed; `max-height` needs a fixed estimate. For `prefers-reduced-motion`, both collapse to instant toggle.
   - Recommendation: `grid-template-rows` — cleaner, no magic max-height value needed.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Sidecar wrapper, build | ✓ | v25.1.0 | — |
| npm/pnpm | Package install | ✓ | npm 11.6.3 | — |
| ffmpeg | (NOT required — wav written directly from PCM) | ✓ (present but unneeded) | installed | — |
| Ollama | RAM ceiling test | ✓ | installed | — |
| cmake / C++ toolchain | macOS whisper-cli build | ✗ (on Windows dev machine) | — | macOS CI runner required |
| macOS runner (CI) | Build + sign macOS whisper-cli | ✗ (not available locally) | — | bizenlabs binary (Option B) |
| Electron 41.6.1 | Packaged app test | ✓ (in devDeps) | 41.6.1 | — |
| Apple Developer ID cert | macOS notarization | ✗ (not on dev machine) | — | Unsigned build for local dev; signed only in CI |

**Missing dependencies with no fallback:**
- macOS CI runner: The packaged app signing + packaging test (SC2 on macOS) cannot be run on the Windows dev machine. A macOS GitHub Actions runner (or access to a macOS machine) is required for the SC2 verification.

**Missing dependencies with fallback:**
- Apple Developer ID cert: local dev builds run unsigned; signed builds are CI-only. Local dev uses `CSC_IDENTITY_AUTO_DISCOVERY=false` (existing pattern from CI workflow).

---

## Validation Architecture

> Nyquist Dimension 8 — required for VALIDATION.md derivation.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.x |
| Config file | `vitest.config.ts` (root — standard Aria setup) |
| Quick run command | `npx vitest run tests/unit/voice/ -x` |
| Full suite command | `npx vitest run --passWithNoTests` |
| E2E | `npx playwright test` (packaged app launch) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VOICE-01 PTT | DOM keydown/keyup starts/stops capture; IPC feedAudio called | Unit | `npx vitest run tests/unit/voice/useVoiceSession.spec.ts -x` | ❌ Wave 0 |
| VOICE-01 Live transcript | Transcript delta IPC push updates VoiceHUDBand text | Unit (React) | `npx vitest run tests/unit/voice/VoiceHUDBand.spec.tsx -x` | ❌ Wave 0 |
| VOICE-04 On-device | Static ratchet: no cloud STT call site in src/main/voice/** | Static grep | `npx vitest run tests/static/voice-routes-through-staging.spec.ts -x` | ✅ Exists (Phase 14) |
| VOICE-04 No ABI crash | Packaged app launches without NODE_MODULE_VERSION error | E2E smoke | `npx playwright test tests/e2e/packaged-launch.spec.ts` | ❌ Wave 0 |
| VOICE-07 StatusDot visible | StatusDot renders in Topbar with correct kind on state change | Unit (React) | `npx vitest run tests/unit/voice/VoiceStatusDot.spec.tsx -x` | ❌ Wave 0 |
| VOICE-07 Half-duplex | micGated = true while TTS playing; feedAudio rejected during gate | Unit | `npx vitest run tests/unit/voice/half-duplex.spec.ts -x` | ❌ Wave 0 |
| SC2 No ABI crash | `app.whenReady()` + IPC handler registration + window creation — no crash | E2E | Playwright electron launch test | ❌ Wave 0 |
| SC3 Laptop speakers | Manual UAT — Aria speaks, mic shows gated, no self-transcript | Manual | UAT checklist | N/A |
| SC4 Download flow | Progress events emitted; pause/resume work; size shown before start | Unit | `npx vitest run tests/unit/voice/model-download.spec.ts -x` | ❌ Wave 0 |
| SC5 Device hot-swap | `devicechange` event triggers stream re-acquisition; no crash | Unit | `npx vitest run tests/unit/voice/useMicCapture.spec.ts -x` | ❌ Wave 0 |
| Model-readiness pref | `getVoiceModelStatus(db)` flips to ready after `setVoiceModelReady` (settings KV; NO migration) | Unit | `npx vitest run src/main/voice/prefs.spec.ts -x` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run tests/static/voice-routes-through-staging.spec.ts tests/unit/voice/ -x`
- **Per wave merge:** `npx vitest run --passWithNoTests` (full suite)
- **Phase gate:** Full suite green + SC3 manual UAT before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/unit/voice/useVoiceSession.spec.ts` — covers VOICE-01 PTT/capture
- [ ] `tests/unit/voice/VoiceHUDBand.spec.tsx` — covers VOICE-01 live transcript rendering
- [ ] `tests/unit/voice/VoiceStatusDot.spec.tsx` — covers VOICE-07 Topbar state dot
- [ ] `tests/unit/voice/half-duplex.spec.ts` — covers VOICE-07 micGated gate behavior
- [ ] `tests/unit/voice/model-download.spec.ts` — covers SC4 download flow (NDH mock)
- [ ] `tests/unit/voice/useMicCapture.spec.ts` — covers SC5 device hot-swap
- [ ] `tests/e2e/packaged-launch.spec.ts` — covers SC2 no-crash on packaged launch
- [ ] `src/main/voice/prefs.ts` + `src/main/voice/prefs.spec.ts` — model-readiness via `settings(k,v)` KV (NO migration, NO `user_prefs` column)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | — |
| V3 Session Management | No | — |
| V4 Access Control | Partial | voiceConfirm never reaches send.ts/write paths — ratchet enforced by existing `voice-routes-through-staging.spec.ts` |
| V5 Input Validation | Yes | Transcript text is user-controlled input; sanitize before IPC push and before any LLM prompt injection (Phase 16 concern; note for now) |
| V6 Cryptography | No | Whisper model is not encrypted; not needed |

### Known Threat Patterns for Phase 15

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Biometric audio exfiltration | Information Disclosure | Local-only by construction (D-01/D-04); no cloud call sites in voice/; static ratchet |
| Transcript injection to IPC | Tampering | Sanitize transcript text before rendering in VoiceHUDBand; `aria-live` content must not be HTML |
| Sidecar binary replacement | Tampering | macOS code-sign; Windows OV sign; verify binary at startup via hash check |
| Temp WAV file persistence | Information Disclosure | Always-delete temp files post-transcription AND in crash/exit handler; write to `os.tmpdir()` not `userData` |
| Voice channel bypasses assertApproved | Elevation of Privilege | Phase 15 has no write paths; ratchet in `voice-routes-through-staging.spec.ts` enforces this |

---

## Sources

### Primary (HIGH confidence)
- Aria codebase direct reads (2026-06-03): `src/main/tray/icons.ts`, `src/main/index.ts`, `build/entitlements.mac.plist`, `package.json` (asarUnpack/extraResources/mac signing blocks), `src/preload/index.ts`, `src/renderer/app/App.tsx`, `src/renderer/components/Topbar.tsx`, `src/renderer/components/editorial/StatusDot.tsx`, `src/renderer/features/entitlement/TrialBanner.tsx`, `src/main/voice/confirm.ts`, `tests/static/voice-routes-through-staging.spec.ts`, `src/main/db/migrations/embedded.ts` (latest migration = 135)
- GitHub API `/repos/ggml-org/whisper.cpp/releases/latest` — asset list: v1.8.6, Windows bins only, no macOS CLI (VERIFIED 2026-06-03)
- `npm view` registry queries (2026-06-03): `kokoro-js@1.2.1` (Apache-2.0, `@huggingface/transformers@^3.5.1` dep), `node-downloader-helper@2.1.11` (updated 2026-03), `@ricky0123/vad-web@0.0.30` (ISC)
- github.com/ricky0123/vad/blob/master/packages/web/src/frame-processor.ts — VAD params with defaults (positiveSpeechThreshold 0.3, redemptionMs 1400 etc)

### Secondary (MEDIUM confidence)
- sourceforge.net/projects/whisper-cpp.mirror/files/v1.8.3/ — confirmed v1.8.3 release assets: Windows only, no macOS CLI
- github.com/ggml-org/whisper.cpp/issues/3521 — stdin PCM support unimplemented, open issue
- github.com/ggml-org/whisper.cpp/issues/3080 — feature request for stdin raw PCM (open)
- deepwiki.com/ggml-org/whisper.cpp/3.1-command-line-interface — CLI flags (`--output-json`, `--output-json`, threading, VAD mode)
- dev.to/emojiiii — Kokoro-82M browser ONNX ~160 MB first-use download
- huggingface.co/posts/Xenova — kokoro-js device options (wasm/webgpu/cpu)
- quick-tts.com/blog/kokoro-webgpu-benchmarks.html — WebGPU performance benchmarks
- huggingface.co/blog/rearchitecting-uploads-and-downloads — HF CDN = AWS CloudFront, Accept-Ranges supported
- electron.build/docs/mac — `binaries` array for signing additional macOS executables
- forasoft.medium.com (2026) — Electron macOS notarization; every executable must be signed
- bizenlabs/whisper-cpp-macos-bin releases — third-party macOS arm64/x64 builds (provenance unverified)

### Tertiary (LOW confidence)
- Various WebSearch results re: AudioWorklet Blob URL CSP pattern — `blob:` must be in script-src; standard workaround
- RAM estimates (STT q5_0 ~1.1-1.3 GB, Kokoro ~200-300 MB) — from CONTEXT.md research corpus; require empirical measurement

---

## Metadata

**Confidence breakdown:**
- Standard Stack (versions, VAD params, kokoro-js): HIGH — npm registry verified
- whisper.cpp binary procurement (macOS gap): MEDIUM — gap confirmed, recommended path clear but untested
- Architecture patterns (sidecar wrapper, Blob worklet): HIGH on design, MEDIUM on Electron-specific edge cases
- RAM ceiling: LOW empirically — requires measurement on 16 GB machine

**Research date:** 2026-06-03
**Valid until:** 2026-09-01 (whisper.cpp releases monthly; re-check at execution)

---

## RESEARCH COMPLETE

**Phase:** 15 — Audio I/O + Model Runtime
**Confidence:** MEDIUM-HIGH

### Key Findings

- **whisper.cpp official releases have NO macOS CLI binary.** Only Windows x64 bins and a Swift xcframework. The planner must include a macOS CI build task (cmake, Metal-enabled) as the first wave or accept a third-party binary with caveats.
- **whisper-cli is file-based, not a streaming server.** The sidecar wrapper is a Node.js process that buffers VAD-gated PTT segments into temp WAV files and invokes `whisper-cli --output-json` per utterance. Partials in the HUD are "listening" indicators, not word-level STT output.
- **kokoro-js (Kokoro-82M) targets the renderer** with device: 'webgpu'|'wasm', downloads ~160 MB on first use via HF/transformers.js cache — SEPARATE from the ~574 MB Whisper model designed download flow. Two distinct download concerns.
- **VAD dual-role (D-11) is parameter-level config:** raise `positiveSpeechThreshold`/`redemptionMs` under hold to suppress false turn-ends; use defaults under toggle for natural endpointing.
- **macOS sidecar binary signing** requires listing in `build.mac.binaries` in package.json — electron-builder does not auto-sign `extraResources` executables.
- **Model-readiness persists in the `settings(k,v)` KV table via `src/main/voice/prefs.ts` — NO migration.** D-08's literal "user_prefs via migration ≥ 136" is reconciled (CONTEXT.md D-08 addendum, PATTERNS.md correction 1) because `user_prefs` does not exist in the schema.

### File Created
`.planning/phases/15-audio-i-o-model-runtime/15-RESEARCH.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Standard Stack (versions/params) | HIGH | npm registry + codebase verified |
| whisper.cpp binary procurement | MEDIUM | Gap confirmed; CI-build path clear but untested |
| Architecture (sidecar, worklet, TTS) | HIGH | Design verified against constraints; edge cases ASSUMED |
| RAM ceiling | LOW | Requires on-device measurement; dev machine is 8 GB |

### Open Questions (RESOLVED)
- Does Aria's CSP allow `blob:` in `script-src`? — RESOLVED by Plan 15-01 Task 3 (CSP `script-src` gets `blob:`).
- Is WebGPU available in Electron 41 renderer? — RESOLVED: made irrelevant by the Plan 15-06 webgpu→wasm Kokoro fallback.
- Does cmake-built macOS whisper-cli binary have external dylib deps? — RESOLVED by the blocking Plan 15-09 Task 2 human-action checkpoint (`otool -L` verification before signing).
