# Phase 18: Opt-in Wake-Word + Privacy Isolation - Context

**Gathered:** 2026-06-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver an **opt-in, OFF-by-default "Hey Aria" wake-word** that lets a consenting user start a turn hands-free, with the always-listening detector running in a **privacy-isolated, provably-killable** process that emits **only a boolean trigger** to the app — never sending or persisting raw audio. Pre-trigger audio lives in a **RAM-only ring buffer** that is never written to disk or forwarded; a **visible mic-active indicator** shows whenever the detector is listening; OS mic permission is requested **lazily at first voice use**, not at app launch.

This is the **last** voice phase (v2.0). Push-to-talk (Phase 15) already ships and remains the always-available hands-free path; the wake-word trigger **converges onto the existing PTT turn-start seam** rather than building a parallel capture pipeline.

**Requirement:** VOICE-12 (the only net-new requirement).

**In scope:** wake-word engine integration behind a pluggable adapter; the isolated detector process; the pre-trigger ring buffer; trigger → existing-PTT-capture hand-off; half-duplex suppression of the detector during Aria's TTS; consent + disclosure UX; the armed mic-active indicator (Topbar + tray); lazy OS mic permission + denied-state handling.

**Out of scope (flagged — see Deferred):** the frontier voice **streaming PII rehydrator** that Phase 17's D-13 parked as "Phase 18's first task" — the **ROADMAP scopes Phase 18 strictly to VOICE-12 (wake-word)**, so the rehydrator is treated as stale phase-numbering and deferred. Also out: wake-word barge-in *during* TTS playback; GPU/perf tuning (Phase 19).

</domain>

<decisions>
## Implementation Decisions

### Wake-word engine + commercial licensing (VOICE-12 gate)
- **D-01 (Engine = Picovoice Porcupine, WASM binding):** Use `@picovoice/porcupine-web` (pure WASM), **not** `@picovoice/porcupine-node` (native `.node` addon). Rationale: Porcupine is the only mature engine that is **commercial-cleared with custom-keyword support**; `openWakeWord`'s pretrained models are CC-BY-NC-SA (**non-commercial → hard blocker** for a paid app), and `microWakeWord` targets ESP32 (no desktop Node runtime). The WASM binding carries **zero native-ABI risk** — decisive for Aria, which already runs whisper.cpp as a CLI specifically to avoid `NODE_MODULE_VERSION` crashes and pins Electron 41 for ABI stability.
- **D-02 (Pluggable detector adapter):** Build the detector behind a **`WakeWordDetector` adapter interface** (engine-agnostic: `start/stop/onTrigger(boolean)`). Porcupine-WASM is the first and recommended implementation. This collapses the unresolved **commercial-MAU/cost negotiation** (free tier ≤ 3 MAU; paid tiers are quote-only) into a **one-line adapter swap** rather than a re-architecture, and keeps the door open to a future fully-offline engine.
- **D-03 (Custom "Hey Aria" keyword):** Train the `.ppn` custom keyword in the Picovoice Console and bundle it as a packaged resource (mirror the `resourcesPath`/`extraResources` pattern). **Known privacy caveat to disclose internally:** Porcupine's `AccessKey` **phones home** to validate the license and report MAU usage — **no audio leaves the device**, but it is a network call; document it (it does not violate the "raw audio never leaves" guarantee).

### Detector process isolation (SC2 / SC3)
- **D-04 (Isolation = hidden/offscreen BrowserWindow):** Run the detector in a **`show:false` BrowserWindow** that reuses Aria's **proven `getUserMedia → AudioWorklet → 16 kHz mono PCM`** capture chain and runs the Porcupine **WASM** engine in-context. Rationale: Electron's mic path (Web Audio / `getUserMedia`) exists **only in a renderer** — a `utilityProcess`/`fork` is a bare Node context with no media stack and would require a native capture lib (reintroducing ABI risk) + a non-WASM engine. The hidden window is ABI-safe and WASM-first-class. Lock it down: **no `nodeIntegration`, no network, no DevTools, no navigation.**
- **D-05 (Prove-cold teardown handshake):** The hidden-window option's known weakness is the "**provably terminates → mic goes cold**" SC. Satisfy it with an explicit ordered teardown: `MediaStreamTrack.stop()` on every track → `win.destroy()` → **await the window is gone** → assert no live mic handle. Back it with a **test that asserts the mic-active indicator clears and capture stops** on toggle-off. (Native-helper-binary was considered for a stronger kill guarantee but rejected for this phase: a per-platform build matrix + a 2nd notarized/mic-entitled binary + a non-WASM engine is disproportionate.)
- **D-06 (Boolean-only boundary):** The detector window's IPC surface carries **only**: outbound `wake-detected` (boolean trigger + the flushed lead-in PCM, on trigger only) and inbound `suppress(on/off)`. **No general audio-streaming channel exists**, so "raw audio forwarded pre-trigger" is structurally impossible.

