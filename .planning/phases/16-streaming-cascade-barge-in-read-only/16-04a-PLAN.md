---
phase: 16-streaming-cascade-barge-in-read-only
plan: 04a
type: execute
wave: 2
depends_on: [16-02, 16-03]
files_modified:
  - src/main/voice/voice-session-manager.ts
  - src/main/ipc/voice.ts
autonomous: true
requirements: [VOICE-02, VOICE-03, VOICE-06]

must_haves:
  truths:
    # D-03/D-11/D-12 session manager — BLOCKER 3 fix: behavioral spec verify
    - "VoiceSessionManager holds a Map of sessionId→{threadId, spokenSoFar, t_* timestamps} per D-11; threadId created via createThread on first voice turn"
    - "On barge-in (VOICE_ABORT), the manager calls onBargeIn() which writes a synthetic [interrupted: spokenSoFar] assistant turn via appendTurn before the next user turn per D-12"
    - "streamVoiceAnswer onChunk feeds TtsSegmenter.push() and emits VOICE_TTS_CHUNK to renderer per D-04/D-05"
    - "writeVoiceLatencyLog called after stream completes with t_stt_done, t_llm_first_token, t_first_sentence_ready (all main-process timestamps) per D-06; t_kokoro_synth_start and t_first_audio_out populated from VOICE_LATENCY_MARK IPC marks (WARNING 2 fix)"
    # D-02/D-03 abort wiring
    - "VOICE_ABORT IPC handler calls sessionAbortControllers.get(sessionId)?.abort() AND voiceSessionManager?.onBargeIn({sessionId}) per D-02/D-03 — stub upgraded to real wiring"
    - "VOICE_FEED_ANSWER IPC handler stub upgraded to real call: validates payload, calls voiceSessionManager.startAnswer({sessionId, question}) per D-03"
    # VOICE_LATENCY_MARK handler (WARNING 2 fix)
    - "VOICE_LATENCY_MARK handler upgraded from no-op to real: looks up VoiceSession by sessionId and stores the t_kokoro_synth_start or t_first_audio_out mark so DIAGNOSTICS_VOICE_LATENCY returns populated rows"
  artifacts:
    - path: "src/main/voice/voice-session-manager.ts"
      provides: "VoiceSessionManager factory — streaming loop, TTS chunk push, latency logging (incl. renderer timing marks), thread persistence (D-03/D-06/D-11/D-12)"
      contains: "VoiceSessionManager"
    - path: "src/main/ipc/voice.ts"
      provides: "VOICE_ABORT + VOICE_FEED_ANSWER + VOICE_LATENCY_MARK handlers upgraded from stubs to real wiring (D-02/D-03)"
      contains: "sessionAbortControllers"
  key_links:
    - from: "src/main/voice/voice-session-manager.ts streamVoiceAnswer"
      to: "renderer VOICE_TTS_CHUNK push channel"
      via: "emitToRenderer(CHANNELS.VOICE_TTS_CHUNK, {text:chunk, sessionId})"
      pattern: "VOICE_TTS_CHUNK"
    - from: "src/main/voice/voice-session-manager.ts onBargeIn()"
      to: "appendTurn (D-12 synthetic interrupted turn)"
      via: "appendTurn(db, { threadId, role:'assistant', text:'[interrupted: \"...\"]', routing })"
      pattern: "interrupted"
    - from: "src/main/ipc/voice.ts VOICE_LATENCY_MARK handler"
      to: "src/main/voice/voice-session-manager.ts VoiceSession timing fields"
      via: "voiceSessionManager.markLatency({ sessionId, mark, t }) — updates session.t_kokoro_synth_start or t_first_audio_out"
      pattern: "VOICE_LATENCY_MARK"
---

<objective>
Implement the main-process half of the streaming cascade integration: create
VoiceSessionManager (the orchestrator that ties TtsSegmenter + streamVoiceAnswer + VOICE_TTS_CHUNK
push + thread persistence + latency logging together), and upgrade the voice.ts stub handlers
(VOICE_ABORT, VOICE_FEED_ANSWER, VOICE_LATENCY_MARK) from their Wave-0 no-ops to real wiring.

