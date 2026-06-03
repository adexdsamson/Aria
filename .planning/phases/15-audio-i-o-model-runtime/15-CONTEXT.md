# Phase 15: Audio I/O + Model Runtime - Context

**Gathered:** 2026-06-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Stand up Aria's **local audio pipeline and model runtime** end-to-end and prove it survives packaging: capture the user's voice (push-to-talk), detect speech endpoints (VAD), run **on-device** transcription that does **not** break the native ABI, and play synthesized speech — all proven on the **packaged** app on **Windows + macOS**, with the mic gated during playback so Aria never transcribes its own TTS (half-duplex; Electron AEC is unreliable, #47043).

This phase delivers the *plumbing and the runtime*, not the conversation. Voice output exists only as far as needed to prove half-duplex on real laptop speakers and the STT+TTS+LLM RAM ceiling.

**In scope:** renderer mic capture + Silero VAD + 16 kHz PCM; STT sidecar (local Whisper) that survives packaging with no `NODE_MODULE_VERSION` crash; first-run model-download flow (progress + resumable + size disclosure + graceful unavailable state); push-to-talk (hold + click-toggle, in-app); always-visible mic-state indicator + live transcription; half-duplex mic gating; a minimal **real** Kokoro TTS playback path to prove the gate; device hot-swap + resample + permission-denied handling.

**Out of scope:** streaming STT→LLM→TTS cascade, barge-in, spoken briefing/answer playback (Phase 16); voice-driven writes, read-back of resolved entities, dual-channel confirm UX, cloud opt-in STT/TTS + consent disclosure, voice settings (Phase 17); always-listening wake-word + global tray activation (Phase 18).

**Requirements:** VOICE-01 (push-to-talk + live transcription), VOICE-04 (on-device by default; no audio leaves the machine), VOICE-07 (visible mic state + half-duplex gating).

</domain>

<decisions>
## Implementation Decisions

### STT execution model (→ Sidecar CLI binary, "A")
- **D-01:** Run local Whisper as a **persistent child-process sidecar** wrapping a **prebuilt `whisper.cpp` CLI binary** (per-platform), NOT a Node native addon. Rationale: zero Node-ABI coupling makes SC2's "no `NODE_MODULE_VERSION` ABI crash on launch" true **by construction** (a pure binary cannot throw it); a `whisper.cpp` segfault is isolated from the app process; reuses the `resourcesPath` bundling pattern Aria already ships. Matches the ROADMAP's "STT sidecar" wording (resolves the ROADMAP-vs-STACK.md tension in favor of the sidecar).
- **D-02:** Bundle the per-platform `whisper.cpp` binaries via electron-builder **`extraResources`** (mirror the existing `build/` → `resourcesPath` flow used by `resolveBrandIcon`; see `src/main/index.ts`, `src/main/tray/icons.ts`), NOT `asarUnpack` of a `.node`. **Per-platform binaries MUST be code-signed/notarized** — macOS `hardenedRuntime` + entitlements are already configured; treat the signing/notarization of the sidecar binary as an explicit Phase-15 packaging task and verify on the packaged app.
- **D-03:** Keep the sidecar **persistent** — load the model once, stream PCM in / transcript out over stdio — rather than spawn-per-utterance. Warm latency (~100-200 ms/segment) is acceptable for a PTT loop; spawn-per-call is too slow. Manage process lifecycle on sleep/wake using the `powerMonitor` integration already in the codebase, and clean up to avoid zombie processes on crash.
- **D-04:** STACK.md flags `smart-whisper` (the addon path) as a maintenance risk (last published 2024-10). The sidecar path sidesteps that binding entirely. If sidecar binary signing proves intractable during execution, the documented fallback is **utilityProcess + a native addon** (Electron's recommended crash-isolation for native code) — wire-but-disable rather than re-architect mid-phase.

### Default on-device STT model (→ large-v3-turbo q5_0)
- **D-05:** Default model = **Whisper large-v3-turbo q5_0 GGML** (~547 MB disk / ~1.1-1.3 GB RAM, WER ~2.5%). Community-identified "last good quant" — premium accuracy with the most comfortable headroom alongside Ollama 8B (~5 GB) + Kokoro TTS on a **16 GB no-GPU** machine. The STT+TTS+LLM RAM ceiling on 16 GB is a phase-explicit risk; q5_0 is the chosen balance.
- **D-06:** The model is **not bundled in the installer** (too large) — it is **downloaded post-install** from Hugging Face (`ggml-org/whisper.cpp`) into `userData`/`resourcesPath`. `q8_0` (~874 MB, ~f16 accuracy) is a higher-accuracy **opt-in** pending under-load benchmarking; `f16` full (~1.62 GB / ~2.3 GB RAM) is opt-in for 32 GB+ machines only.

### First-run model-download flow (→ Onboarding opt-in step + lazy fallback)
- **D-07:** **Two** download entry points: (a) a **skippable "Set up voice" step** appended to the existing `OnboardingWizard` (`src/renderer/features/onboarding/OnboardingWizard.tsx`) — download while the user is in setup-mindset; and (b) a **lazy first-PTT modal** for users who skipped the step. Both paths carry the SC4 qualities: progress indicator, **resumable** download (HTTP Range), **size disclosure before** download, and a graceful **"voice unavailable until ready"** state. The skip path makes the lazy modal mandatory anyway, so build both.
- **D-08:** "Voice unavailable until ready" = a **disabled PTT affordance** that routes to the download flow — mirror Aria's existing entitlement-gate disabled-state pattern (`TrialBanner.tsx` / entitlement gate). Persist model-readiness in `user_prefs` (new column/key via the next migration, ≥ 136 — latest is 135).
  - _Addendum (Spec-vs-codebase correction, PATTERNS.md correction 1):_ D-08 storage backing reconciled from `user_prefs` (migration ≥136) → `settings(k,v)` KV via `src/main/voice/prefs.ts`, since `user_prefs` does not exist in the schema; no migration created. The original D-08 text above is unchanged.
- **D-09:** Implement the **resumable download in the main process** (HF CDN supports `Accept-Ranges`); **pause on sleep/battery** via `powerMonitor`. (Discretion: exact download library — e.g. `node-downloader-helper` or equivalent with Range resume + progress events.)

### Push-to-talk interaction (→ In-app hold + click-toggle)
- **D-10:** PTT is **in-app / focused-window only** this phase (zero OS permission). **Hold-to-talk** via renderer DOM `keydown`/`keyup` (`keyup` = hard turn-end), PLUS **click-toggle** on the same hook for hands-free dictation. Rationale: Electron `globalShortcut` fires **only on keydown — no keyup** (electron #26301), so global *hold*-to-talk is impossible via that API.
- **D-11:** VAD (`@ricky0123/vad-web`, Silero, ISC) plays **two roles**: under **hold**, it is a trailing-silence **trim** (tune `positiveSpeechThreshold` / `redemptionFrames` / `missSpeechFrames` conservatively so it does NOT end the turn — `keyup` does); under **toggle**, its `onSpeechEnd` is the **turn-ender**.
- **D-12:** **No** global hotkey and **no** `uiohook-napi` this phase. Global/tray-backgrounded activation and wake-word are Phase 18 — deliberately keeping a second native-ABI module (and macOS Input Monitoring permission) out of an already ABI-heavy phase. VOICE-01 is satisfied entirely by the focused-window path.
- **D-13:** **Half-duplex gate** is the SC3/SC7 enforcement point: `micGated = true` on turn-start AND for the **entire duration of TTS playback**; PTT start is blocked while Aria is speaking. Verified on **laptop speakers** (the real acoustic echo path), not just headphones.

### Mic-state indicator (→ Hybrid: Topbar dot + transient HUD band)
- **D-14:** A **persistent `StatusDot`** in the Topbar right cluster (always-visible per SC3) encodes every state via the existing editorial color vocabulary (`src/renderer/components/editorial/StatusDot.tsx`): idle = gray, listening = gold (slow pulse), processing = gold + spinner arc, speaking = moss, muted-during-playback = gray + struck mic, error = rose. No new design tokens.
- **D-15:** A **transient `VoiceHUDBand`** mounts in the App shell at the **same structural slot the `TrialBanner` uses** (`src/renderer/app/App.tsx`, in-flow between the Topbar and the scrollable `<main>`) — **not** a floating overlay, so no z-index conflict with `ToastHost`/`CommandPalette` and no idle layout shift. It renders **live transcription** with `role="status" aria-live="polite" aria-atomic="false"` (announce incremental words, not the full buffer). Collapses to dot-only when idle.
- **D-16:** Accessibility: `prefers-reduced-motion` replaces the `max-height`/pulse transitions with an instant toggle + static fill (information stays encoded in color + the IBM Plex Mono uppercase label). Error states (permission denied, device lost) ALSO route through the existing **`ToastHost`** so they survive HUD collapse (SC5).
- **D-17:** The state model built here MUST be able to represent the **`speaking`** state so Phase 16's streaming spoken output drops in without a redesign.

### TTS scope this phase (→ Real Kokoro engine, minimal trigger)
- **D-18:** Stand up the **real `kokoro-js` (Kokoro-82M)** playback path + the half-duplex gate this phase, but **trigger it with a minimal utterance** (a fixed confirmation or an echo of the transcript) — NOT briefing/answer content. This proves TTS packaging and the **STT+TTS+LLM RAM ceiling on 16 GB** (a Phase-15 goal) and lets SC3 be verified against the **real** audio path. A placeholder beep was rejected because it leaves TTS packaging + RAM unproven until Phase 16. Streaming spoken briefing/answers + barge-in remain Phase 16.

### Audio capture & transport (carried from STACK.md research — locked; restated so planning does not re-litigate)
- **D-19:** Capture = renderer `getUserMedia` → **AudioWorklet** → **16 kHz mono PCM** (bundle the worklet as an inline Blob URL to dodge Electron CSP/file-protocol issues); stream PCM renderer→main over the **existing typed IPC preload surface** (`src/preload/index.ts`) using transferable `ArrayBuffer` / chunked messages. **No** native recorder binary (`mic`/`node-record-lpcm16` rejected — stale, bundle external `sox`/`arecord`); **NOT** `desktopCapturer` for mic (Windows renderer-crash bugs #42765/#46369).
- **D-20:** Device **hot-swap** + 16 kHz **resample** handled renderer-side in the AudioWorklet; **permission-denied** surfaced as an actionable error (ToastHost + HUD error state) per SC5.

### Claude's Discretion
- Sidecar stdio framing protocol (length-prefixed PCM vs JSON lines) and exact `whisper.cpp` binary procurement (ship `ggml-org/whisper.cpp` release binaries vs build in CI).
- Exact resumable-download library and the precise migration number for the voice model-readiness pref (≥ 136).
- AudioWorklet bundling specifics and VAD threshold values (within the D-11 roles).
- Whether `VoiceHUDBand` uses a `grid-template-rows: 0fr/1fr` or `max-height` expansion (both are acceptable; pick per reduced-motion fit).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/ROADMAP.md` § Phase 15 — goal, 5 success criteria, and the flagged Phase-15 uncertainties (sidecar-vs-addon empirical build, Chromium AEC no-op #47043, RAM ceiling, Kokoro WASM vs WebGPU).
- `.planning/REQUIREMENTS.md` — VOICE-01, VOICE-04, VOICE-07 (this phase's requirements); VOICE-10 (Phase 14, complete — the contract this phase does NOT yet exercise).

### v2.0 audio runtime research corpus (MUST read — runtime/glue stack)
- `.planning/research/STACK.md` — **authoritative on the locked audio stack**: renderer `getUserMedia`→AudioWorklet→16 kHz PCM capture, Silero VAD (`@ricky0123/vad-web`), whisper.cpp + Whisper large-v3-turbo, `kokoro-js` TTS, typed-IPC transport (avoid localhost socket), `electron-rebuild`/asarUnpack/`extraResources` packaging, the rejected-alternatives table, and the `smart-whisper` maintenance-risk note.
- `.planning/research/PITFALLS.md` — Electron AEC unreliability (#47043 → half-duplex), native-ABI discipline, `desktopCapturer` mic crashes.
- `.planning/research/ARCHITECTURE.md`, `.planning/research/SUMMARY.md`, `.planning/research/FEATURES.md` — milestone architecture, model research (large-v3-turbo / Kokoro-82M / Chatterbox), feature framing.

### Phase 14 safety contract (NOT exercised this phase — but the seam exists)
- `.planning/phases/14-voice-safety-confirm-contract/14-CONTEXT.md` — the voice-to-approval contract; `approval_path='voice-explicit'`, the `voice-forbidden-forced` gate, the dormant `voiceConfirm()` seam.
- `src/main/voice/confirm.ts` — the dormant `voiceConfirm(db, approvalId)` seam. **Phase 15 does NOT call or modify it** (voice-driven writes are Phase 17). The `tests/static/voice-routes-through-staging.spec.ts` ratchet still applies to anything added under `src/main/voice/**`.

### Packaging & native-resource pattern (mirror for binary + model resolution)
- `package.json` — `asarUnpack` (~L117) and `extraResources` (~L173) blocks; `rebuild:native:electron` script (~L33); electron-builder `mac`/`win`/`linux` targets + signing config.
- `electron.vite.config.ts` — main/preload/renderer build orchestration (preload at `src/preload/index.ts`).
- `src/main/index.ts`, `src/main/tray/icons.ts` — the `resolveBrandIcon` / `resourcesPath` resolution pattern to mirror for the sidecar binary and the downloaded model.

### UI integration points
- `src/renderer/app/App.tsx` — the shell slot for `VoiceHUDBand` (mirror the `TrialBanner` placement, in-flow below Topbar).
- `src/renderer/components/Topbar.tsx` — host for the persistent mic `StatusDot`.
- `src/renderer/components/editorial/StatusDot.tsx` — the state color vocabulary (no new tokens).
- `src/renderer/features/onboarding/OnboardingWizard.tsx` — host for the skippable "Set up voice" step.
- `src/renderer/features/entitlement/TrialBanner.tsx` — structural-slot + disabled-gate precedent for the "voice unavailable until ready" state.

### IPC / DB
- `src/preload/index.ts` — the typed IPC surface to extend for PCM frames (renderer→main), transcript + voice-state events (main→renderer).
- `src/main/db/migrations/` — latest is `135_repair_approval_child_fks.sql`; the voice model-readiness pref migration is **≥ 136**.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `resolveBrandIcon` / `resourcesPath` pattern (`src/main/index.ts`, `src/main/tray/icons.ts`) — the exact precedent for resolving a packaged native resource; reuse for both the sidecar binary (D-02) and the downloaded model (D-06).
- `powerMonitor` (already wired for cron/tray) — pause downloads and manage sidecar lifecycle on sleep/wake (D-03/D-09).
- `StatusDot` editorial component — encodes all mic states with no new tokens (D-14).
- `TrialBanner` shell slot + entitlement disabled-gate — structural and interaction precedent for the HUD band and the "voice unavailable" affordance (D-08/D-15).
- `ToastHost` — transient error surface for permission-denied / device-lost (D-16/D-20).
- The `tests/static/*` ratchet family + `voice-routes-through-staging.spec.ts` — anything under `src/main/voice/**` is fenced; keep audio runtime code clear of the write-path chokepoints.

### Established Patterns
- **esbuild skips tsc** — build-time guards must be vitest tests, not type-only; run `npm run typecheck` after main/preload edits (project memory).
- **Native blobs via asarUnpack/extraResources** — better-sqlite3 + sqlite-vec already do this; the sidecar binary + model follow the same discipline.
- **Typed IPC over the preload bridge** — no new localhost socket; transferable ArrayBuffers for PCM (D-19).
- **Migration chain + `embedded.ts` snapshot** — any new `user_prefs` column must update both the live migration and the embedded snapshot (Phase 14 D-03 split-brain lesson).

### Integration Points
- Renderer AudioWorklet → preload IPC → main sidecar manager → stdio → whisper.cpp binary → transcript IPC → renderer HUD.
- Onboarding wizard step / lazy modal → main download manager → HF CDN (Range) → `resourcesPath`/`userData` → model-readiness pref → PTT gate.
- Kokoro TTS (renderer or main per STACK.md) → playback → half-duplex `micGated` signal → capture path.

</code_context>

<specifics>
## Specific Ideas

- Treat **"no `NODE_MODULE_VERSION` crash" as a design constraint, not a test** — the sidecar choice (D-01) is specifically to make that crash *impossible*, given Aria's documented native-ABI pain (better-sqlite3 ABI mismatches, the ELECTRON_RUN_AS_NODE launch crash).
- SC3 must be verified on **laptop speakers** (real acoustic echo), which is *why* a real Kokoro playback path (D-18), not a beep, is built this phase.
- The mic-state surface is the **primary visible deliverable** of this phase — hold it to Aria's editorial bar (calm, ivory/ink/gold, Plex Mono), explicitly NOT a flashy consumer-assistant orb.
- The phase doubles as the **RAM-ceiling proof** for STT+TTS+LLM concurrency on 16 GB no-GPU — keep that measurement an explicit success check.

</specifics>

<deferred>
## Deferred Ideas

- **Streaming STT→LLM→TTS cascade, barge-in, spoken briefing/answer playback** — Phase 16 (VOICE-02/03/06). The `speaking` state and the real Kokoro path built here are the seams it plugs into.
- **Voice-driven writes, read-back of resolved entities, dual-channel confirm UX, cloud opt-in STT/TTS + consent disclosure, voice settings** — Phase 17 (exercises the dormant `voiceConfirm()` seam).
- **Always-listening wake-word + global/tray-backgrounded activation** (`uiohook-napi` or `globalShortcut` toggle; Picovoice-vs-openWakeWord licensing decision) — Phase 18.
- **q8_0 / f16 model opt-ins** — surface after under-load benchmarking confirms headroom.
- **Chatterbox-Turbo-ONNX as a selectable alternate voice** (MIT, paralinguistic tags, voice cloning) — later; Kokoro is the default.

</deferred>

---

*Phase: 15-audio-i-o-model-runtime*
*Context gathered: 2026-06-03*
