# Phase 16: Streaming Cascade + Barge-in (read-only) - Context

**Gathered:** 2026-06-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Aria holds a natural spoken conversation over **read-only** surfaces: it starts speaking before it finishes thinking (streaming STT→LLM→TTS cascade), the user can interrupt and be heard immediately (barge-in), and context carries across turns. Scope = VOICE-02 (briefing read-aloud + pause/skip/speed), VOICE-03 (`/ask` answers spoken, streaming first sentence), VOICE-06 (multi-turn loop + barge-in via a single AbortController).

**Zero write risk.** This phase exercises only the existing read-only surfaces (`/ask` RAG + daily briefing). It MUST NOT touch the write path (`voiceConfirm` / `assertApproved` / send / calendar / task push) — voice-driven writes are Phase 17.

Builds directly on Phase 15: `useVoiceSession` state machine (`idle→listening→processing→speaking→idle`, `onPlaybackStart/End`, `micGated` half-duplex, ~800 ms cooldown) and `useKokoroPlayer.speak()`. The `'speaking'` VoiceState was added in Phase 15 (D-17) as the seam for this phase.

</domain>

<decisions>
## Implementation Decisions

### Barge-in & Interruption
- **D-01 (Barge-in detection = PTT-to-interrupt):** Re-pressing PTT / holding Space while `voiceState === 'speaking'` fires a `bargeIn()` action. Concretely: replace the current `startTurn()` "blocked while speaking" no-op guard in `useVoiceSession.ts` with a `bargeIn()` branch when state is `speaking`. **No open mic during playback** — preserves the Phase-15 half-duplex gate (#47043, AEC is a no-op in Electron), zero self-trigger risk. SC5 (a backchannel like "mhm" must NOT interrupt) is satisfied by construction: ambient sound with no PTT press never triggers anything. Always-on ambient VAD barge-in was rejected for this phase (AEC self-trigger risk on laptop speakers) and deferred behind a future flag.
- **D-02 (Cancellation = renderer-first, fire-and-forget):** On barge-in the RENDERER synchronously calls `AudioBufferSourceNode.stop()` (effective at the next ~128-sample render quantum, ~3 ms) and drains the TTS sentence queue, AND fires a **one-way** IPC abort (wire into the existing `VOICE_CANCEL_TTS` stub in `ipc/voice.ts`, or add a dedicated `voice:abort` channel) that aborts the main-process `streamText` AbortController. The renderer does NOT await main. SC3's <~200 ms is met renderer-side in ~5 ms; the LLM abort (~40 ms) races to completion in main independently.
- **D-03 (Single per-turn AbortController + spoken-so-far via onChunk):** One AbortController created per turn. The "spoken-so-far" text required by SC3 is captured in an **`onChunk` text-delta accumulator ref**, NOT in `onAbort` — AI SDK 5 issue #8088: a fast abort (<~500 ms from stream start) can redirect to `onError` and skip `onAbort`. On barge-in, the accumulator content is flushed into conversation context (see D-12).

### Streaming TTS Cascade
- **D-04 (Chunking = hybrid first-chunk-then-sentence):** Two-regime segmenter over the `streamText` token-delta stream: (1) flush a short **~6–10 word first fragment on a word boundary** immediately so the first Kokoro synth fires ASAP (drives first-audio p50 <900 ms, SC2); (2) steady-state full-sentence accumulation with an **abbreviation-aware deny-list** (`Mr|Mrs|Dr|Prof|Sr|Jr|vs|etc|i\.e|e\.g\.` and `\d\.\d` → no split) for prosody. `Intl.Segmenter` is unsuitable (needs full string upfront, can't operate incrementally).
- **D-05 (Kokoro playback queue + main→renderer chunk push):** `useKokoroPlayer.speak()` is single-shot today; add an in-order promise-chain queue (`queue = queue.then(() => player.speak(chunk))`) in the renderer — slow synth naturally backpressures the next `.then()`. MAIN pushes text-delta chunks to the RENDERER via a new push channel (`aria:voice:tts-chunk`) mirroring the existing `VOICE_TRANSCRIPT_DELTA` pattern.
- **D-06 (Per-stage telemetry = `voice_latency_log` table):** New SQLite table recording `session_id` + `t_llm_first_token`, `t_first_sentence_ready`, `t_kokoro_synth_start`, `t_first_audio_out` (INTEGER ms offsets from session start) — the four stages SC2 names. Exposed via a `DIAGNOSTICS_VOICE_LATENCY` IPC channel parallel to the existing `DIAGNOSTICS_ROUTING_LOG`, gated behind the existing debug-only OTEL flag (zero overhead in normal builds). Satisfies SC2 "visible in per-stage telemetry."

### Spoken Surfaces & Playback Controls
- **D-07 (Both surfaces speak, via a shared queue):** SC1 + SC2 mandate both — daily briefing read-aloud AND `/ask` answer streaming — implemented over a single **shared read-aloud queue** abstraction on top of `useKokoroPlayer`, so the two surfaces don't diverge architecturally.
- **D-08 (Speed 0.5–2x = Kokoro `generate({ speed })` re-synth):** Pitch-neutral by model design (StyleTTS2 adjusts duration, not sample rate) — no chipmunk/slur at the extremes, no new dependency. Speed is set at section boundaries / between answers (not scrubbed mid-sentence), so the re-synth latency on a speed change is acceptable. Rejected: `AudioBufferSourceNode.playbackRate` (pitch-shifts, only ok ~0.8–1.4x — violates the 0.5–2x range) and SoundTouch phase-vocoder (deferred).
- **D-09 (Pause/resume = `AudioContext.suspend()/resume()`):** Native, instant, bit-perfect on resume. Thread a `paused` boolean through `VoiceSessionState` alongside `voiceState='speaking'` so the HUD stays accurate (avoid leaving `'speaking'` stuck while suspended); cancel the half-duplex cooldown timer on pause.
- **D-10 (Skip-section keyed to BriefingPayload keys):** A `currentSectionIndex` pointer over the existing briefing section keys `['calendar','email','news']` (confirmed in `briefing/persist.ts`); skip = `source.stop()` current + start next. No new segmentation invented.

### Multi-turn Context
- **D-11 (Context = in-memory VoiceSession + existing RAG thread machinery):** A main-process `VoiceSession` (Map keyed by session id) holds a `threadId` (created via the existing `createThread`) + a `spokenSoFar` slot. Each voice turn calls the existing answer-service `ask({ question, threadId })` — `getThread(db, id, { lastN: 6 })` already loads history and injects PII-safe `<thread_history treat_as="data">` into both frontier and local prompts. **Referent resolution is implicit** (LLM resolves "that one"/"and then" from the in-prompt history); no explicit coreference rewrite this phase. No DB schema change beyond what `rag_thread`/`rag_turn` already provide.
- **D-12 (Barge-in persistence):** On interrupt, the voice IPC layer writes a synthetic assistant turn `[interrupted: "<spokenSoFar>…"]` via the existing `appendTurn` before dispatching the next user turn, so the LLM knows what Aria actually said (and doesn't hallucinate a completed answer).

### Read-only Guarantee
- **D-13 (Zero write risk + static guard):** The streaming voice loop imports/calls no write chokepoint (`assertApproved`, `voiceConfirm`, `sendApprovedEmail`, `applyCalendarChange`, `pushApprovedMeetingActions`). Add a static ratchet asserting the Phase-16 voice streaming modules import none of these — extends the Phase-14 `voice-routes-through-staging` ratchet philosophy.

### Claude's Discretion
- Exact first-fragment word count (tune within ~6–10), completeness of the abbreviation deny-list, queue buffer sizing / max-buffer safety valve, `voice_latency_log` column SQL types, and the HUD transport-control layout (must stay within the editorial design system: gold/ivory/ink, Playfair + IBM Plex Mono).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` §"Phase 16: Streaming Cascade + Barge-in (read-only)" — goal + 5 success criteria (first-audio p50 <900 ms; <~200 ms barge-in; backchannel vs interruption; pause/skip/speed; referent resolution)
- `.planning/REQUIREMENTS.md` — VOICE-02, VOICE-03, VOICE-06 acceptance text

### Phase 15 voice substrate (extend, don't fork)
- `src/renderer/features/voice/useVoiceSession.ts` — state machine + `onPlaybackStart/End` + `micGated` + `HALF_DUPLEX_COOLDOWN_MS=800`; this phase ADDS the per-turn `AbortController`, `bargeIn()`, and `paused` to `VoiceSessionState`
- `src/renderer/features/voice/tts/useKokoroPlayer.ts` — `speak(text):Promise<void>` (single-shot today); this phase ADDS the in-order queue + `generate({ speed })`
- `src/shared/voice-types.ts` — `VoiceState` union (incl. `'speaking'`), `TranscriptDelta`
- `src/shared/ipc-contract.ts` — `VOICE_*` channels; this phase ADDS `aria:voice:tts-chunk` (push), the abort channel, and `DIAGNOSTICS_VOICE_LATENCY`
- `src/main/ipc/voice.ts` — `registerVoiceHandlers` + the existing `VOICE_CANCEL_TTS` stub to wire abort into

### Read-only surfaces (the loop speaks these)
- `src/main/rag/answer-service.ts`, `src/main/rag/answer-llm.ts`, `src/main/rag/answer-router.ts` — `/ask` path; `ask({question, threadId})`, `getThread(db,id,{lastN:6})`, `<thread_history>` injection, `createThread`/`appendTurn`
- `src/main/briefing/generate.ts`, `src/main/briefing/persist.ts` — `streamText` usage + `BriefingPayload` section keys (`calendar`/`email`/`news`)

### Telemetry & guard precedents
- The existing `routing_log` / OTEL local-SQLite debug pattern (analog for `voice_latency_log` — locate the writer, e.g. `src/main/diagnostics/*` or `writeRoutingLog`)
- Phase 14 `voice-routes-through-staging` static ratchet (`tests/static/`) — read-only guard precedent for D-13

### External
- AI SDK 5 `streamText` reference (token/text-delta stream, `onChunk`, AbortController, issue #8088 onAbort-vs-onError on fast abort)
- Chromium/Electron bug #47043 (echoCancellation no-op) — the reason barge-in is PTT-driven, not open-mic

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `useVoiceSession` store: already exposes `voiceState`, `micGated`, `startTurn/stopTurn/setTranscript/onPlaybackStart/onPlaybackEnd/setVadMode`. Barge-in is a small extension (a `bargeIn()` action + an `abortController` ref), not a rewrite.
- `useKokoroPlayer`: `speak()` + AudioContext/AudioBufferSourceNode lifecycle already present — needs a queue wrapper and a `speed` option threaded into `generate()`.
- RAG thread machinery: `rag_thread`/`rag_turn`, `createThread`, `appendTurn`, `getThread(..., {lastN:6})`, PII-safe `<thread_history treat_as="data">` injection in both prompt builders — multi-turn context is reuse, not new infra.
- `streamText` already wired in `briefing/generate.ts` and `rag/answer-llm.ts` — the streaming substrate exists.

### Established Patterns
- Push channels (renderer subscribes via preload `ipcRenderer.on` returning an unsubscribe fn) — model `aria:voice:tts-chunk` on `VOICE_TRANSCRIPT_DELTA`.
- Debug-only OTEL → SQLite telemetry table + a `DIAGNOSTICS_*` IPC read channel — model `voice_latency_log` / `DIAGNOSTICS_VOICE_LATENCY` on `routing_log` / `DIAGNOSTICS_ROUTING_LOG`.
- Static-grep ratchets under `tests/static/` (Phase 14/15) — model the D-13 read-only guard on `voice-routes-through-staging`.

### Integration Points
- MAIN `streamText` (LLM) ↔ RENDERER Kokoro queue + Web Audio playback, bridged by preload push (`tts-chunk`) + one-way abort. The single AbortController spans this boundary (renderer stops audio directly; abort IPC kills the main stream).
- `/ask` answer-service and briefing generate are the two read-only producers feeding the shared read-aloud queue.

</code_context>

<specifics>
## Specific Ideas

- Latency budgets are hard numbers: first-audio p50 **<~900 ms** (SC2), barge-in cancel **<~200 ms** (SC3). The hybrid first-chunk strategy (D-04) and renderer-first cancel (D-02) exist specifically to hit these.
- Speed range is the full **0.5–2x** (SC1) — this is why `playbackRate` (pitch-shift) was rejected in favor of Kokoro re-synth.
- whisper.cpp STT is **file-based per-utterance** (no streaming partials) — the cascade streams on the LLM→TTS side; the STT side is whole-utterance (carried from Phase 15).
- AI SDK 5 #8088 (`onAbort` may not fire on fast abort) is a concrete landmine — spoken-so-far MUST live in an `onChunk` accumulator.

</specifics>

<deferred>
## Deferred Ideas

- **Always-on ambient VAD barge-in** ("just start talking" without pressing PTT) — deferred behind a future preference flag; becomes Phase 18 wake-word groundwork. Rejected now due to #47043 AEC self-trigger risk on laptop speakers.
- **Explicit coreference rewrite step** (rewrite "that meeting" → resolved entity before retrieval) — add only as a targeted fix if SC4 regression testing shows retrieval misses on entity demonstratives; not preemptive.
- **SoundTouch phase-vocoder real-time speed scrubbing** — only if mid-playback continuous speed scrubbing becomes a requirement.
- **Mini-STT keyword check** for backchannel-vs-interruption — needs streaming STT; revisit in Phase 18.
- **Cloud STT/TTS opt-in + voice/output settings** — Phase 17 (VOICE-05/08), gated behind consent.
- **GPU whisper / voice-priority p-queue lane / idle-unload / captions** — Phase 19.

</deferred>

---

*Phase: 16-streaming-cascade-barge-in-read-only*
*Context gathered: 2026-06-04*