This plan covers only src/main/ files — zero overlap with Plan 16-04b (renderer). Both 16-04a
and 16-04b depend on [16-02, 16-03] and run in parallel in Wave 2.

BLOCKER 3 fix: this plan's VoiceSessionManager task verifies by running
tests/unit/main/voice/voice-session-manager.spec.ts (created RED in 16-01 Task 3), turning
it GREEN. The spec proves SC3 (onChunk accumulator) + SC4 (D-12 interrupted turn) via
automated assertions — not typecheck alone.

WARNING 2 fix: VOICE_LATENCY_MARK handler stores t_kokoro_synth_start and t_first_audio_out
from renderer timing marks into the in-memory VoiceSession, so when writeVoiceLatencyLog
fires on stream completion, all four t_* columns are populatable.

Output: voice-session-manager.ts (new), voice.ts VOICE_ABORT + VOICE_FEED_ANSWER +
VOICE_LATENCY_MARK upgraded, voice-session-manager.spec.ts turned GREEN.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/16-streaming-cascade-barge-in-read-only/16-CONTEXT.md
@.planning/phases/16-streaming-cascade-barge-in-read-only/16-RESEARCH.md
@.planning/phases/16-streaming-cascade-barge-in-read-only/16-PATTERNS.md
@.planning/phases/16-streaming-cascade-barge-in-read-only/16-01-SUMMARY.md
@.planning/phases/16-streaming-cascade-barge-in-read-only/16-02-SUMMARY.md
@.planning/phases/16-streaming-cascade-barge-in-read-only/16-03-SUMMARY.md

<interfaces>
<!-- Key contracts from Plans 16-01/16-02/16-03 that this plan wires together. -->

From Plan 16-02 (now implemented):
  streamVoiceAnswer(deps, { db, question, threadId, signal, onChunk, onDone }): Promise<void>
  writeVoiceLatencyLog(db, { session_id, t_stt_done, t_llm_first_token, t_first_sentence_ready, t_kokoro_synth_start, t_first_audio_out }): void
  TtsSegmenter.push(delta: string): string[]
  TtsSegmenter.flush(): string

From Plan 16-03 (now implemented):
  useReadAloudQueue(player: KokoroPlayerHandle, speed: number) → { enqueue(text): void; cancel(): void }
  useVoiceSession extended with: bargeIn(), pause(), resume(), paused: boolean
  KokoroPlayerHandle.speak(text, { speed? }): Promise<void>
  KokoroPlayerHandle.suspend(): void    — WARNING 3 fix: now a known interface
  KokoroPlayerHandle.resume(): void     — WARNING 3 fix: now a known interface

From Plan 16-01 (Wave-0 stubs, to be upgraded here):
  CHANNELS.VOICE_TTS_CHUNK, VOICE_ABORT, DIAGNOSTICS_VOICE_LATENCY, VOICE_FEED_ANSWER, VOICE_LATENCY_MARK
  VoiceHandlersDeps.sessionAbortControllers?: Map<string, AbortController>
  VoiceHandlersDeps.voiceSessionManager?: { startAnswer, onBargeIn } (declared in 16-01 stub)

From src/main/rag/threads.ts (VERIFIED):
  createThread(db, { title? }): ThreadRow
  appendTurn(db, { threadId, role, text, routing? }): TurnRow
  getThread(db, threadId, { lastN: 6 }): { thread, turns } | null

From src/main/ipc/voice.ts (current, after 16-01 stubs):
  VoiceHandlersDeps has sessionAbortControllers + voiceSessionManager declared as optional
  VOICE_ABORT stub: already calls deps.sessionAbortControllers?.get(sessionId)?.abort() AND
  deps.voiceSessionManager?.onBargeIn({sessionId}) — upgrade means the manager is now real
  VOICE_FEED_ANSWER stub: calls deps.voiceSessionManager?.startAnswer({sessionId, question}) — same
  VOICE_LATENCY_MARK stub: currently no-op — upgrade to call manager.markLatency({sessionId,mark,t})

VoiceSession record (new type in voice-session-manager.ts):
  { threadId: string; spokenSoFar: string; startMs: number; t_stt_done: number;
    t_llm_first_token: number | null; t_first_sentence_ready: number | null;
    t_kokoro_synth_start: number | null; t_first_audio_out: number | null }