### Mic ownership, ring buffer, half-duplex (A1 + B2 + C1)
- **D-07 (Ownership = A1, detector owns its own stream + hands off):** The detector holds its own mic stream in the hidden window; **on trigger it hands off to the existing PTT capture path** (the renderer opens its own turn capture, converging on the existing `startTurn()` seam). The already-shipped PTT pipeline stays **unmodified**. (A3 — detector feeds STT directly — was rejected: it weakens the trigger-only isolation boundary.)
- **D-08 (Ring buffer = B2, ~3 s lead-in):** Preallocated **fixed-capacity circular buffer (~3 s @ 16 kHz ≈ 192 KB Float32 / ~96 KB if Int16-downcast)** holding wake word **+ utterance lead-in** so the user can say "Hey Aria, what's on my calendar" **without pausing**, and so the buffered lead-in **bridges the STT-stream warm-up gap** on hand-off (no clipped syllables). (B1 wake-word-only was rejected: forces an unnatural pause for negligible memory savings.)
- **D-09 (Half-duplex = C1, suppress during TTS + cooldown):** **Hard-suppress** the detector for the entire duration of Aria's TTS playback **+ the existing ~800 ms cooldown**, reusing the existing `micGated`/`speaking` half-duplex signal. Electron AEC is rejected as unreliable (#47043), so suppression (not echo-cancellation) is the only robust choice; wake-word barge-in during playback is out of scope (PTT barge-in already covers it).
- **D-10 ("Never persisted" enforced structurally):** RAM-only circular buffer, **zeroed (`.fill(0)` + head/tail reset) on trigger and on stop**; the detector module has **no `fs` write path for audio at all**. Add a **static-grep ratchet** banning `fs.*write*` / `writeFile` / `createWriteStream` reachable from the detector module (mirrors Aria's existing ratchet discipline, e.g. `voice-streaming-no-write.spec.ts`, `assertApproved`, `no-bare-cron-schedule`). On `devicechange`, reset the buffer across the swap (stale-device audio must not survive).

### Consent, disclosure, indicator, permission (SC1 / SC3 / SC4)
- **D-11 (Disclosure = extend Phase-17 modal verbatim):** A **data-handling disclosure modal** gates a new **OFF-by-default toggle** in `VoiceSection.tsx`, reusing the exact Phase-17 machinery: new `voice.wakeWord.consented` / `voice.wakeWord.consentedAt` KV keys in `voice/prefs.ts` + an `action_audit_log` row. An always-on **local** mic is a heavier trust ask than the existing cloud-audio toggle, so disclosure must **match (not undershoot)** it. (Minimal tooltip rejected — inverts the risk hierarchy; multi-step per-fact ack rejected — disproportionate for a local-only, no-egress feature.) Disclosure states: captured locally only, in-memory ring buffer never persisted, audio never leaves the device, how to turn it off, OS-permission note.
- **D-12 (Indicator = steady "armed" StatusDot + tray swap):** The real `StatusDot` has **4 kinds (`ok`/`warn`/`err`/`idle`)** — *not* a 6-state vocabulary. Armed/always-listening = a **steady (non-pulsing) gold `warn` dot** in the Topbar (calm, editorial — not a flashy orb; satisfies reduced-motion by being steady). Because detection runs while the window is **backgrounded in the tray**, **also swap the Electron `Tray` icon/title** so the signal is present when the window isn't. OS-native indicators (macOS orange dot / Windows tray mic) serve as a redundant layer. `role="status"` / `aria-label` announces "microphone listening for wake word."
- **D-13 (Lazy permission on first toggle-on):** Request OS mic permission **on first toggle-on** (immediately after the disclosure modal — one continuous trust gesture), via `systemPreferences.getMediaAccessStatus('microphone')` → `askForMediaAccess('microphone')` on macOS (Windows grants implicitly + shows its own tray indicator). **`denied`** → keep the toggle visually **OFF** with an inline hint that **deep-links to the OS privacy pane** (macOS won't re-prompt once denied). macOS TCC subtlety: the hidden BrowserWindow inherits the mic grant from the responsible app process, but the mic entitlement must also be present (`entitlements.mac.inherit.plist`) or the prompt silently no-ops — treat as an explicit packaging task.

### Claude's Discretion
- Exact ring-buffer length within the ~2.5–3 s B2 range and Float32-vs-Int16 storage; the `.ppn` keyword sensitivity threshold; the precise `WakeWordDetector` adapter method signatures; disclosure-modal copy; whether the armed dot is a new `StatusDot` variant or a reused steady `warn`; tray asset specifics; the new IPC channel names; the new prefs migration mechanics (settings KV, no `user_prefs` table — consistent with Phase 15/17).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/ROADMAP.md` § "Phase 18: Opt-in Wake-Word + Privacy Isolation" — goal, 4 success criteria, and the explicit licensing gate (openWakeWord non-commercial; Porcupine free tier 3 MAU).
- `.planning/milestones/v2.0-REQUIREMENTS.md` — **VOICE-12** definition (⚠ lives in the *archived v2.0 milestone* requirements, **not** the current `.planning/REQUIREMENTS.md`, which is now v2.1/WhatsApp scope — the v2.0 milestone is PARKED, see `.planning/MILESTONES.md`).

### Prior voice phases (patterns this phase extends)
- `.planning/phases/15-audio-i-o-model-runtime/15-CONTEXT.md` — sidecar/separate-process pattern (D-01/02/03), `getUserMedia → AudioWorklet → 16 kHz PCM` capture (D-19), `StatusDot` mic-state vocabulary (D-14), half-duplex `micGated` gate (D-13), and **D-12 which explicitly deferred wake-word + global activation to Phase 18**.
- `.planning/phases/17-voice-confirm-writes-through-the-gate/17-CONTEXT.md` — consent pattern (single master toggle + modal disclosure + `action_audit_log` + settings KV, D-14/D-16) and `VoiceSection.tsx`. **D-13 parked the frontier streaming rehydrator as "Phase 18 first task" — see Out of scope / Deferred.**

### Audio runtime research corpus
- `.planning/research/STACK.md` — locked audio stack (capture chain, packaging via `extraResources`/`asarUnpack`, signing).
- `.planning/research/PITFALLS.md` — Electron AEC unreliability (#47043 → half-duplex), native-ABI discipline.
- `.planning/research/ARCHITECTURE.md`, `.planning/research/SUMMARY.md` — milestone architecture.

### Code integration points (verified present)
- `src/main/voice/stt/sidecar-manager.ts` — `utilityProcess` spawn/`SIGTERM`-reap/`dispose()` lifecycle + `resourcesPath` binary resolution (lifecycle idioms to mirror for the detector window).
- `src/renderer/features/voice/` — capture + session hooks: `useVoiceCapture.ts`, `useVoiceSession.ts` (the `micGated`/`speaking`/half-duplex cooldown signal for D-09 and the `startTurn()` convergence seam for D-07). *(Planner: confirm exact capture-file paths — research cited `capture/useMicCapture.ts` + `capture/mic-worklet.ts`.)*
- `src/main/voice/prefs.ts` — settings-KV; add `voice.wakeWord.consented` / `consentedAt` (mirror the Phase-17 `cloudAudio.*` pair).
- `src/renderer/features/settings/VoiceSection.tsx` — host the OFF-by-default toggle + reuse the disclosure modal.
- `src/renderer/components/editorial/StatusDot.tsx` — **4-kind** contract (`ok`/`warn`/`err`/`idle`); armed = steady `warn`/gold (D-12).
- `src/main/tray/` (e.g. `icons.ts`) — Tray icon/title swap for the backgrounded armed indicator (D-12).
- `src/shared/ipc-contract.ts` + `src/shared/voice-types.ts` — new channels: `wake-detected` (boolean + lead-in), detector `suppress`, `VOICE_GET/SET` wake-word prefs (mirror the `BG_GET/SET_PREFS` + Phase-17 voice-prefs pattern; honor the handler-count invariant in `tests/unit/main/ipc/index.spec.ts`).
- `tests/static/` — ratchet family; **add a no-disk-write ratchet** for the detector module (D-10); `voice-streaming-no-write.spec.ts` is the precedent.
- `package.json` (`extraResources`/`asarUnpack`, mac/win signing, `entitlements.mac.inherit.plist`) + `electron.vite.config.ts` — add `@picovoice/porcupine-web` (WASM, **no native build**), bundle the `.ppn`, wire the hidden-window build.
- `action_audit_log` — consent audit row (D-11).

### External (research-sourced)
- Picovoice: [pricing](https://picovoice.ai/pricing/), [free tier — commercial OK, ≤3 MAU](https://picovoice.ai/blog/introducing-picovoices-free-tier/), [`@picovoice/porcupine-web` (WASM)](https://www.npmjs.com/package/@picovoice/porcupine-web), [AccessKey phone-home for billing](https://picovoice.ai/docs/faq/general/).
- Electron: [`systemPreferences` `askForMediaAccess`/`getMediaAccessStatus`](https://www.electronjs.org/docs/latest/api/system-preferences); macOS TCC inheritance + `entitlements.mac.inherit.plist` (child/utility procs inherit the responsible parent's grant).
- [openWakeWord model card — CC-BY-NC-SA (non-commercial)](https://huggingface.co/davidscripka/openwakeword) — why it's a blocker for a paid app.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Renderer capture chain** (`getUserMedia → AudioWorklet → 16 kHz mono PCM`) — runs verbatim inside the hidden detector window (D-04); zero new native deps.
- **`micGated`/`speaking` half-duplex signal** (Phase 15/16) — subscribe the detector to it for C1 suppression (D-09).
- **`startTurn()` PTT seam** (`useVoiceSession.ts`) — the trigger converges here (D-07); existing PTT path untouched.
- **Phase-17 consent machinery** — disclosure modal + consent KV + `action_audit_log` row, reused verbatim for wake-word (D-11).
- **`StatusDot` (4-kind)** + **Electron `Tray`** (close-to-tray/auto-launch already ship) — armed indicator surfaces (D-12).
- **`sidecar-manager.ts`** lifecycle/reaping/`resourcesPath` idioms — mirror for the detector window's create/destroy + `.ppn`/WASM resource resolution.
- **Static-grep ratchet family** (`tests/static/`) — add the detector no-disk-write ratchet (D-10).

### Established Patterns
- **Native-ABI aversion** → WASM engine + renderer capture, no `.node` addon (drives D-01/D-04).
- **esbuild skips `tsc`** → build-time guards must be vitest tests; run `npm run typecheck` after main/preload edits.
- **Settings KV, no `user_prefs` table** → new prefs go through `voice/prefs.ts` (D-11).
- **Typed IPC over the preload bridge**; handler-count invariant test must be updated for new channels.
- **Native blobs via `asarUnpack`/`extraResources`** + per-platform signing/notarization (the `.ppn` + WASM follow this).

### Integration Points
- Hidden detector window: `getUserMedia → AudioWorklet → 16 kHz PCM → ring buffer → Porcupine-WASM → boolean` → IPC `wake-detected` (+ lead-in) → main → renderer `startTurn()`.
- Settings: `VoiceSection` toggle → disclosure modal → `askForMediaAccess` → consent KV + audit row → arm detector window.
- Half-duplex: `speaking`/`micGated` → IPC `suppress(true)` to detector window during TTS + 800 ms cooldown.
- Indicator: detector armed-state → Topbar `StatusDot` (steady `warn`) + `Tray` icon/title swap.

</code_context>

<specifics>
## Specific Ideas

- The "**provably cold mic**" SC is the riskiest part of the chosen (hidden-window) isolation — treat the `track.stop()` → `destroy()` → await-gone handshake and its assertion test as a **first-class deliverable**, not an afterthought (D-05).
- "**Never persisted**" must be **structural, not disciplinary**: RAM-only buffer zeroed on trigger/stop + a static-grep `fs`-write ban reachable from the detector (D-10).
- The mic indicator is the **primary visible trust signal** — keep it to Aria's calm editorial bar (steady gold, IBM Plex Mono), explicitly NOT a flashy consumer-assistant orb (D-12).
- The pluggable adapter (D-02) is the hedge against the unresolved commercial-MAU cost: ship complete on Porcupine-WASM, swap later if the license/cost math changes.

</specifics>

<deferred>
## Deferred Ideas

- **Frontier voice STREAMING + `StreamingRehydrator`** (token-boundary-safe streaming PII rehydration) — Phase 17 D-13 parked this as "Phase 18's first task," but the ROADMAP scopes Phase 18 to VOICE-12 only. **Flag for roadmap:** fold into Phase 19 (perf/polish) or its own slice. Out of scope here.
- **Wake-word barge-in during TTS playback** — needs reliable AEC (rejected, #47043); PTT barge-in already covers the interaction. Revisit only with a working echo path.
- **Porcupine paid-tier / MAU commercial negotiation** — a business decision owed before paid GA (free tier caps at 3 MAU; paid is quote-only). The D-02 adapter makes the engine swap a config change, not a rebuild.
- **Porcupine Node native binding** — fallback only if WASM perf in the hidden window proves inadequate (reintroduces ABI risk).
- **Custom-trained openWakeWord / microWakeWord (fully offline, no phone-home)** — revisit only if eliminating the Porcupine AccessKey network call becomes a hard requirement; requires owning a model-training pipeline + a non-`.node` runtime.
- **Native-helper-binary isolation (Rust/Go + cpal)** — the strongest kill/privacy guarantee; reconsider if the hidden-window prove-cold handshake proves fragile in UAT.

</deferred>

---

*Phase: 18-opt-in-wake-word-privacy-isolation*
*Context gathered: 2026-06-10*
