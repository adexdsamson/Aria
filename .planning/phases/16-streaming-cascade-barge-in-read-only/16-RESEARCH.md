# Phase 16: Streaming Cascade + Barge-in (read-only) - Research

**Researched:** 2026-06-07
**Domain:** Streaming LLM→TTS pipeline, barge-in interruption, multi-turn voice context, Electron IPC push channels
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Barge-in = PTT-to-interrupt. Re-pressing PTT while `voiceState==='speaking'` fires `bargeIn()`, replacing the current no-op guard in `useVoiceSession.ts`.
- D-02: Cancellation = renderer-first, fire-and-forget. `AudioBufferSourceNode.stop()` + drain queue, then one-way IPC abort (wire `VOICE_CANCEL_TTS` stub or add `voice:abort` channel). Renderer does NOT await main.
- D-03: Single per-turn AbortController + spoken-so-far via `onChunk` accumulator ref (NOT `onAbort` — AI SDK #8088 fast-abort caveat).
- D-04: Hybrid first-chunk-then-sentence segmenter. First fragment ~6-10 words on a word boundary; steady-state full-sentence with abbreviation deny-list (`Mr|Mrs|Dr|Prof|Sr|Jr|vs|etc|i\.e|e\.g\.` + `\d\.\d`). Not `Intl.Segmenter` (needs full string).
- D-05: Kokoro playback queue = in-order promise-chain (`queue = queue.then(() => player.speak(chunk))`). Main pushes text-delta chunks via new push channel `aria:voice:tts-chunk`.
- D-06: `voice_latency_log` SQLite table with `session_id`, `t_llm_first_token`, `t_first_sentence_ready`, `t_kokoro_synth_start`, `t_first_audio_out` (INTEGER ms from session start). `DIAGNOSTICS_VOICE_LATENCY` IPC read channel. Debug-gated behind `ARIA_DEBUG=1`.
- D-07: Both surfaces (briefing + /ask) speak via a single shared read-aloud queue abstraction.
- D-08: Speed 0.5–2x = Kokoro `generate({ speed })` re-synth at section/answer boundaries. Not `playbackRate` (pitch-shifts).
- D-09: Pause/resume = `AudioContext.suspend()/resume()`. Thread `paused` boolean through `VoiceSessionState` alongside `voiceState='speaking'`. Cancel cooldown timer on pause.
- D-10: Skip-section keyed to `BriefingPayload` keys `['calendar','email','news']` via `currentSectionIndex` pointer. Skip = `source.stop()` + start next.
- D-11: Main-process `VoiceSession` Map keyed by session id holds `threadId` + `spokenSoFar`. Voice turns call `ask({ question, threadId })` using existing RAG machinery. Referent resolution = implicit (from `<thread_history>`). No new DB schema beyond `rag_thread`/`rag_turn`.
- D-12: On barge-in, write synthetic assistant turn `[interrupted: "<spokenSoFar>…"]` via `appendTurn` before next user turn.
- D-13: Zero write risk + static ratchet. Voice streaming modules import no write chokepoints. Extends Phase 14 `voice-routes-through-staging` ratchet philosophy.

### Claude's Discretion
- Exact first-fragment word count (tune within ~6–10)
- Completeness of abbreviation deny-list
- Queue buffer sizing / max-buffer safety valve
- `voice_latency_log` column SQL types
- HUD transport-control layout (gold/ivory/ink, Playfair + IBM Plex Mono)

### Deferred Ideas (OUT OF SCOPE)
- Always-on ambient VAD barge-in
- Explicit coreference rewrite step
- SoundTouch phase-vocoder real-time speed scrubbing
- Mini-STT keyword check for backchannel-vs-interruption
- Cloud STT/TTS opt-in + voice/output settings (Phase 17)
- GPU whisper / voice-priority p-queue lane / idle-unload / captions (Phase 19)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VOICE-02 | Aria reads the daily briefing aloud (TTS) with pause / skip / speed controls | D-08 kokoro `generate({speed})` confirmed; D-09 `AudioContext.suspend()/resume()` confirmed; D-10 BriefingPayload keys verified as `['calendar','email','news']`; BriefingScreen reads from `BRIEFING_TODAY` |
| VOICE-03 | Aria speaks `/ask` answers aloud, streaming first sentence | CRITICAL: answer-llm.ts uses `generateObject` (buffered) — Phase 16 MUST add a `streamText`-based variant; briefing/generate.ts also uses `generateObject` but briefing content is pre-generated so streaming is from stored text segments |
| VOICE-06 | Conversational multi-turn loop: Aria maintains context across turns and supports barge-in (user interrupt → Aria stops promptly via a single AbortController across LLM + TTS + audio) | `rag_thread`/`rag_turn`/`createThread`/`appendTurn`/`getThread(db,id,{lastN:6})` all confirmed and ready; `streamText` from `ai@6.0.185` confirmed with `abortSignal`, `onChunk`, `textStream`, `fullStream` |
</phase_requirements>

---

## Summary

Phase 16 is an extension-not-rewrite phase. The entire Phase 15 voice substrate — `useVoiceSession` state machine, `useKokoroPlayer`, `VoiceHUDBand`, `VoicePTTButton`, IPC channels, STT sidecar — ships unchanged. Phase 16 adds exactly six capabilities on top: (1) a streaming LLM→TTS cascade triggered after STT, (2) barge-in via PTT-to-interrupt, (3) briefing read-aloud with transport controls, (4) /ask answer streaming, (5) multi-turn voice context via the existing RAG thread machinery, and (6) a latency telemetry table.

The single biggest planning risk is that **both `answer-llm.ts` and `briefing/generate.ts` use `generateObject` (buffered) today** — they return final structured objects, not token-delta streams. Phase 16's streaming cascade requires `streamText` token-deltas. For `/ask` this means a new `streamVoiceAnswer()` function in `answer-service.ts` that bypasses `generateObject` in favor of `streamText` with a plain text prompt (no Zod schema, no structured citations on the streaming path — citations are the trade-off for streaming). For the briefing surface, content is already stored as `BriefingPayload` JSON; read-aloud can walk the stored sections without LLM streaming — the streaming cascade applies to the `/ask` path only.

The `kokoro-js@1.2.1` `generate({ speed })` API is confirmed with a `speed` parameter. A second streaming API (`KokoroTTS.stream()`) also exists — the planner should know about it as an alternative for the D-05 queue, but D-05 is locked to the promise-chain approach using `generate()`. The installed AI SDK is `ai@6.0.185` (not v5 as CLAUDE.md states — the project actually runs SDK 6; all API names are the same but this distinction matters for any version-specific caveats). The `onAbort` caveat from AI SDK issue #8088 applies to SDK 6 as well — `onAbort` fires after steps complete but on a fast abort it may redirect to `onError`; the `onChunk` accumulator is the correct pattern regardless.

**Primary recommendation:** Add a `streamVoiceAnswer(db, question, threadId, onChunk, signal)` function to `answer-service.ts` alongside (not replacing) `ask()`. This is the narrowest change that unblocks D-03/D-04/D-05 for VOICE-03 without touching the existing RAG Q&A surface.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| LLM streaming (streamText, AbortController) | Main process | — | All LLM calls live in main; renderer cannot call frontier APIs directly |
| TTS synthesis (Kokoro generate) | Renderer | — | kokoro-js runs in the renderer's WebAssembly/WebGPU context; AudioContext lives in renderer |
| TTS chunk push (aria:voice:tts-chunk) | Main → Renderer | Preload bridge | Same push pattern as VOICE_TRANSCRIPT_DELTA |
| Barge-in detection (PTT-to-interrupt) | Renderer | — | VoicePTTButton is in renderer; key events fire in renderer |
| Audio cancellation (AudioBufferSourceNode.stop) | Renderer | — | Web Audio API is renderer-only |
| LLM stream abort (AbortController.abort) | Main process | One-way IPC from renderer | Renderer fires abort IPC, main owns the AbortController |
| Text segmenter (first-chunk + sentence boundary) | Main process | — | Lives next to the streamText call site where token deltas arrive |
| Kokoro playback queue | Renderer | — | Wraps useKokoroPlayer which owns AudioContext |
| Multi-turn context (createThread/appendTurn/getThread) | Main process | — | DB is main-process-only (better-sqlite3 single-writer) |
| Transport controls (pause/skip/speed) | Renderer | IPC for speed + skip | AudioContext.suspend/resume is renderer Web Audio; skip signals which section to start next |
| Latency telemetry (voice_latency_log) | Main process | DIAGNOSTICS_VOICE_LATENCY IPC | DB writes in main; renderer reads via diagnostics channel |
| Read-only guard (static ratchet) | Test layer | — | Static grep at tests/static/, mirrors voice-routes-through-staging.spec.ts |

---

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ai` (Vercel AI SDK) | 6.0.185 | `streamText` for LLM token-delta streaming | Already in project; `streamText` with `abortSignal` + `onChunk` confirmed [VERIFIED: node_modules/ai/package.json] |
| `kokoro-js` | 1.2.1 | TTS synthesis with `generate({ speed })` | Already in project; `speed` param confirmed in type defs [VERIFIED: node_modules/kokoro-js/types/kokoro.d.ts] |
| `better-sqlite3-multiple-ciphers` | 11.x | `voice_latency_log` migration | Already in project |

### No New Dependencies Required
All Phase 16 capabilities use already-installed libraries. No `npm install` needed. [VERIFIED: package.json]

---

## Critical Finding: answer-llm.ts Uses generateObject, NOT streamText

**This is the single biggest planning risk.** [VERIFIED: src/main/rag/answer-llm.ts]

`answer-llm.ts` calls `generateObject` which returns a buffered `{ answer: string, citations: number[] }` object. The streaming cascade for VOICE-03 requires token-level text deltas. The existing `ask()` call in `answer-service.ts` invokes `llm.generate()` which wraps `generateObject`.

**Consequence for the planner:** Phase 16 needs a NEW streaming path alongside the existing ask path. The cleanest approach (avoiding any change to the existing `ask()` flow that the /ask UI uses) is:

```typescript
// New function in src/main/rag/answer-service.ts (or a sibling file)
// Source: architecture derived from existing ask() + ai@6.0.185 streamText API
export async function streamVoiceAnswer(args: {
  db: Database;
  question: string;
  threadId: string;
  signal: AbortSignal;
  onChunk: (textDelta: string) => void;
  onDone: (fullText: string) => void;
}): Promise<void>
```

This function:
1. Calls `hybridRetrieve` for context chunks (same as `ask()`)
2. Calls `buildLocalPrompt` or `buildFrontierPrompt` to get the prompt string
3. Calls `streamText({ model, prompt, abortSignal: args.signal, onChunk: ({ chunk }) => { if (chunk.type === 'text-delta') args.onChunk(chunk.textDelta) } })`
4. Returns the full accumulated text via `onDone` for thread persistence

**Important:** `streamText` does not support Zod schema/structured output — it returns free-form text. For voice streaming, this is acceptable. Citations are omitted from the streaming path (trade-off confirmed as reasonable for voice use case).

---

## AI SDK 6 streamText API (Verified)

[VERIFIED: node_modules/ai/dist/index.d.ts, ai@6.0.185]

```typescript
// Confirmed API surface for streamText in ai@6.0.185
const result = streamText({
  model,                        // LanguageModelV1
  prompt,                       // string
  abortSignal,                  // AbortSignal — wires to D-03 AbortController
  onChunk: ({ chunk }) => {     // D-03: text-delta accumulator
    if (chunk.type === 'text-delta') {
      spokenSoFarRef.current += chunk.textDelta;
      segmenter.push(chunk.textDelta);  // feeds D-04 segmenter
    }
  },
  onError: ({ error }) => {     // AI SDK #8088: fast abort redirects here, not onAbort
    // handle abort + error equally — spoken-so-far is in onChunk accumulator, safe
  },
  onAbort: () => {              // may NOT fire on fast abort (<~500ms) — DO NOT rely on this
    // D-03 warning: do not use onAbort for spokenSoFar capture
  },
});

// Streaming surfaces:
result.textStream;   // AsyncIterableStream<string> — plain text deltas
result.fullStream;   // AsyncIterableStream<TextStreamPart> — all event types
```

**AI SDK #8088 fast-abort behavior (CONFIRMED APPLIES TO SDK 6):**
When `AbortController.abort()` is called less than ~500ms after `streamText()` starts, the abort may surface as an error in `onError` instead of firing `onAbort`. The D-03 `onChunk` accumulator pattern is the correct mitigation: `spokenSoFar` lives in a `ref` updated synchronously on every token, so it's available regardless of which error path fires.

**Note:** CLAUDE.md references "AI SDK 5" but the installed version is `ai@6.0.185`. The API shape (`streamText`, `generateObject`, `onChunk`, `abortSignal`) is the same between SDK 5 and 6 — no breaking changes for Phase 16's usage. [VERIFIED: package.json + node_modules inspection]

---

## kokoro-js@1.2.1 API (Verified)

[VERIFIED: node_modules/kokoro-js/types/kokoro.d.ts]

### generate() — D-08 Speed Re-synth

```typescript
// Confirmed signature:
generate(text: string, { voice, speed }?: GenerateOptions): Promise<RawAudio>

// GenerateOptions:
interface GenerateOptions {
  voice?: keyof typeof VOICES;  // e.g. 'af_heart'
  speed?: number;               // D-08: 0.5–2x range
}

// RawAudio:
interface RawAudio {
  audio: Float32Array;
  sampling_rate: number;
}
```

**Speed parameter:** `speed?: number` — confirmed present. No documented min/max but Kokoro uses StyleTTS2 duration scaling (not sample-rate manipulation) so 0.5–2x is the safe operating range per D-08. [VERIFIED: kokoro.d.ts]

**Existing `KokoroPlayerHandle.generate()` type annotation in useKokoroPlayer.ts:**
```typescript
// Current type (line 32-35 of useKokoroPlayer.ts):
export interface KokoroTtsInstance {
  generate(
    text: string,
    options?: { voice?: string }   // ← NO speed parameter today
  ): Promise<{ audio: Float32Array; sampling_rate: number }> | { ... };
}
```
**ACTION REQUIRED:** The `KokoroTtsInstance` interface in `useKokoroPlayer.ts` must be extended to add `speed?: number` to the options. The real kokoro-js `generate()` accepts it but the current type stub doesn't declare it.

### stream() — Alternative (Not Used, For Awareness Only)

```typescript
// kokoro-js also exposes a native streaming API:
stream(text: string | TextSplitterStream, options?: StreamGenerateOptions): 
  AsyncGenerator<{ text: string; phonemes: string; audio: RawAudio }, void, void>
```

This yields audio chunks as Kokoro segments the input. D-05 is locked to the `generate()` promise-chain queue approach — but the planner should know `stream()` exists as a lower-latency alternative if the queue approach proves too slow. **Do not change the locked decision; document this as a Claude's Discretion optimization note.**

---

## Architecture Patterns

### System Architecture Diagram

```
PTT press (renderer)
      │
      ▼
useVoiceSession.bargeIn() ──[if speaking]──→ AudioBufferSourceNode.stop()
      │                                       drain TTS queue
      │                                       one-way IPC → aria:voice:abort
      │
      ▼ [if not speaking]
useVoiceSession.startTurn()
      │
      ▼
STT sidecar (file-based, Phase 15)
      │ VOICE_TRANSCRIPT_DELTA
      ▼
transcript → VOICE_FEED_ANSWER IPC (new invoke channel)
      │
      ▼ main process
VoiceSession Map[sessionId] = { threadId, spokenSoFarRef }
      │
      ├─ hybridRetrieve(question, db)
      ├─ buildPrompt(chunks, threadHistory)
      │
      ▼
streamText({ model, prompt, abortSignal, onChunk })
      │
      ├──[each text-delta]──→ spokenSoFarRef += delta
      │                        D-04 segmenter.push(delta)
      │                             │
      │                             ├─[first ~8 word boundary]──→ flush chunk 1
      │                             └─[sentence boundary]──→ flush chunk N
      │
      │                        flush → webContents.send(VOICE_TTS_CHUNK, text)
      │                                      │
      │                                      ▼ renderer
      │                              tts-chunk IPC (aria:voice:tts-chunk)
      │                                      │
      │                                      ▼
      │                              queue = queue.then(() => player.speak(chunk, speed))
      │                                      │
      │                                      ▼
      │                              Kokoro generate({ text, voice, speed })
      │                                      │
      │                                      ▼
      │                              AudioBufferSourceNode.start()
      │                                      │
      │                              onPlaybackStart() → voiceState='speaking'
      │
      └──[stream done]──→ appendTurn(db, threadId, 'assistant', spokenSoFar)
                          writeVoiceLatencyLog(db, sessionId, timestamps)
```

### Recommended Project Structure (new files only)

```
src/
├── main/
│   ├── voice/
│   │   ├── voice-session-manager.ts    # VoiceSession Map, streamVoiceAnswer loop
│   │   ├── tts-segmenter.ts            # D-04 hybrid first-chunk + sentence segmenter
│   │   └── voice-latency-log.ts        # D-06 writeVoiceLatencyLog + readVoiceLatencyLog
│   ├── ipc/
│   │   └── voice.ts                    # EXTEND: add VOICE_FEED_ANSWER + VOICE_ABORT + DIAGNOSTICS_VOICE_LATENCY handlers
│   └── db/migrations/
│       └── 136_voice_latency_log.sql   # D-06 table
├── renderer/features/voice/
│   ├── useVoiceSession.ts              # EXTEND: add bargeIn(), paused, AbortController ref
│   ├── tts/useKokoroPlayer.ts          # EXTEND: KokoroTtsInstance speed type, queue wrapper
│   ├── VoiceHUDBand.tsx                # EXTEND: transport controls (pause/skip/speed)
│   └── useReadAloudQueue.ts            # NEW: shared read-aloud queue abstraction (D-07)
├── shared/
│   └── ipc-contract.ts                 # EXTEND: 3 new CHANNELS + AriaApi methods
tests/
├── static/
│   └── voice-streaming-no-write.spec.ts  # D-13 read-only ratchet
├── unit/main/voice/
│   ├── tts-segmenter.spec.ts
│   └── voice-session-manager.spec.ts
└── unit/renderer/voice/
    └── useReadAloudQueue.spec.ts
```

---

## Pattern 1: IPC Push Channel (aria:voice:tts-chunk)

**Model:** `VOICE_TRANSCRIPT_DELTA` pattern in `src/preload/index.ts` lines 54-58. [VERIFIED: src/preload/index.ts]

```typescript
// 1. Add to CHANNELS in ipc-contract.ts:
VOICE_TTS_CHUNK: 'aria:voice:tts-chunk',          // push: main → renderer
VOICE_ABORT: 'aria:voice:abort',                    // invoke: renderer → main (one-way)
DIAGNOSTICS_VOICE_LATENCY: 'aria:diagnostics:voice-latency', // invoke: renderer → main (read)

// 2. Add to CHANNEL_METHODS:
VOICE_TTS_CHUNK: 'onVoiceTtsChunk',
VOICE_ABORT: 'voiceAbort',
DIAGNOSTICS_VOICE_LATENCY: 'diagnosticsVoiceLatency',

// 3. Add to AriaApi:
onVoiceTtsChunk?: (cb: (chunk: { text: string; sessionId: string }) => void) => () => void;
voiceAbort(req: { sessionId: string }): Promise<{ ok: true } | IpcError>;
diagnosticsVoiceLatency(req?: { limit?: number }): Promise<VoiceLatencyLogRow[] | IpcError>;

// 4. Wire in preload/index.ts (mirrors onVoiceTranscript):
(api as unknown as Record<string, ((cb: (d: unknown) => void) => () => void)>)
  .onVoiceTtsChunk = (cb: (d: unknown) => void) => {
  const handler = (_e: unknown, d: unknown) => cb(d);
  ipcRenderer.on(CHANNELS.VOICE_TTS_CHUNK, handler);
  return () => ipcRenderer.removeListener(CHANNELS.VOICE_TTS_CHUNK, handler);
};
```

**Handler count invariant:** tests/unit/main/ipc/index.spec.ts asserts `handlers.size === Object.keys(CHANNELS).length`. Currently 149 channels. Adding 3 new channels → invariant becomes 152. The test WILL fail until all 3 new channels have registered handlers. [VERIFIED: tests/unit/main/ipc/index.spec.ts line 76-77]

---

## Pattern 2: D-04 Hybrid Segmenter

[ASSUMED: segment boundary logic — based on D-04 spec + standard NLP patterns]

```typescript
// src/main/voice/tts-segmenter.ts
// Note: Intl.Segmenter rejected per D-04 (needs full string upfront)

const ABBREVIATION_RE = /\b(Mr|Mrs|Dr|Prof|Sr|Jr|vs|etc|i\.e|e\.g\.)$/i;
const DECIMAL_RE = /\d\.\d$/;
const SENTENCE_END_RE = /[.!?](?:\s|$)/;

export class TtsSegmenter {
  private buffer = '';
  private wordCount = 0;
  private firstChunkFlushed = false;
  private readonly firstChunkWords: number;  // Claude's discretion: ~6–10

  constructor(firstChunkWords = 8) {
    this.firstChunkWords = firstChunkWords;
  }

  push(delta: string): string[] {
    this.buffer += delta;
    const chunks: string[] = [];

    if (!this.firstChunkFlushed) {
      // Regime 1: flush on word boundary at ~firstChunkWords
      const words = this.buffer.split(/\s+/).filter(Boolean);
      if (words.length >= this.firstChunkWords) {
        const boundary = findWordBoundary(this.buffer, this.firstChunkWords);
        if (boundary > 0) {
          chunks.push(this.buffer.slice(0, boundary).trim());
          this.buffer = this.buffer.slice(boundary);
          this.firstChunkFlushed = true;
        }
      }
    } else {
      // Regime 2: sentence boundaries with abbreviation guard
      let match: RegExpExecArray | null;
      const re = /[.!?](?:\s|$)/g;
      let lastEnd = 0;
      while ((match = re.exec(this.buffer)) !== null) {
        const end = match.index + match[0].length;
        const candidate = this.buffer.slice(lastEnd, end).trim();
        if (!ABBREVIATION_RE.test(candidate) && !DECIMAL_RE.test(candidate)) {
          chunks.push(candidate);
          lastEnd = end;
        }
      }
      if (lastEnd > 0) {
        this.buffer = this.buffer.slice(lastEnd);
      }
    }
    return chunks;
  }

  flush(): string {
    const remaining = this.buffer.trim();
    this.buffer = '';
    this.firstChunkFlushed = false;
    this.wordCount = 0;
    return remaining;
  }
}
```

---

## Pattern 3: D-05 Kokoro Promise-Chain Queue

[VERIFIED: useKokoroPlayer.ts speak() signature; queue pattern from D-05 spec]

```typescript
// src/renderer/features/voice/useReadAloudQueue.ts
// Extends useKokoroPlayer to add queue + speed + pause/resume

export function useReadAloudQueue(player: KokoroPlayerHandle, speed: number) {
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const pausedRef = useRef(false);

  const enqueue = useCallback((text: string) => {
    queueRef.current = queueRef.current.then(async () => {
      if (pausedRef.current) return;   // barge-in cleared queue
      await player.speak(text, { speed });
    });
  }, [player, speed]);

  const cancel = useCallback(() => {
    // D-02: stop current source + replace queue with resolved promise
    activeSourceRef.current?.stop();
    queueRef.current = Promise.resolve();
  }, []);

  return { enqueue, cancel };
}
```

**Note on the speed type gap:** `useKokoroPlayer.ts` `KokoroTtsInstance.generate()` currently types options as `{ voice?: string }` with no `speed` field. The planner must include a task to extend this interface and pass `speed` through to `generate()`.

---

## Pattern 4: D-03 AbortController + Barge-in Extension to useVoiceSession

[VERIFIED: useVoiceSession.ts startTurn() line 152-161; state machine confirmed]

```typescript
// Extensions needed in VoiceSessionState:
interface VoiceSessionState {
  // ... existing fields ...
  paused: boolean;               // D-09: pause/resume gate
  abortController: AbortController | null;  // D-03: per-turn controller
}

// Extensions needed in VoiceSessionActions:
interface VoiceSessionActions {
  // ... existing actions ...
  bargeIn(): void;               // D-01: replaces no-op guard when state='speaking'
  pause(): void;                 // D-09
  resume(): void;                // D-09
}

// bargeIn() implementation:
bargeIn(): void {
  if (state.voiceState !== 'speaking') return;
  // 1. Renderer cancels audio immediately
  // (caller must also call readAloudQueue.cancel())
  // 2. Fire one-way IPC abort
  window.aria.voiceAbort?.({ sessionId: currentSessionId });
  // 3. Transition to 'listening' for next PTT
  clearCooldown();
  setState({ voiceState: 'idle', micGated: false, paused: false });
}

// pause() implementation:
pause(): void {
  clearCooldown();   // D-09: cancel cooldown timer on pause
  setState({ paused: true });
  // caller must also call audioContext.suspend()
}

// resume() implementation:
resume(): void {
  setState({ paused: false });
  // caller must also call audioContext.resume()
}
```

---

## Pattern 5: D-06 Latency Log

[VERIFIED: routingLog.ts writeRoutingLog pattern; diagnostics.ts handler pattern]

```sql
-- src/main/db/migrations/136_voice_latency_log.sql
CREATE TABLE IF NOT EXISTS voice_latency_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  t_stt_done          INTEGER NOT NULL,   -- ms from session start: STT complete
  t_llm_first_token   INTEGER,            -- ms: first streamText token received
  t_first_sentence_ready INTEGER,          -- ms: first TTS chunk dispatched
  t_kokoro_synth_start INTEGER,            -- ms: Kokoro generate() called
  t_first_audio_out   INTEGER,             -- ms: AudioBufferSourceNode.start() called
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_voice_latency_session ON voice_latency_log(session_id);
```

```typescript
// src/main/voice/voice-latency-log.ts
// Mirror of writeRoutingLog pattern
export interface VoiceLatencyInput {
  session_id: string;
  t_stt_done: number;
  t_llm_first_token?: number | null;
  t_first_sentence_ready?: number | null;
  t_kokoro_synth_start?: number | null;
  t_first_audio_out?: number | null;
}

export function writeVoiceLatencyLog(db: Db, e: VoiceLatencyInput): void {
  if (process.env.ARIA_DEBUG !== '1') return;  // debug-gated
  db.prepare(`INSERT INTO voice_latency_log (...) VALUES (...)`).run(...);
}
```

**Debug gate:** Uses `process.env.ARIA_DEBUG === '1'`, matching the existing pattern in `src/main/scheduling/propose.ts` line 162. [VERIFIED: src/main/scheduling/propose.ts] There is no separate OTEL system in the codebase — D-06 uses this same ARIA_DEBUG flag pattern.

---

## Pattern 6: D-13 Static Ratchet (Read-Only Guard)

[VERIFIED: tests/static/voice-routes-through-staging.spec.ts]

The D-13 ratchet follows the exact same structure as `voice-routes-through-staging.spec.ts`. The new ratchet should:

1. Walk `src/main/voice/` (the streaming modules directory)
2. Also walk `src/renderer/features/voice/` (the renderer streaming files)
3. Assert no file imports or calls: `assertApproved`, `voiceConfirm`, `sendApprovedEmail`, `applyCalendarChange`, `pushApprovedMeetingActions`

```typescript
// tests/static/voice-streaming-no-write.spec.ts
// Extends voice-routes-through-staging.spec.ts philosophy for Phase 16 modules

const VOICE_STREAMING_DIRS = [
  path.resolve(ROOT, 'voice'),                    // src/main/voice/
];
const RENDERER_VOICE_ROOT = path.resolve(ROOT, '../../renderer/features/voice');

const WRITE_CHOKEPOINTS = [
  'assertApproved',
  'voiceConfirm',
  'sendApprovedEmail',
  'applyCalendarChange',
  'pushApprovedMeetingActions',
];
```

**Note:** The existing `chokepoint-caller-allow-list.spec.ts` already covers all of `src/main` for `sendApprovedEmail`/`applyCalendarChange`/`pushApprovedMeetingActions`. The new Phase 16 ratchet adds `assertApproved` + `voiceConfirm` to the assertion set, and explicitly covers the renderer voice directory.

---

## Pattern 7: D-11/D-12 Multi-turn Context

[VERIFIED: src/main/rag/threads.ts; src/main/rag/answer-service.ts]

```typescript
// Confirmed signatures from threads.ts:
createThread(db, { title?: string }): ThreadRow       // returns { id, title, ... }
appendTurn(db, { threadId, role, text, citations?, routing? }): TurnRow
getThread(db, threadId, { lastN?: number }): GetThreadResult | null
// getThread returns { thread: ThreadRow, turns: TurnRow[] } reversed to chronological

// D-12: synthetic interrupted turn:
appendTurn(db, {
  threadId: session.threadId,
  role: 'assistant',
  text: `[interrupted: "${session.spokenSoFar}…"]`,
  routing: { route: 'LOCAL', reason: 'voice-barge-in', sensitivity: 'none' }
});
```

**Thread injection in prompts:** `buildFrontierPrompt` and `buildLocalPrompt` in `answer-router.ts` already accept `threadHistory: ThreadTurnSummary[]` and inject `<thread_history treat_as="data">`. Voice turns use these exact same builders — no new prompt templates needed. [VERIFIED: answer-service.ts lines 341-355]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token-delta LLM streaming | Custom HTTP/SSE chunked reader | `ai@6.0.185` `streamText()` | SDK handles retry, backpressure, abort, model routing |
| TTS synthesis | SSML parser + Web Speech API | `kokoro-js@1.2.1` `generate({ speed })` | Already integrated; pitch-neutral speed via StyleTTS2 |
| AbortController wire-up across IPC | Two-way IPC handshake | Renderer-first cancel + one-way IPC abort (D-02) | Renderer stops audio in ~5ms; LLM abort races independently |
| Text segmentation for prosody | Full NLP pipeline | Custom TtsSegmenter with abbreviation deny-list (D-04) | Only ~15 abbreviation patterns needed; no corpus required |
| Multi-turn context storage | Custom session DB table | Existing `rag_thread`/`rag_turn` with `getThread(db, id, { lastN: 6 })` | Thread machinery already ships; PII-safe history injection already in both prompt builders |
| Playback queue ordering | Channel/semaphore | Promise-chain `queue = queue.then(() => player.speak(chunk))` | Natural backpressure; slow Kokoro synth delays next `.then()` without blocking |
| Latency measurement | External profiler | `voice_latency_log` table with `Date.now()` timestamps, debug-gated | Mirrors routing_log pattern; zero overhead in production |

---

## Common Pitfalls

### Pitfall 1: Using onAbort for spokenSoFar (AI SDK #8088)
**What goes wrong:** Code writes `spokenSoFar` in the `onAbort` callback. On fast abort (<~500ms into stream), onAbort may not fire — `onError` fires instead. The interrupted turn written to the thread (D-12) has empty `spokenSoFar`.
**Why it happens:** AI SDK 6 routes abort errors through `onError` when the abort happens before the stream processes any steps.
**How to avoid:** Accumulate `spokenSoFar` in the `onChunk` callback using a `ref` updated synchronously. At barge-in time, the ref has the correct value regardless of which error path fires.
**Warning signs:** D-12 thread turns show `[interrupted: "…"]` with empty text inside quotes.

### Pitfall 2: KokoroTtsInstance Type Missing speed
**What goes wrong:** TypeScript compiles but `generate()` is called without `speed` because the local interface doesn't declare it. Speed setting silently does nothing.
**Why it happens:** `useKokoroPlayer.ts` line 32-35 defines `KokoroTtsInstance.generate(text, { voice? })` with no `speed` parameter.
**How to avoid:** Update `KokoroTtsInstance` interface to `generate(text, { voice?, speed? })` before implementing D-08.
**Warning signs:** `pnpm typecheck` passes but speed controls have no effect.

### Pitfall 3: Handler Count Invariant Failure
**What goes wrong:** `tests/unit/main/ipc/index.spec.ts` fails with `expected 149 to be 152` after adding 3 new CHANNELS entries.
**Why it happens:** The test asserts `handlers.size === Object.keys(CHANNELS).length`. New channels must have registered handlers.
**How to avoid:** Add all 3 new channels AND their handlers in the same plan wave; or add stub handlers for push-only channels.
**Warning signs:** ipc/index.spec.ts line 77 fails.

### Pitfall 4: Briefing Read-Aloud Tries to Stream from LLM
**What goes wrong:** Plan adds `streamText` to `briefing/generate.ts` to enable voice streaming. This breaks the existing structured output schema (BriefingSchema) and changes the briefing generation flow.
**Why it happens:** Misreading D-07 as requiring LLM streaming for the briefing surface.
**How to avoid:** Briefing content is already generated and stored as `BriefingPayload` JSON. Read-aloud for briefing walks the stored sections (`calendar`, `email`, `news`) as pre-built text — no LLM involved. Only the `/ask` path needs `streamText`.
**Warning signs:** `runBriefing()` signature changes; existing briefing tests break.

### Pitfall 5: Queue Not Cleared on Barge-in
**What goes wrong:** User presses PTT to barge in; audio stops immediately (AudioBufferSourceNode.stop) but the promise-chain queue has pending `speak()` calls that start playing after the new turn begins.
**Why it happens:** D-02 specifies draining the TTS queue but the implementation forgets to reset `queueRef.current = Promise.resolve()` on barge-in.
**How to avoid:** In `useReadAloudQueue.cancel()`, BOTH stop the current source AND reset the queue promise to a resolved stub.
**Warning signs:** Old speech resumes mid-new-turn.

### Pitfall 6: AudioContext Not Resumed Before Next speak()
**What goes wrong:** User pauses (AudioContext.suspend()), then barges in. The queue tries to play next turn but AudioContext is still suspended.
**Why it happens:** D-09 pause path suspends AudioContext; barge-in path doesn't resume it.
**How to avoid:** `bargeIn()` must call `audioContext.resume()` before transitioning state. `VoiceSessionState.paused` should be cleared to `false` in `bargeIn()`.
**Warning signs:** Audio produces no sound after barge-in following a pause.

### Pitfall 7: VOICE_ABORT Used as invoke-and-await
**What goes wrong:** Renderer `await`s the `voiceAbort()` IPC call before transitioning barge-in state, introducing ~40ms latency.
**Why it happens:** D-02 specifies "fire-and-forget" but code follows the invoke pattern.
**How to avoid:** Call `window.aria.voiceAbort({ sessionId })` without `await`. The AbortController abort in main races independently. SC3's <200ms barge-in is renderer-side only.
**Warning signs:** Measured barge-in cancel latency >10ms even with synchronous audio stop.

### Pitfall 8: streamVoiceAnswer Path Not PII-Guarded
**What goes wrong:** The new streaming LLM path for voice sends raw question text directly to frontier without PII redaction.
**Why it happens:** The existing `ask()` path handles PII via `tokenizeForFrontier` / `rehydrate` — the new streaming path may omit these.
**How to avoid:** `streamVoiceAnswer()` must apply the same `routeAnswer()` decision and, if FRONTIER, apply `tokenizeForFrontier` to the prompt before calling `streamText()`. Local route can skip redaction (local model on-device).
**Warning signs:** No token in `redaction_roundtrip` for voice frontier calls; PII leaks in frontier prompts.

---

## Integration Points — File-Level

| File | Change Type | What Changes |
|------|-------------|--------------|
| `src/shared/ipc-contract.ts` | EXTEND | Add 3 CHANNELS + CHANNEL_METHODS + AriaApi methods: `VOICE_TTS_CHUNK`, `VOICE_ABORT`, `DIAGNOSTICS_VOICE_LATENCY` |
| `src/preload/index.ts` | EXTEND | Add `onVoiceTtsChunk` push subscription (mirrors onVoiceTranscript) |
| `src/main/ipc/voice.ts` | EXTEND | Add `VOICE_ABORT` handler (abort the per-session AbortController) + `VOICE_FEED_ANSWER` (trigger streaming cascade) + `DIAGNOSTICS_VOICE_LATENCY` handler |
| `src/main/ipc/index.ts` | EXTEND | Register new voice handlers; update db-null skip set |
| `src/renderer/features/voice/useVoiceSession.ts` | EXTEND | Add `bargeIn()`, `pause()`, `resume()`, `paused: boolean`, `abortController` to state+actions |
| `src/renderer/features/voice/tts/useKokoroPlayer.ts` | EXTEND | Extend `KokoroTtsInstance` type with `speed?: number`; add queue + speed params |
| `src/renderer/features/voice/VoiceHUDBand.tsx` | EXTEND | Add transport controls (pause/resume/skip/speed slider) |
| `src/main/rag/answer-service.ts` | EXTEND | Add `streamVoiceAnswer()` alongside `ask()` |
| `src/main/db/migrations/embedded.ts` | EXTEND | Add migration 136 for `voice_latency_log` |

**New files:**
- `src/main/voice/voice-session-manager.ts` — main-process VoiceSession Map + streaming loop
- `src/main/voice/tts-segmenter.ts` — D-04 segmenter (unit-testable, no deps)
- `src/main/voice/voice-latency-log.ts` — D-06 writer + reader
- `src/main/db/migrations/136_voice_latency_log.sql`
- `src/renderer/features/voice/useReadAloudQueue.ts` — D-05/D-07 shared queue
- `tests/static/voice-streaming-no-write.spec.ts` — D-13 ratchet
- `tests/unit/main/voice/tts-segmenter.spec.ts`
- `tests/unit/main/voice/voice-session-manager.spec.ts`
- `tests/unit/renderer/voice/useReadAloudQueue.spec.ts`

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| AI SDK v5 (as documented in CLAUDE.md) | `ai@6.0.185` (SDK 6) actually installed | Package.json shows `^6.0.0` — was likely updated after CLAUDE.md was written | `streamText` API signature is the same; `generateObject` is the same; no Phase 16 breaking changes |
| kokoro-js `generate({ voice })` only (Phase 15 type def) | kokoro-js 1.2.1 `generate({ voice, speed })` — speed confirmed in type defs | Available in 1.2.1; Phase 15 didn't need it | Phase 16 must extend `KokoroTtsInstance` type |
| `VOICE_CANCEL_TTS` = pure ack stub | Phase 16 wires `VOICE_ABORT` as a real one-way abort channel | Phase 16 | `VOICE_CANCEL_TTS` was never connected to an AbortController; Phase 16 adds real abort |

---

## Runtime State Inventory

> This phase adds new SQLite table (migration 136) and new in-memory VoiceSession Map.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | `rag_thread`/`rag_turn` reused for voice threads — no rename | None; reuse as-is |
| Live service config | None — no external service configuration | None |
| OS-registered state | None | None |
| Secrets/env vars | `ARIA_DEBUG=1` gates latency log writes | No change needed; existing pattern |
| Build artifacts | None new | None |

**Nothing found in OS-registered state or live service config categories — verified by codebase grep.**

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `streamVoiceAnswer` skipping PII round-trip is acceptable for LOCAL route (on-device LLM) | Pitfall 8 | PII could reach local model, but local model runs on-device — risk is lower than frontier |
| A2 | `ARIA_DEBUG=1` is the correct gate for `voice_latency_log` writes (no separate OTEL system exists) | Pattern 5 / D-06 | If OTEL is added later, writes might be duplicated; no functional risk in Phase 16 |
| A3 | `streamText` free-form text (no citations) is acceptable for voice /ask answers | Critical Finding section | User may expect spoken citations; CONTEXT.md D-11 says "referent resolution is implicit" — no explicit citations in voice |
| A4 | kokoro-js `speed` range 0.5–2x is safe without distortion artifacts | Standard Stack / D-08 | If StyleTTS2 produces artifacts at extremes, user may report quality regression |
| A5 | Briefing read-aloud needs no LLM streaming — walks stored BriefingPayload sections | Architecture / Pitfall 4 | If user expects real-time LLM re-generation of briefing on voice request, this would disappoint |

---

## Open Questions

1. **PII redaction in streamVoiceAnswer on FRONTIER route**
   - What we know: `ask()` applies `tokenizeForFrontier` / `rehydrate` when routing to FRONTIER
   - What's unclear: `streamText` returns a stream — rehydration happens on completed text only; partial-token rehydration mid-stream is architecturally complex
   - Recommendation: For Phase 16, scope `streamVoiceAnswer` to LOCAL route only (the sensitivity classifier already gates this). FRONTIER voice streaming with PII round-trip is Phase 17 scope.

2. **VoiceHUDBand transport controls UI spec**
   - What we know: D-Claude's discretion says "stay within editorial design system: gold/ivory/ink, Playfair + IBM Plex Mono"
   - What's unclear: Exact layout — inline with HUD band? Separate control bar? Keyboard shortcuts?
   - Recommendation: Planner should spec transport controls as an inline sub-row within VoiceHUDBand when `voiceState==='speaking'`; use existing editorial Button + Slider primitives.

3. **Session ID generation for VoiceSession Map**
   - What we know: VoiceSession is a Map keyed by session id; `threads.ts` uses `genId('thr')` = `thr_${randomBytes(8).toString('hex')}`
   - What's unclear: Should voice session ID be the same as thread ID, or a separate concept?
   - Recommendation: Use `threadId` directly as the session key — one thread per voice session aligns with D-11 "Map keyed by session id holds a threadId."

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `ai@streamText` | D-03/D-04/D-05 LLM streaming | ✓ | 6.0.185 | — |
| `kokoro-js@generate({speed})` | D-08 speed control | ✓ | 1.2.1 | — |
| `better-sqlite3` (voice_latency_log migration) | D-06 telemetry | ✓ | 11.x (already present) | — |
| Electron `webContents.send` push | aria:voice:tts-chunk | ✓ | Electron 41.x | — |

No missing dependencies. All Phase 16 capabilities are covered by already-installed packages. [VERIFIED: package.json]

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.x |
| Config file | vitest.config.ts (projects: main, renderer) |
| Quick run command | `npx vitest run tests/unit/main/voice/ tests/unit/renderer/voice/ tests/static/voice-streaming-no-write.spec.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VOICE-03 / D-04 | TtsSegmenter flushes first chunk at ~8 words on word boundary | unit | `npx vitest run tests/unit/main/voice/tts-segmenter.spec.ts` | ❌ Wave 0 |
| VOICE-03 / D-04 | TtsSegmenter respects abbreviation deny-list (no split on "Dr. Smith") | unit | `npx vitest run tests/unit/main/voice/tts-segmenter.spec.ts` | ❌ Wave 0 |
| VOICE-06 / D-03 | onChunk accumulator captures spokenSoFar before abort | unit | `npx vitest run tests/unit/main/voice/voice-session-manager.spec.ts` | ❌ Wave 0 |
| VOICE-06 / D-01 | bargeIn() transitions to idle when voiceState==='speaking' | unit | `npx vitest run tests/unit/renderer/voice/useVoiceSession.spec.ts` | ✅ (extend) |
| VOICE-06 / D-01 | bargeIn() is no-op when voiceState!=='speaking' | unit | `npx vitest run tests/unit/renderer/voice/useVoiceSession.spec.ts` | ✅ (extend) |
| VOICE-02 / D-09 | pause() sets paused=true; cooldown timer cancelled | unit | `npx vitest run tests/unit/renderer/voice/useVoiceSession.spec.ts` | ✅ (extend) |
| VOICE-02 / D-08 | KokoroTtsInstance type accepts speed parameter | type-check | `pnpm typecheck` | ✅ (type-only) |
| VOICE-02 / D-05 | useReadAloudQueue.enqueue() resolves in order | unit | `npx vitest run tests/unit/renderer/voice/useReadAloudQueue.spec.ts` | ❌ Wave 0 |
| VOICE-02 / D-05 | useReadAloudQueue.cancel() clears queue and stops source | unit | `npx vitest run tests/unit/renderer/voice/useReadAloudQueue.spec.ts` | ❌ Wave 0 |
| D-13 | voice streaming files do not import write chokepoints | static | `npx vitest run tests/static/voice-streaming-no-write.spec.ts` | ❌ Wave 0 |
| D-06 | voice_latency_log migration runs; writeVoiceLatencyLog inserts when ARIA_DEBUG=1 | unit | `npx vitest run tests/unit/main/voice/voice-latency-log.spec.ts` | ❌ Wave 0 |
| D-11/D-12 | appendTurn writes interrupted synthetic turn with spokenSoFar | unit | `npx vitest run tests/unit/main/rag/threads.spec.ts` | ✅ (smoke via existing) |
| Handler count | CHANNELS has 149+3=152 entries all registered | unit | `npx vitest run tests/unit/main/ipc/index.spec.ts` | ✅ (invariant must update) |

### Latency Success Criteria (SC2/SC3) — Not Fully Automatable

SC2 (first-audio p50 <~900ms) and SC3 (barge-in cancel <~200ms) cannot be reliably asserted in Vitest unit tests because:
- Kokoro synthesis time depends on WASM/WebGPU runtime (~150-400ms on typical hardware)
- IPC round-trip latency varies by machine
- Audio buffer scheduling has OS-level jitter

**Recommended approach:**
- `voice_latency_log` is the primary SC2 evidence (four-stage timestamps)
- A manual UAT smoke test reads `DIAGNOSTICS_VOICE_LATENCY` and checks p50 < 900ms
- SC3 is measured as: time from PTT keydown to `AudioBufferSourceNode.stop()` call (renderer-only; instrumentable via `performance.now()`)

### Sampling Rate

- **Per task commit:** `npx vitest run tests/unit/main/voice/ tests/unit/renderer/voice/`
- **Per wave merge:** `npx vitest run` (full suite)
- **Phase gate:** Full suite green + SC2/SC3 manual smoke before `/gsd-verify-work`

### Wave 0 Gaps (Must Create Before Implementation)

- [ ] `tests/unit/main/voice/tts-segmenter.spec.ts` — covers D-04 segmenter
- [ ] `tests/unit/main/voice/voice-session-manager.spec.ts` — covers D-03 AbortController + spokenSoFar accumulator
- [ ] `tests/unit/main/voice/voice-latency-log.spec.ts` — covers D-06 migration + write function
- [ ] `tests/unit/renderer/voice/useReadAloudQueue.spec.ts` — covers D-05 queue ordering + cancel
- [ ] `tests/static/voice-streaming-no-write.spec.ts` — covers D-13 read-only ratchet

Extend existing (not create):
- [ ] `tests/unit/renderer/voice/useVoiceSession.spec.ts` — add bargeIn(), pause(), resume() test cases

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | partial | In-memory VoiceSession Map keyed by session id; cleared on session end |
| V4 Access Control | no | Read-only surfaces only; write chokepoints are ratchet-guarded |
| V5 Input Validation | yes | `question.length <= 4096` already enforced by `ask()` — `streamVoiceAnswer` must mirror this cap |
| V6 Cryptography | no | No new crypto; DB encryption unchanged |

### Known Threat Patterns for Phase 16 Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Voice prompt injection via spoken question | Tampering | Same 4KB question cap as `ask()`; no eval of spoken text |
| PII in frontier streamText prompt | Information Disclosure | Local-route-only for Phase 16 voice streaming (Open Question 1); frontier path deferred |
| TTS chunk replay (IPC eavesdrop) | Disclosure | Electron contextBridge — renderer process can only receive from main; no network exposure |
| Barge-in forging abort without PTT | Spoofing | Abort IPC is fire-and-forget; main always honors it — this is intentional (D-02 spec) |
| Write chokepoint import in voice module | Elevation of Privilege | D-13 static ratchet catches at CI |

---

## Sources

### Primary (HIGH confidence)
- `src/renderer/features/voice/useVoiceSession.ts` — verified state machine, `startTurn()` no-op guard (extension point for `bargeIn()`), `HALF_DUPLEX_COOLDOWN_MS`, `VoiceSessionState`/`VoiceSessionActions` interfaces
- `src/renderer/features/voice/tts/useKokoroPlayer.ts` — verified `speak(text)` signature, `KokoroTtsInstance` interface (missing `speed`), AudioContext lifecycle, `onPlaybackStart`/`onPlaybackEnd` callbacks
- `src/main/rag/answer-service.ts` — verified `ask()` uses buffered `llm.generate()` (NOT streamText); `createThread`/`appendTurn`/`getThread` signatures confirmed
- `src/main/rag/answer-llm.ts` — verified `generateObject` usage (NOT streamText); no streaming path exists today
- `src/main/briefing/generate.ts` — verified `generateObject` usage; briefing stored in DB as BriefingPayload
- `src/main/rag/threads.ts` — verified `createThread`, `appendTurn`, `getThread(db, id, {lastN:6})` exact signatures
- `src/main/llm/routingLog.ts` — verified `writeRoutingLog` pattern for D-06 telemetry analog
- `src/main/ipc/voice.ts` — verified `VOICE_CANCEL_TTS` is currently a pure ack stub; `emitToRenderer` pattern confirmed
- `src/preload/index.ts` — verified push channel pattern (lines 54-58, `VOICE_TRANSCRIPT_DELTA`)
- `src/shared/ipc-contract.ts` — verified 149 existing CHANNELS; `CHANNEL_METHODS` mapping pattern; existing `AriaApi` push subscription shape
- `tests/static/voice-routes-through-staging.spec.ts` — D-13 ratchet template (walk + stripComments + identifier RE)
- `tests/static/chokepoint-caller-allow-list.spec.ts` — chokepoint allow-list pattern
- `tests/unit/main/ipc/index.spec.ts` — handler count invariant (149 = `Object.keys(CHANNELS).length`)
- `node_modules/kokoro-js/types/kokoro.d.ts` — verified `generate({ voice, speed })` signature; `speed?: number` confirmed; `stream()` API noted
- `node_modules/ai/dist/index.d.ts` — verified `streamText` `abortSignal`, `onChunk`, `onAbort`, `textStream`, `fullStream` surface in ai@6.0.185
- `package.json` — verified `ai@^6.0.0` (installed 6.0.185, NOT v5); `kokoro-js@^1.2.1`; no new deps needed

### Secondary (MEDIUM confidence)
- AI SDK GitHub issue #8088 (onAbort redirect to onError on fast abort) — referenced in CONTEXT.md D-03; behavior verified by inspecting `onError` default handler in streamText source: `onError = ({ error }) => { console.error(error) }` — confirms error path exists parallel to abort path [CITED: src inspection]

### Tertiary (LOW confidence / ASSUMED)
- Speed range 0.5–2x operating range: StyleTTS2 duration-scaling behavior described in D-08 / CONTEXT.md; not independently verified against kokoro-js source [ASSUMED per CONTEXT.md D-08]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all library versions verified from node_modules
- Architecture: HIGH — all integration points verified from source files
- Pitfalls: HIGH — most pitfalls derived from verified code inspection; one ASSUMED (speed artifacts)
- API signatures: HIGH — verified from type definitions in node_modules

**Research date:** 2026-06-07
**Valid until:** 2026-07-07 (30 days — stable library versions)
