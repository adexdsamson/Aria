# Phase 18: Opt-in Wake-Word + Privacy Isolation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-10
**Phase:** 18-opt-in-wake-word-privacy-isolation
**Mode:** advisor (full_maturity vendor calibration; technical framing — owner is a senior dev, NON_TECHNICAL_OWNER resolved false)
**Areas discussed:** Wake-word engine + licensing, Detector process isolation, Mic ownership + ring buffer, Consent disclosure + indicator

> **Setup note:** Command was invoked as `/gsd-discuss-phase --ws voice`, but the `voice` workstream was empty (no ROADMAP, 0 phases — `/gsd-new-milestone --ws voice` had not been run). The v2.0 voice phases (14–19) live in the **main** roadmap. User chose to **discuss Phase 18 against the main roadmap** (active-workstream pointer cleared; `voice` workstream preserved for later). Phase selected: **18**.

---

## Wake-word engine + licensing (VOICE-12 gate)

| Option | Description | Selected |
|--------|-------------|----------|
| Porcupine WASM + pluggable adapter | Commercial-cleared (free ≤3 MAU, paid above), zero native-ABI risk, custom "Hey Aria" .ppn; adapter makes MAU/cost a one-line swap. Caveat: AccessKey phones home (no audio leaves). | ✓ |
| openWakeWord (train custom model) | Fully offline, no phone-home, but pretrained models non-commercial → train own model (ML effort) + onnxruntime-node (native ABI) or Python sidecar. | |
| Porcupine Node (native binding) | Same engine but a `.node` addon → NODE_MODULE_VERSION ABI risk Aria avoids. | |
| Ship-disabled / defer engine | Scaffolding only, no live detection at GA. | |

**User's choice:** Porcupine WASM + pluggable adapter.
**Notes:** Research showed Porcupine is the only mature commercial-cleared custom-keyword engine; openWakeWord's CC-BY-NC-SA pretrained models are a hard blocker for a paid app; microWakeWord targets ESP32. WASM binding chosen over Node binding specifically to avoid the native-ABI class Aria already avoids with whisper.cpp-as-CLI. → D-01/D-02/D-03.

---

## Detector process isolation

| Option | Description | Selected |
|--------|-------------|----------|
| Hidden/offscreen BrowserWindow | Reuses proven getUserMedia→AudioWorklet→16kHz PCM chain, ABI-safe, WASM first-class; prove-cold via track.stop()→destroy()→await + assertion test; locked down. | ✓ |
| Native helper binary (Rust/Go + cpal) | Strongest kill/privacy guarantee, ABI-safe; cost: per-platform build matrix + 2nd notarized/mic-entitled binary + non-WASM engine. | |
| utilityProcess + native capture dep | Idiomatic sidecar lifecycle (kill-PID = mic cold); no Web Audio in Node → needs native capture binding + non-WASM engine. | |

**User's choice:** Hidden/offscreen BrowserWindow.
**Notes:** Hard physics — Electron's mic path is renderer-only; Node-context isolation needs a native capture lib (ABI risk). Hidden window pairs with the Porcupine-WASM choice and reuses the proven capture chain. Accepted trade-off: the "provably cold" SC is weakest here → mitigated by the explicit teardown handshake (D-05) + indicator-clears test. Native-helper-binary noted as the fallback if the handshake proves fragile in UAT. → D-04/D-05/D-06.

---

## Mic ownership + pre-trigger ring buffer + half-duplex

| Option | Description | Selected |
|--------|-------------|----------|
| A1 + B2 + C1 (recommended stack) | Detector owns its own stream, hands off to existing PTT on trigger; ~3s lead-in buffer (~192KB, zeroed on trigger, bridges STT warm-up); hard-suppress during TTS + 800ms cooldown; static-grep ratchet bans fs writes. | ✓ |
| A3 variant — detector feeds STT directly | No 2nd mic open / no warm-up gap, but weakens the trigger-only isolation boundary. | |
| B1 ring buffer (wake-word window only) | ~1.5s/~96KB, smallest footprint, but user must pause after "Hey Aria". | |

**User's choice:** A1 + B2 + C1.
**Notes:** A1 is the only ownership model that makes the "separate mic-isolated, trigger-only" SC true by construction while leaving the shipped PTT path untouched. B2's ~3s lead-in doubles as the warm-up bridge AND delivers the natural one-breath UX. C1 reuses the accepted half-duplex contract (no AEC, #47043). "Never persisted" enforced structurally (RAM-only, zeroed, fs-write ratchet). → D-07/D-08/D-09/D-10.

---

## Consent disclosure + mic-active indicator + permission timing

| Option | Description | Selected |
|--------|-------------|----------|
| Extend Phase-17 + armed dot + tray | Data-handling disclosure modal → new wakeWord.consented KV + audit row, OFF-by-default toggle in VoiceSection; steady gold "armed" StatusDot + Tray swap (survives backgrounding); lazy permission on first toggle-on, denied → deep-link to OS pane. | ✓ |
| Minimal toggle + tooltip | Lighter, but under-discloses an always-on local mic (inverts risk hierarchy vs the cloud toggle). | |
| Multi-step per-fact acknowledgment | Highest trust ceiling but disproportionate for a local-only, no-egress feature; tonally heavy. | |

**User's choice:** Extend Phase-17 + armed dot + tray.
**Notes:** Always-on local mic warrants disclosure that matches (not undershoots) the existing cloud-audio modal. Indicator works within the real 4-kind StatusDot contract (steady `warn`/gold = armed) + Tray swap because detection runs while backgrounded; OS-native indicators are the redundant layer. Lazy permission fires on first toggle-on, paired with the disclosure as one trust gesture; macOS once-denied-can't-reprompt handled via deep-link. → D-11/D-12/D-13.

---

## Claude's Discretion

Exact ring-buffer length (within ~2.5–3 s) + Float32/Int16 storage; `.ppn` sensitivity threshold; `WakeWordDetector` adapter method signatures; disclosure-modal copy; whether "armed" is a new StatusDot variant or reused steady `warn`; tray asset specifics; new IPC channel names; prefs migration mechanics (settings KV, no `user_prefs`).

## Deferred Ideas

- Frontier voice STREAMING + `StreamingRehydrator` (Phase 17 D-13 mislabeled "Phase 18 first task"; ROADMAP scopes Phase 18 to VOICE-12 only — fold into Phase 19 or own slice).
- Wake-word barge-in during TTS (needs reliable AEC; PTT barge-in covers it).
- Porcupine paid-tier / MAU commercial negotiation (business decision before paid GA; adapter makes engine swap a config change).
- Porcupine Node native binding (ABI-risk fallback if WASM perf inadequate).
- Custom-trained openWakeWord / microWakeWord (fully offline, no phone-home) — only if eliminating the AccessKey network call becomes a hard requirement.
- Native-helper-binary isolation — strongest guarantee; reconsider if hidden-window prove-cold proves fragile.
