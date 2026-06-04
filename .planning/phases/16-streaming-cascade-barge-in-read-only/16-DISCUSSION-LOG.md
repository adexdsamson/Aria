# Phase 16: Streaming Cascade + Barge-in (read-only) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-04
**Phase:** 16-streaming-cascade-barge-in-read-only
**Areas discussed:** Barge-in & cancellation, Streaming TTS chunking, Spoken surfaces & controls, Multi-turn context
**Mode:** advisor (full_maturity tier; technical framing — NON_TECHNICAL_OWNER resolved false per senior-dev profile). Each area researched by a parallel gsd-advisor-researcher before selection.

---

## Barge-in detection

| Option | Description | Selected |
|--------|-------------|----------|
| PTT-to-interrupt | Re-press PTT/Space while speaking fires bargeIn(); no open mic, zero AEC risk; SC5 satisfied by construction | ✓ |
| Always-on VAD during playback | Ambient barge-in; ~5–10% self-trigger false rate (#47043) mitigated by energy + 250ms duration guard; +1.5MB WASM | |
| Hybrid: PTT + opt-in VAD flag | PTT default, power-user VAD flag; Phase-18 groundwork | |

**User's choice:** PTT-to-interrupt
**Notes:** Conservative, zero-AEC-risk path; ambient VAD deferred behind a future flag. Cancellation architecture adopted by recommendation: renderer-first fire-and-forget (audio stop ~3ms + one-way IPC abort of main streamText), spoken-so-far via onChunk accumulator ref (AI SDK #8088). → D-01, D-02, D-03.

---

## Streaming TTS chunking

| Option | Description | Selected |
|--------|-------------|----------|
| Hybrid first-chunk-then-sentence | ~6–10 word first fragment immediately, then full sentences (abbrev-aware deny-list); targets first-audio <900ms | ✓ |
| Pure sentence-split | Simplest, best prosody; first-audio breaches 900ms on long opening sentences | |
| Clause-level split | Lowest latency; choppy on enumerations | |

**User's choice:** Hybrid first-chunk-then-sentence
**Notes:** Telemetry adopted by recommendation: new `voice_latency_log` SQLite table (4 stages) + `DIAGNOSTICS_VOICE_LATENCY` channel, debug-gated. Kokoro playback queue = in-order promise chain; main→renderer chunk push channel. → D-04, D-05, D-06.

---

## Spoken surfaces & controls (speed mechanism)

| Option | Description | Selected |
|--------|-------------|----------|
| Kokoro generate({speed}) re-synth | Pitch-neutral by model design, no dep; re-synth latency on change (fine at section boundaries) | ✓ |
| AudioBufferSourceNode.playbackRate | 1-liner but pitch-shifts; only ok ~0.8–1.4x (violates 0.5–2x) | |
| SoundTouch phase-vocoder worklet | Pitch-preserving + real-time scrub; new dep + AudioWorklet wiring | |

**User's choice:** Kokoro generate({speed}) re-synth
**Notes:** Scope settled by SCs (briefing + /ask both speak) → shared read-aloud queue; pause = AudioContext.suspend/resume; skip-section keyed to BriefingPayload keys (calendar/email/news). → D-07, D-08, D-09, D-10.

---

## Multi-turn context

| Option | Description | Selected |
|--------|-------------|----------|
| In-memory session buffer + existing thread | Reuse rag_thread/rag_turn (lastN:6, <thread_history> PII-safe); barge-in writes synthetic [interrupted] turn; implicit coref | ✓ |
| Explicit coreference rewrite | Better retrieval recall on demonstratives; +0.5–2s round-trip + hallucination risk | |
| priorContext field on RagAskRequest | Caller-owned ephemeral window; touches shared IPC contract | |

**User's choice:** In-memory session buffer + existing thread
**Notes:** Researcher discovered the RAG thread machinery is already live — multi-turn is reuse, not new infra. Explicit coref rewrite deferred to a targeted fix only if SC4 regression shows retrieval misses. → D-11, D-12.

---

## Claude's Discretion

- First-fragment word count (~6–10), abbreviation deny-list completeness, queue buffer sizing, `voice_latency_log` column types, HUD transport-control layout (editorial design system).

## Deferred Ideas

- Always-on ambient VAD barge-in → future pref flag / Phase 18 wake-word groundwork.
- Explicit coreference rewrite step → targeted fix if SC4 regression appears.
- SoundTouch phase-vocoder real-time speed scrubbing → if mid-playback scrubbing becomes a requirement.
- Mini-STT keyword backchannel check → Phase 18 (needs streaming STT).
- Cloud STT/TTS opt-in + voice settings → Phase 17 (VOICE-05/08).
- GPU whisper / voice-priority p-queue / idle-unload / captions → Phase 19.