VoiceSessionManagerDeps:
  { db: Db; logger: Logger; embedClient: EmbedClient; vectorStore: VectorStore;
    emitToRenderer: (channel: string, payload?: unknown) => void;
    sessionAbortControllers: Map<string, AbortController> }

VoiceSessionManager API (returned by createVoiceSessionManager(deps)):
  startAnswer({ sessionId: string; question: string }): Promise<void>
  onBargeIn({ sessionId: string }): void
  markLatency({ sessionId: string; mark: 'kokoro_synth_start' | 'first_audio_out'; t: number }): void
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: VoiceSessionManager + voice.ts VOICE_ABORT/VOICE_FEED_ANSWER/VOICE_LATENCY_MARK wiring</name>
  <files>src/main/voice/voice-session-manager.ts, src/main/ipc/voice.ts, tests/unit/main/voice/voice-session-manager.spec.ts</files>
  <behavior>
    - onChunk accumulator: spokenSoFar populates as text-deltas arrive via the onChunk callback (not onAbort, per AI SDK #8088)
    - fast abort does NOT clear the accumulator: aborting mid-stream still yields the accumulated spokenSoFar at the time of abort
    - onBargeIn writes a synthetic [interrupted: "spokenSoFar..."] assistant turn via appendTurn (D-12)
    - startAnswer creates a rag thread on first call, emits VOICE_TTS_CHUNK per TtsSegmenter chunk
    - markLatency({sessionId, mark:'kokoro_synth_start', t}) stores t in session.t_kokoro_synth_start (WARNING 2)
    - markLatency({sessionId, mark:'first_audio_out', t}) stores t in session.t_first_audio_out (WARNING 2)
  </behavior>
  <read_first>
    - src/main/rag/answer-service.ts (confirm streamVoiceAnswer is exported and its deps Pick shape)
    - src/main/voice/tts-segmenter.ts (confirm TtsSegmenter class API: push/flush)
    - src/main/voice/voice-latency-log.ts (confirm writeVoiceLatencyLog signature)
    - src/main/ipc/voice.ts (FULL FILE — understand current stub handlers after 16-01; VoiceHandlersDeps; emitToRenderer; registerVoiceHandlers structure)
    - src/main/rag/threads.ts (createThread, appendTurn, getThread exact signatures)
    - tests/unit/main/voice/voice-session-manager.spec.ts (the Wave-0 RED scaffold — update it to test the real implementation)
    - .planning/phases/16-streaming-cascade-barge-in-read-only/16-PATTERNS.md (§ voice-session-manager.ts — DI factory pattern; § Thread Persistence shared pattern; § voice.ts Phase 16 additions)
    - .planning/phases/16-streaming-cascade-barge-in-read-only/16-RESEARCH.md (§ System Architecture Diagram — the full data flow; § Pattern 7 D-11/D-12 multi-turn context; § AI SDK #8088)
  </read_first>
  <action>
    Create src/main/voice/voice-session-manager.ts as a DI factory. Define VoiceSessionManagerDeps
    and VoiceSession types as shown in the interfaces block above.

    createVoiceSessionManager(deps) returns { startAnswer, onBargeIn, markLatency }:

    startAnswer({ sessionId, question }): Promise<void> — the main streaming loop:
      1. Look up session in sessions Map<string,VoiceSession>. If not found, create a new
      rag_thread (createThread(db, { title: '(voice)' })) and init the session record with
      startMs=Date.now(), spokenSoFar='', all t_* = null.
      2. Record session.t_stt_done = Date.now() - session.startMs.
      3. Create a new AbortController; store it in deps.sessionAbortControllers.set(sessionId, controller).
      4. Create a new TtsSegmenter instance.
      5. Declare let spokenSoFar = '' inside startAnswer (the onChunk accumulator — D-03/AI SDK #8088:
      lives here, NOT in onAbort/onError).
      6. Call streamVoiceAnswer({ db: deps.db, embedClient: deps.embedClient, vectorStore: deps.vectorStore },
      { db: deps.db, question, threadId: session.threadId, signal: controller.signal,
      onChunk: (delta) => {
        spokenSoFar += delta;
        session.spokenSoFar = spokenSoFar;  // keep session ref current for onBargeIn
        const chunks = segmenter.push(delta);
        for (const chunk of chunks) {
          if (!session.t_llm_first_token) session.t_llm_first_token = Date.now() - session.startMs;
          if (!session.t_first_sentence_ready) session.t_first_sentence_ready = Date.now() - session.startMs;
          deps.emitToRenderer(CHANNELS.VOICE_TTS_CHUNK, { text: chunk, sessionId });
        }
      },
      onDone: (fullText) => {
        const remaining = segmenter.flush();
        if (remaining) deps.emitToRenderer(CHANNELS.VOICE_TTS_CHUNK, { text: remaining, sessionId });
        session.spokenSoFar = fullText;
        writeVoiceLatencyLog(db, { session_id: sessionId, t_stt_done: session.t_stt_done,
          t_llm_first_token: session.t_llm_first_token, t_first_sentence_ready: session.t_first_sentence_ready,
          t_kokoro_synth_start: session.t_kokoro_synth_start, t_first_audio_out: session.t_first_audio_out });
        deps.sessionAbortControllers.delete(sessionId);
        sessions.delete(sessionId);
      } }).catch((err) => { deps.logger?.warn({ err }, 'voice session error'); });

    onBargeIn({ sessionId }): void —
      1. Get the session from sessions Map. If no session, return.
      2. Write the interrupted synthetic turn: appendTurn(db, { threadId: session.threadId,
      role: 'assistant', text: '[interrupted: "' + session.spokenSoFar + '…"]',
      routing: { route: 'LOCAL', reason: 'voice-barge-in', sensitivity: 'none' } }) per D-12.
      (The AbortController.abort() is handled by the VOICE_ABORT IPC handler directly — onBargeIn
      handles only thread persistence.)

    markLatency({ sessionId, mark, t }): void —
      1. Get the session from sessions Map. If not found, return.
      2. If mark === 'kokoro_synth_start' and session.t_kokoro_synth_start is null, set it to t.
      3. If mark === 'first_audio_out' and session.t_first_audio_out is null, set it to t.

    In src/main/ipc/voice.ts:
    - Add markLatency method to the VoiceHandlersDeps.voiceSessionManager type declaration (alongside
    startAnswer and onBargeIn).
    - Upgrade VOICE_LATENCY_MARK handler from no-op to:
    deps.voiceSessionManager?.markLatency({ sessionId: req.sessionId, mark: req.mark, t: req.t });
    return undefined.
    The VOICE_ABORT and VOICE_FEED_ANSWER stubs from 16-01 already call onBargeIn and startAnswer
    correctly — no change needed to those (the manager is now real so the optional-chaining calls
    resolve to real implementations).
    - Wire createVoiceSessionManager into registerVoiceHandlers: create an instance inside the
    function body (or accept it via deps) and assign it to deps.voiceSessionManager so the stubs
    resolve. Match how the existing Phase 15 session manager or similar DI is wired — find the
    pattern in registerVoiceHandlers or its callers in ipc/index.ts.

    Update tests/unit/main/voice/voice-session-manager.spec.ts to test the real implementation.
    All 6 behavior cases above must pass. Mock streamVoiceAnswer, appendTurn, createThread,
    TtsSegmenter, and writeVoiceLatencyLog with vi.fn(). For the onChunk accumulator test: call
    the mocked streamVoiceAnswer's onChunk callback directly with text deltas and verify
    session.spokenSoFar updates. For the fast-abort test: abort the controller after 2 onChunk
    calls and verify spokenSoFar still holds the accumulated text (NOT cleared). For the D-12 test:
    set session.spokenSoFar = 'Hello world', call onBargeIn, verify appendTurn was called with
    text containing '[interrupted:' and 'Hello world'.

    Run: npx vitest run tests/unit/main/voice/voice-session-manager.spec.ts --no-file-parallelism
  </action>
  <verify>
    <automated>npx vitest run tests/unit/main/voice/voice-session-manager.spec.ts --no-file-parallelism</automated>
  </verify>
  <acceptance_criteria>
    - source: grep "createVoiceSessionManager\|VoiceSessionManagerDeps" src/main/voice/voice-session-manager.ts confirms DI factory
    - source: grep "appendTurn.*interrupted\|interrupted.*appendTurn" src/main/voice/voice-session-manager.ts confirms D-12 synthetic barge-in turn
    - source: grep "TtsSegmenter\|segmenter\.push" src/main/voice/voice-session-manager.ts confirms D-04 segmenter integration
    - source: grep "VOICE_TTS_CHUNK" src/main/voice/voice-session-manager.ts confirms push to renderer per D-05
    - source: grep "writeVoiceLatencyLog" src/main/voice/voice-session-manager.ts confirms D-06 latency log call in onDone
    - source: grep "markLatency\|t_kokoro_synth_start\|t_first_audio_out" src/main/voice/voice-session-manager.ts confirms WARNING 2 fix (timing marks stored)
    - source: grep "markLatency\|VOICE_LATENCY_MARK" src/main/ipc/voice.ts confirms VOICE_LATENCY_MARK handler upgraded
    - test-command: npx vitest run tests/unit/main/voice/voice-session-manager.spec.ts --no-file-parallelism PASSES (all 3+ it() blocks green, incl. onChunk accumulator + fast-abort accumulator safety + D-12 interrupted turn)
    - test-command: pnpm typecheck exits 0
  </acceptance_criteria>
  <done>VoiceSessionManager factory created; streaming loop feeds TtsSegmenter→VOICE_TTS_CHUNK; D-12 interrupted turn on barge-in; D-06 latency log on stream done with all four t_* columns populatable via markLatency; VOICE_LATENCY_MARK handler wired; voice-session-manager.spec.ts GREEN (SC3/SC4 automated coverage confirmed).</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| STT transcript → VOICE_FEED_ANSWER IPC | Question text crosses renderer→main; length-capped at 4096 in streamVoiceAnswer |
| main streamText → renderer VOICE_TTS_CHUNK | LLM output crosses main→renderer as plain text; no PII since LOCAL-only |
| renderer VOICE_LATENCY_MARK → main VoiceSession | Timing integers cross renderer→main; stored only in debug-gated latency log |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-16-10 | Tampering | VOICE_FEED_ANSWER question payload | mitigate | 4096-char cap in streamVoiceAnswer; question treated as data in prompt template (no eval) |
| T-16-11 | Information Disclosure | VOICE_TTS_CHUNK over IPC | accept | IPC uses Electron contextBridge — renderer-only receiver; no network exposure; LOCAL-only LLM output |
| T-16-12 | Denial of Service | Promise-chain queue growing unbounded on slow Kokoro | mitigate | Session manager deletes session on stream done; barge-in cancels queue; natural backpressure in promise chain throttles emits |
| T-16-13 | Elevation of Privilege | VoiceSessionManager calling assertApproved/write paths | mitigate | D-13 static ratchet (Plan 16-05) catches any import of write chokepoints; read-only surfaces (ask/briefing) have no write path to call |
</threat_model>

<verification>
- npx vitest run tests/unit/main/voice/voice-session-manager.spec.ts --no-file-parallelism: GREEN (BLOCKER 3 resolved — behavioral spec, not just typecheck).
- npx vitest run tests/unit/main/ipc/index.spec.ts --no-file-parallelism: still passes (handler count unchanged — 5 channels + 5 handlers from 16-01).
- pnpm typecheck exits 0 after Task 1.
- grep "markLatency" src/main/ipc/voice.ts confirms VOICE_LATENCY_MARK upgrade.
</verification>

<success_criteria>
- VoiceSessionManager orchestrates streaming loop: TtsSegmenter → VOICE_TTS_CHUNK push → latency log (all 4 t_* columns via markLatency); D-12 interrupted turn on barge-in; D-11 thread persistence per turn.
- VOICE_ABORT, VOICE_FEED_ANSWER, VOICE_LATENCY_MARK stubs upgraded to real wiring in voice.ts.
- voice-session-manager.spec.ts GREEN: onChunk accumulator + fast-abort safety + D-12 interrupted turn all pass as automated assertions (SC3/SC4 coverage path confirmed).
</success_criteria>

<output>
After completion, create `.planning/phases/16-streaming-cascade-barge-in-read-only/16-04a-SUMMARY.md`
</output>
