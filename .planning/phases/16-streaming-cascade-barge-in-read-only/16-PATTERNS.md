# Phase 16: Streaming Cascade + Barge-in (read-only) - Pattern Map

**Mapped:** 2026-06-07
**Files analyzed:** 15 (9 modify, 6 new + 3 test files)
**Analogs found:** 15 / 15

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/shared/ipc-contract.ts` | config | request-response | self (CHANNELS + CHANNEL_METHODS + AriaApi for Phase 15 voice additions) | exact |
| `src/preload/index.ts` | middleware | event-driven | self (Phase 15 onVoiceTranscript/onVoiceState/onVoiceModelProgress push overrides) | exact |
| `src/main/ipc/voice.ts` | controller | request-response | self (Phase 15 registerVoiceHandlers + VOICE_CANCEL_TTS stub pattern) | exact |
| `src/main/ipc/diagnostics.ts` | controller | request-response | self (DIAGNOSTICS_ROUTING_LOG handler) | exact |
| `src/main/ipc/index.ts` | config | request-response | self (existing registerHandlers + db-null skip-set pattern) | exact |
| `src/renderer/features/voice/useVoiceSession.ts` | hook | event-driven | self (Phase 15 createVoiceSessionStore factory, VoiceSessionState, VoiceSessionActions) | exact |
| `src/renderer/features/voice/tts/useKokoroPlayer.ts` | hook | event-driven | self (Phase 15 KokoroTtsInstance, createKokoroPlayer, speak()) | exact |
| `src/renderer/features/voice/VoiceHUDBand.tsx` | component | event-driven | self (Phase 15 VoiceHUDBand per-state copy + CSS) | exact |
| `src/main/rag/answer-service.ts` | service | streaming | `src/main/rag/answer-service.ts` ask() + `src/main/briefing/generate.ts` streamText pattern | role-match |
| `src/main/db/migrations/embedded.ts` | config | batch | self (version 135 tail of EMBEDDED_MIGRATIONS array) | exact |
| `src/main/voice/voice-session-manager.ts` | service | streaming | `src/main/rag/answer-service.ts` (createAnswerService DI + ask() flow) | role-match |
| `src/main/voice/tts-segmenter.ts` | utility | transform | `src/main/llm/routingLog.ts` (stateless pure utility, no deps) | partial |
| `src/main/voice/voice-latency-log.ts` | utility | CRUD | `src/main/llm/routingLog.ts` (writeRoutingLog / readRecentRoutingLog) | exact |
| `src/main/db/migrations/136_voice_latency_log.sql` | migration | batch | `src/main/db/migrations/134_voice_explicit_path.sql` (shape) + routing_log DDL in migration 001 | role-match |
| `src/renderer/features/voice/useReadAloudQueue.ts` | hook | event-driven | `src/renderer/features/voice/tts/useKokoroPlayer.ts` (createKokoroPlayer / useKokoroPlayer) | role-match |
| `tests/static/voice-streaming-no-write.spec.ts` | test | — | `tests/static/voice-routes-through-staging.spec.ts` | exact |
| `tests/unit/main/voice/tts-segmenter.spec.ts` | test | — | any existing `tests/unit/main/` spec (Vitest, no electron mock needed) | role-match |
| `tests/unit/main/voice/voice-session-manager.spec.ts` | test | — | `tests/unit/main/rag/` specs (async service test with DI) | role-match |
| `tests/unit/renderer/voice/useReadAloudQueue.spec.ts` | test | — | `tests/unit/renderer/voice/useVoiceSession.spec.ts` (renderer hook test) | role-match |

---

## Pattern Assignments

### `src/shared/ipc-contract.ts` (config, extend)

**Analog:** `src/shared/ipc-contract.ts` lines 183–192, 1317–1473 (Phase 15 additions are the exact template)

**CHANNELS additions pattern** (lines 183–192):
```typescript
// Phase 15 — Voice I/O + Model Runtime (15-01)
// Invoke channels (renderer → main):
VOICE_FEED_AUDIO: 'aria:voice:feed-audio',
VOICE_GET_MODEL_STATUS: 'aria:voice:model-status',
VOICE_DOWNLOAD_MODEL: 'aria:voice:download-model',
VOICE_CANCEL_TTS: 'aria:voice:cancel-tts',
// Push channels (main → renderer via ipcRenderer.on):
VOICE_TRANSCRIPT_DELTA: 'aria:voice:transcript-delta',
VOICE_STATE_CHANGED: 'aria:voice:state-changed',
VOICE_MODEL_PROGRESS: 'aria:voice:model-progress',
```

**Phase 16 CHANNELS to add** (same block, after `VOICE_MODEL_PROGRESS`):
```typescript
// Phase 16 — Streaming cascade + barge-in (16-01)
// Push channel (main → renderer):
VOICE_TTS_CHUNK: 'aria:voice:tts-chunk',
// Invoke channels (renderer → main):
VOICE_ABORT: 'aria:voice:abort',
DIAGNOSTICS_VOICE_LATENCY: 'aria:diagnostics:voice-latency',
```

**CHANNEL_METHODS additions pattern** (lines 1466–1473):
```typescript
VOICE_FEED_AUDIO: 'voiceFeedAudio',
VOICE_GET_MODEL_STATUS: 'voiceGetModelStatus',
VOICE_DOWNLOAD_MODEL: 'voiceDownloadModel',
VOICE_CANCEL_TTS: 'voiceCancelTts',
VOICE_TRANSCRIPT_DELTA: 'onVoiceTranscript',
VOICE_STATE_CHANGED: 'onVoiceState',
VOICE_MODEL_PROGRESS: 'onVoiceModelProgress',
```

**Phase 16 CHANNEL_METHODS to add** (same pattern):
```typescript
VOICE_TTS_CHUNK: 'onVoiceTtsChunk',
VOICE_ABORT: 'voiceAbort',
DIAGNOSTICS_VOICE_LATENCY: 'diagnosticsVoiceLatency',
```

**AriaApi push subscription addition pattern** (lines 1073–1075):
```typescript
onVoiceTranscript?: (cb: (delta: TranscriptDelta) => void) => () => void;
onVoiceState?: (cb: (state: VoiceState) => void) => () => void;
onVoiceModelProgress?: (cb: (progress: { receivedBytes: number; totalBytes: number }) => void) => () => void;
```

**Phase 16 AriaApi methods to add** (same section, after `onVoiceModelProgress`):
```typescript
voiceAbort(req: { sessionId: string }): Promise<{ ok: true } | IpcError>;
diagnosticsVoiceLatency(req?: { limit?: number }): Promise<VoiceLatencyLogRow[] | IpcError>;
onVoiceTtsChunk?: (cb: (chunk: { text: string; sessionId: string }) => void) => () => void;
```

**Handler count invariant:** `tests/unit/main/ipc/index.spec.ts` line 77 asserts `handlers.size === Object.keys(CHANNELS).length`. Currently: 149 channels. After Phase 16: 152. The test WILL fail until all 3 new CHANNELS have registered handlers.

---

### `src/preload/index.ts` (middleware, extend)

**Analog:** `src/preload/index.ts` lines 54–73 (Phase 15 push channel overrides)

**Push subscription override pattern** (lines 54–59, verbatim template to copy):
```typescript
(api as unknown as Record<string, ((cb: (d: unknown) => void) => () => void)>)
  .onVoiceTranscript = (cb: (d: unknown) => void) => {
  const handler = (_e: unknown, d: unknown) => cb(d);
  ipcRenderer.on(CHANNELS.VOICE_TRANSCRIPT_DELTA, handler);
  return () => ipcRenderer.removeListener(CHANNELS.VOICE_TRANSCRIPT_DELTA, handler);
};
```

**Phase 16 addition** (copy this block, replacing method name and CHANNEL key):
```typescript
// Phase 16 / Plan 16-01 — Voice TTS chunk push channel.
(api as unknown as Record<string, ((cb: (d: unknown) => void) => () => void)>)
  .onVoiceTtsChunk = (cb: (d: unknown) => void) => {
  const handler = (_e: unknown, d: unknown) => cb(d);
  ipcRenderer.on(CHANNELS.VOICE_TTS_CHUNK, handler);
  return () => ipcRenderer.removeListener(CHANNELS.VOICE_TTS_CHUNK, handler);
};
```

**Note:** `VOICE_ABORT` and `DIAGNOSTICS_VOICE_LATENCY` are invoke-direction channels — they are auto-mapped by `buildApi()` and need NO manual override in preload, exactly like `VOICE_CANCEL_TTS` and `VOICE_FEED_AUDIO`.

---

### `src/main/ipc/voice.ts` (controller, extend)

**Analog:** `src/main/ipc/voice.ts` lines 47–148 (all four existing handlers)

**Handler registration pattern** (lines 63–106, VOICE_FEED_AUDIO as template):
```typescript
ipcMain.handle(CHANNELS.VOICE_FEED_AUDIO, async (_e, payload: unknown) => {
  try {
    // ... payload handling ...
    deps.emitToRenderer?.(CHANNELS.VOICE_STATE_CHANGED, { state: 'listening' });
    deps.emitToRenderer?.(CHANNELS.VOICE_TRANSCRIPT_DELTA, delta);
    return { ok: true, delta };
  } catch (err) {
    logger.warn(
      { scope: 'voice.feedAudio', err: (err as Error).message },
      'feedAudio handler threw',
    );
    deps.emitToRenderer?.(CHANNELS.VOICE_STATE_CHANGED, { state: 'error' });
    return { ok: false, error: (err as Error).message };
  }
});
```

**VOICE_CANCEL_TTS stub pattern** (lines 144–147) — this is what VOICE_ABORT replaces/extends:
```typescript
// ─── VOICE_CANCEL_TTS ────────────────────────────────────────────────────────
//
// TTS playback lives entirely in the renderer (kokoro-js / useKokoroPlayer).
// This handler acks the cancel intent so the renderer can gate the half-duplex
// mic signal. Currently a pure ack; Phase 17 may add write-side state.
ipcMain.handle(CHANNELS.VOICE_CANCEL_TTS, async () => {
  return { ok: true };
});
```

**Phase 16 additions to VoiceHandlersDeps** (add to the existing interface):
```typescript
export interface VoiceHandlersDeps {
  logger: Logger;
  dbHolder: DbHolder;
  sttSidecar: SttSidecarManager;
  downloadController: ModelDownloadController;
  emitToRenderer?: (channel: string, payload?: unknown) => void;
  // Phase 16 additions:
  /** Map of sessionId → AbortController for active streaming turns. */
  sessionAbortControllers?: Map<string, AbortController>;
}
```

**Phase 16 VOICE_ABORT handler** (fire-and-forget abort, mirrors VOICE_CANCEL_TTS shape):
```typescript
// ─── VOICE_ABORT ─────────────────────────────────────────────────────────────
//
// D-02: renderer fires this one-way after AudioBufferSourceNode.stop().
// Main aborts the streamText AbortController for the session — races
// independently of renderer audio cancel (~5ms). NOT awaited by renderer.
ipcMain.handle(CHANNELS.VOICE_ABORT, async (_e, payload: unknown) => {
  const req = (payload ?? {}) as { sessionId?: string };
  if (req.sessionId && deps.sessionAbortControllers) {
    deps.sessionAbortControllers.get(req.sessionId)?.abort();
  }
  return { ok: true as const };
});
```

**Phase 16 DIAGNOSTICS_VOICE_LATENCY handler** (mirrors `src/main/ipc/diagnostics.ts` DIAGNOSTICS_ROUTING_LOG):
```typescript
// ─── DIAGNOSTICS_VOICE_LATENCY ───────────────────────────────────────────────
//
// D-06: read voice_latency_log rows. Debug-only; ARIA_DEBUG=1 required for
// any rows to exist. Mirrors DIAGNOSTICS_ROUTING_LOG handler shape exactly.
ipcMain.handle(CHANNELS.DIAGNOSTICS_VOICE_LATENCY, async (_e, payload: unknown) => {
  const req = (payload ?? {}) as { limit?: number };
  const limit = typeof req.limit === 'number' && req.limit > 0 ? req.limit : 100;
  const db = deps.dbHolder.db;
  if (!db) {
    return [];
  }
  try {
    return readRecentVoiceLatencyLog(db, limit);
  } catch (e) {
    return { error: (e as Error).message };
  }
});
```

---

### `src/main/rag/answer-service.ts` (service, extend — add streamVoiceAnswer)

**Analog:** `src/main/rag/answer-service.ts` lines 231–355 (`ask()` function body)

**Existing ask() DI signature** (lines 214–216, 218–230):
```typescript
export interface AnswerService {
  ask(req: RagAskRequest): Promise<RagAskResponse>;
}

export function createAnswerService(deps: AnswerServiceDeps): AnswerService {
  const { db, logger, embedClient, vectorStore, localLlm, llm, accountStatus, ... } = deps;

  async function ask(req: RagAskRequest): Promise<RagAskResponse> {
    // 1. Validate question length (ASVS V5 — 4 KB cap).
    if (req.question.length > 4096) {
      return { kind: 'error', text: ERROR_TEXT, detail: 'question-too-long' };
    }
    // 3. hybridRetrieve
    // 5. getThread(db, threadId, { lastN: 6 })
    // 6. routeAnswer() → buildFrontierPrompt / buildLocalPrompt
    // 7. llm.generate({ prompt, route, requestKey })
    // 8. appendTurn (user) + appendTurn (assistant)
  }
```

**Thread history loading pattern** (lines 328–333):
```typescript
// 5. Thread history for C6.
let threadHistory: ThreadTurnSummary[] = [];
if (req.threadId) {
  const t = getThread(db, req.threadId, { lastN: 6 });
  if (t) threadHistory = t.turns.map((tr) => ({ role: tr.role, text: tr.text }));
}
```

**Route + prompt build pattern** (lines 336–355):
```typescript
const routerChunks = retrieved.map(asRouterChunk);
const decision = routeAnswer(rewrittenQuestion, routerChunks);

let prompt: string;
if (decision.route === 'FRONTIER') {
  prompt = buildFrontierPrompt(
    { question: rewrittenQuestion, chunks: routerChunks, threadHistory },
    (s) => {
      const { prompt: redacted } = tokenizeForFrontier(requestKey, s);
      return redacted;
    },
  );
} else {
  prompt = buildLocalPrompt({
    question: rewrittenQuestion,
    chunks: routerChunks,
    threadHistory,
  });
}
```

**appendTurn pattern** (lines 313–320):
```typescript
appendTurn(db, { threadId, role: 'user', text: req.question });
const refusalTurn = appendTurn(db, {
  threadId,
  role: 'assistant',
  text: REFUSAL_TEXT,
  routing: { route: 'LOCAL', reason: 'rag-answer:no-sources', sensitivity: 'none' },
});
```

**Phase 16 streamVoiceAnswer signature** (add alongside `ask()`, scope to LOCAL route only per Open Question 1):
```typescript
// New export added to answer-service.ts alongside ask().
// D-03/D-04/D-05 streaming path for VOICE-03. Citations omitted (trade-off for
// streaming). PII-guarded: scoped to LOCAL route only (Pitfall 8 mitigation).
export interface StreamVoiceAnswerArgs {
  db: DbAny;
  question: string;
  threadId: string;
  signal: AbortSignal;
  onChunk: (textDelta: string) => void;  // D-03: spokenSoFar accumulator feeds here
  onDone: (fullText: string) => void;    // called after stream ends for appendTurn
}

export async function streamVoiceAnswer(
  deps: Pick<AnswerServiceDeps, 'db' | 'embedClient' | 'vectorStore'>,
  args: StreamVoiceAnswerArgs,
): Promise<void>
```

**streamText call pattern** (from `ai@6.0.185`, mirrors the pattern established in `briefing/generate.ts` but using `streamText` instead of `generateObject`):
```typescript
import { streamText } from 'ai';

const result = streamText({
  model,                        // getLocalModel() — LOCAL-only for Phase 16
  prompt,                       // buildLocalPrompt({ question, chunks, threadHistory })
  abortSignal: args.signal,     // D-03 AbortController
  onChunk: ({ chunk }) => {     // D-03: accumulate spokenSoFar synchronously
    if (chunk.type === 'text-delta') {
      spokenSoFar += chunk.textDelta;
      args.onChunk(chunk.textDelta);
    }
  },
  onError: ({ error }) => {     // AI SDK #8088: fast abort redirects here
    // spokenSoFar is in accumulator above — safe to use regardless
    void error;
  },
});

// Drain the stream (for onChunk to fire)
for await (const _ of result.textStream) { /* consumed via onChunk */ }
// After stream: persist turn
args.onDone(spokenSoFar);
```

---

### `src/main/voice/voice-session-manager.ts` (service, NEW)

**Analog:** `src/main/rag/answer-service.ts` (createAnswerService DI + factory pattern)

**DI factory pattern** (lines 218–230):
```typescript
export function createAnswerService(deps: AnswerServiceDeps): AnswerService {
  const { db, logger, embedClient, vectorStore, ... } = deps;

  async function ask(req: RagAskRequest): Promise<RagAskResponse> { ... }

  return { ask };
}
```

**Map-keyed session pattern** (D-11 analog — use the same `genId` pattern from `src/main/rag/threads.ts` line 60):
```typescript
function genId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}
// Voice sessions: genId('vses') → 'vses_deadbeef01234567'
```

**emitToRenderer push pattern** (from `src/main/ipc/voice.ts` lines 44–45, 85–95):
```typescript
export interface VoiceHandlersDeps {
  emitToRenderer?: (channel: string, payload?: unknown) => void;
}
// Usage:
deps.emitToRenderer?.(CHANNELS.VOICE_TTS_CHUNK, { text: chunk, sessionId });
```

---

### `src/main/voice/tts-segmenter.ts` (utility, NEW)

**Analog:** `src/main/llm/routingLog.ts` (stateless pure utility — no DI, no DB, exportable functions/class)

**Stateless utility export pattern** (lines 71–86):
```typescript
// Pure function, no class needed if stateless. But TtsSegmenter holds buffer
// state across push() calls, so use a class (like routingLog uses a module-level
// INSERT_SQL constant — the pattern is: no framework, no React, no Electron deps).
export function writeRoutingLog(db: Db, e: RoutingLogInput): void {
  db.prepare(INSERT_SQL).run(/* ... */);
}
```

**TtsSegmenter class pattern** — pure TypeScript class, unit-testable, no imports from `electron` or `ai`:
```typescript
// All of D-04 logic lives here. Deny-list from RESEARCH.md Pattern 2.
const ABBREVIATION_RE = /\b(Mr|Mrs|Dr|Prof|Sr|Jr|vs|etc|i\.e|e\.g\.)$/i;
const DECIMAL_RE = /\d\.\d$/;

export class TtsSegmenter {
  private buffer = '';
  private firstChunkFlushed = false;
  constructor(private readonly firstChunkWords = 8) {}
  push(delta: string): string[] { /* ... */ }
  flush(): string { /* ... */ }
}
```

---

### `src/main/voice/voice-latency-log.ts` (utility, NEW)

**Analog:** `src/main/llm/routingLog.ts` (exact mirror — same shape, same patterns)

**writeRoutingLog pattern** (lines 71–86) — copy exactly, rename:
```typescript
const INSERT_SQL = `INSERT INTO routing_log
  (ts, route, reason, source, prompt_hash, model, latency_ms, ok, ...)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export function writeRoutingLog(db: Db, e: RoutingLogInput): void {
  db.prepare(INSERT_SQL).run(
    e.ts, e.route, e.reason, e.source, e.prompt_hash,
    e.model, Math.max(0, Math.round(e.latency_ms)), e.ok,
    e.categories_json ?? null, e.severity ?? null,
    e.classifier_rationale ?? null, e.classifier_version ?? null,
  );
}
```

**readRecentRoutingLog pattern** (lines 94–98):
```typescript
export function readRecentRoutingLog(db: Db, limit = 100): RoutingLogRow[] {
  const safeLimit = Math.max(1, Math.min(1000, Math.round(limit)));
  const rows = db.prepare(SELECT_RECENT_SQL).all(safeLimit) as RoutingLogRow[];
  return rows;
}
```

**ARIA_DEBUG gate pattern** (from `src/main/scheduling/propose.ts` line 162):
```typescript
if (process.env.ARIA_DEBUG === '1' && debug) r.debug = debug;
// → writeVoiceLatencyLog must guard all DB writes:
export function writeVoiceLatencyLog(db: Db, e: VoiceLatencyInput): void {
  if (process.env.ARIA_DEBUG !== '1') return;  // zero overhead in production
  db.prepare(INSERT_SQL).run(/* ... */);
}
```

**Phase 16 VoiceLatencyInput shape** (mirrors RoutingLogInput):
```typescript
export interface VoiceLatencyInput {
  session_id: string;
  t_stt_done: number;              // ms from session start
  t_llm_first_token?: number | null;
  t_first_sentence_ready?: number | null;
  t_kokoro_synth_start?: number | null;
  t_first_audio_out?: number | null;
}
```

---

### `src/main/db/migrations/136_voice_latency_log.sql` (migration, NEW)

**Analog:** `src/main/db/migrations/001_init.sql` routing_log DDL + index pattern (via embedded.ts lines 20–44)

**routing_log CREATE TABLE pattern** (verbatim from migration 001):
```sql
CREATE TABLE routing_log(
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT    NOT NULL,
  route       TEXT    NOT NULL CHECK (route IN ('LOCAL','FRONTIER')),
  reason      TEXT    NOT NULL,
  source      TEXT    NOT NULL,
  prompt_hash TEXT    NOT NULL,
  model       TEXT    NOT NULL,
  latency_ms  INTEGER NOT NULL,
  ok          INTEGER NOT NULL CHECK (ok IN (0,1))
);
CREATE INDEX idx_routing_log_ts ON routing_log(ts DESC);
```

**Phase 16 migration DDL** (mirror the shape, use next available version = 136):
```sql
CREATE TABLE IF NOT EXISTS voice_latency_log (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id              TEXT    NOT NULL,
  t_stt_done              INTEGER NOT NULL,
  t_llm_first_token       INTEGER,
  t_first_sentence_ready  INTEGER,
  t_kokoro_synth_start    INTEGER,
  t_first_audio_out       INTEGER,
  recorded_at             TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_voice_latency_session
  ON voice_latency_log(session_id);
```

**embedded.ts addition pattern** — append `{ version: 136, file: '136_voice_latency_log.sql', sql: \`...\` }` at the tail of `EMBEDDED_MIGRATIONS`, exactly like all entries in lines 16–1614.

---

### `src/renderer/features/voice/useVoiceSession.ts` (hook, extend)

**Analog:** self (lines 34–111 — VoiceSessionState / VoiceSessionActions interfaces + createVoiceSessionStore factory)

**VoiceSessionState interface** (lines 35–48) — add two fields:
```typescript
export interface VoiceSessionState {
  voiceState: VoiceState;
  micGated: boolean;
  liveTranscript: string;
  modelProgress: { receivedBytes: number; totalBytes: number } | null;
  // Phase 16 additions:
  paused: boolean;                     // D-09: pause/resume gate
}
```

**VoiceSessionActions interface** (lines 52–104) — add three actions:
```typescript
export interface VoiceSessionActions {
  startTurn(): boolean;
  stopTurn(): void;
  setVadMode(mode: 'hold' | 'toggle'): void;
  setTranscript(text: string, final: boolean): void;
  endTurn(): void;
  onPlaybackStart(): void;
  onPlaybackEnd(): void;
  subscribeToIpc(aria: AriaApi): () => void;
  // Phase 16 additions:
  bargeIn(): void;   // D-01: replaces no-op guard when voiceState==='speaking'
  pause(): void;     // D-09
  resume(): void;    // D-09
}
```

**startTurn() no-op guard** (lines 152–162) — this is the extension point for bargeIn():
```typescript
startTurn(): boolean {
  // D-13 half-duplex gate: blocked while speaking (or muted-during-playback)
  if (state.voiceState === 'speaking' || state.voiceState === 'muted-during-playback') {
    return false;   // ← Phase 16 replaces this return false with bargeIn() call when 'speaking'
  }
  setState({ voiceState: 'listening', micGated: true, liveTranscript: '' });
  return true;
},
```

**clearCooldown() utility** (lines 141–144) — bargeIn() and pause() both need this:
```typescript
function clearCooldown(): void {
  if (cooldownTimer !== null) {
    clearTimeout(cooldownTimer);
    cooldownTimer = null;
  }
}
```

**Phase 16 bargeIn() implementation pattern**:
```typescript
bargeIn(): void {
  if (state.voiceState !== 'speaking') return;
  clearCooldown();   // D-09: cancel any in-flight cooldown
  // Caller must: readAloudQueue.cancel() + audioContext.resume() (if paused)
  // Fire one-way IPC abort (fire-and-forget, D-02 — no await)
  (window.aria as AriaApi).voiceAbort?.({ sessionId: currentSessionId });
  setState({ voiceState: 'idle', micGated: false, paused: false, liveTranscript: '' });
},

pause(): void {
  clearCooldown();   // D-09: cancel cooldown timer on pause
  setState({ paused: true });
  // Caller must: audioContext.suspend()
},

resume(): void {
  setState({ paused: false });
  // Caller must: audioContext.resume()
},
```

**subscribeToIpc pattern** (lines 207–236) — add onVoiceTtsChunk subscription here:
```typescript
subscribeToIpc(aria: AriaApi): () => void {
  const unsubscribers: Array<() => void> = [];
  if (aria.onVoiceTranscript) {
    const unsub = aria.onVoiceTranscript((delta: TranscriptDelta) => {
      actions.setTranscript(delta.text, delta.final);
    });
    unsubscribers.push(unsub);
  }
  // ... existing subscriptions ...
  return () => { for (const unsub of unsubscribers) { unsub(); } };
},
```

---

### `src/renderer/features/voice/tts/useKokoroPlayer.ts` (hook, extend)

**Analog:** self (lines 30–35 — KokoroTtsInstance interface; lines 173–208 — speak() implementation)

**KokoroTtsInstance interface** (lines 30–35) — add speed to options:
```typescript
// CURRENT (Phase 15):
export interface KokoroTtsInstance {
  generate(
    text: string,
    options?: { voice?: string }   // ← missing speed
  ): Promise<{ audio: Float32Array; sampling_rate: number }> | { ... };
}

// PHASE 16 change:
export interface KokoroTtsInstance {
  generate(
    text: string,
    options?: { voice?: string; speed?: number }   // D-08: add speed
  ): Promise<{ audio: Float32Array; sampling_rate: number }> | { audio: Float32Array; sampling_rate: number };
}
```

**speak() call site** (line 182) — thread speed through:
```typescript
// CURRENT:
const result = await Promise.resolve(ttsInstance.generate(text, { voice: defaultVoice }));

// PHASE 16 change:
const result = await Promise.resolve(ttsInstance.generate(text, { voice: defaultVoice, speed }));
// where speed comes from a new speak(text: string, options?: { speed?: number }) parameter
```

**KokoroPlayerHandle interface** (lines 78–95) — extend speak():
```typescript
// CURRENT:
speak(text: string): Promise<void>;

// PHASE 16 change:
speak(text: string, options?: { speed?: number }): Promise<void>;
```

**AudioBufferSourceNode reference** — Phase 16 needs access for stop() on barge-in. The source node created in speak() (line 197) should be captured in a cancelable ref:
```typescript
// Lines 195–208 currently:
const source = ctx.createBufferSource();
source.buffer = buffer;
source.connect(ctx.destination);

// Phase 16: expose a cancel() method or store source in a ref accessible by useReadAloudQueue
```

---

### `src/renderer/features/voice/useReadAloudQueue.ts` (hook, NEW)

**Analog:** `src/renderer/features/voice/tts/useKokoroPlayer.ts` (useKokoroPlayer React hook wrapper pattern — lines 220–246)

**useKokoroPlayer React hook wrapper pattern** (lines 220–246):
```typescript
export function useKokoroPlayer(options: KokoroPlayerOptions = {}): KokoroPlayerHandle {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const playerRef = useRef<KokoroPlayerHandle | null>(null);

  if (!playerRef.current) {
    playerRef.current = createKokoroPlayer({ ... });
  }

  const init = useCallback(() => playerRef.current!.init(), []);
  const speak = useCallback((text: string) => playerRef.current!.speak(text), []);

  return { get ready() { return playerRef.current!.ready; }, init, speak };
}
```

**D-05 promise-chain queue pattern** (from RESEARCH.md Pattern 3):
```typescript
// src/renderer/features/voice/useReadAloudQueue.ts
export function useReadAloudQueue(player: KokoroPlayerHandle, speed: number) {
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const enqueue = useCallback((text: string) => {
    queueRef.current = queueRef.current.then(async () => {
      await player.speak(text, { speed });
    });
  }, [player, speed]);

  const cancel = useCallback(() => {
    // D-02 / D-05: reset queue AND stop current source (Pitfall 5)
    queueRef.current = Promise.resolve();
    // caller must also call source.stop() (see useKokoroPlayer.cancel())
  }, []);

  return { enqueue, cancel };
}
```

---

### `src/renderer/features/voice/VoiceHUDBand.tsx` (component, extend)

**Analog:** self (lines 1–60 — VoiceHUDBand structure, CSS pattern, ACTIVE_STATES set)

**Expansion + state rendering pattern** (lines 56–60, existing ACTIVE_STATES):
```typescript
const ACTIVE_STATES: Set<VoiceState> = new Set([
  'listening', 'processing', 'speaking', 'muted-during-playback', 'error',
]);
```

**Phase 16 transport controls** — add an inline sub-row when `voiceState === 'speaking'`:
- Pause/resume button → calls `AudioContext.suspend()` / `AudioContext.resume()` + `session.pause()` / `session.resume()`
- Skip button → increments `currentSectionIndex` (briefing only)
- Speed slider (0.5–2x) → sets speed state, re-synths at next section boundary
- All use editorial design system: gold (`#B8963E`), ivory (`#FAF8F4`), ink (`#1A1814`), IBM Plex Mono for speed value label

---

### `tests/static/voice-streaming-no-write.spec.ts` (test, NEW)

**Analog:** `tests/static/voice-routes-through-staging.spec.ts` (exact structural template — lines 1–115)

**Walk + stripComments + identifier RE pattern** (lines 37–83):
```typescript
const ROOT = path.resolve(__dirname, '../..', 'src', 'main');
const VOICE_ROOT = path.resolve(ROOT, 'voice');

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;  // W-1: missing-dir guard
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && /\.(ts|tsx|mts|cts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

const CHOKEPOINT_NAMES = [
  'sendApprovedEmail',
  'applyCalendarChange',
  'pushApprovedMeetingActions',
] as const;

const RE = new RegExp(`(?:^|[^A-Za-z0-9_$])${name}(?:[^A-Za-z0-9_$]|$)`);
```

**Phase 16 additions** — extend the chokepoint set and add renderer voice dir:
```typescript
// D-13: Phase 16 extends this set with voice-confirm + assertApproved
const WRITE_CHOKEPOINTS = [
  'sendApprovedEmail',
  'applyCalendarChange',
  'pushApprovedMeetingActions',
  'assertApproved',     // D-13 Phase 16 addition
  'voiceConfirm',       // D-13 Phase 16 addition
] as const;

// Walk both main voice dir AND renderer voice dir
const MAIN_VOICE_ROOT = path.resolve(ROOT, 'voice');
const RENDERER_VOICE_ROOT = path.resolve(
  __dirname, '../..', 'src', 'renderer', 'features', 'voice'
);
```

---

## Shared Patterns

### IPC Handler Registration (db-null skip-set)

**Source:** `src/main/ipc/index.ts` (registerHandlers function)
**Apply to:** `src/main/ipc/voice.ts` new handlers + `src/main/ipc/index.ts` update
```typescript
// Pattern from existing ipc/index.ts db-null handling:
// Handlers that need db must be registered AFTER unlock OR use db-null guard.
// Rule: skip.add must always be co-located with registration (IPC DB-null skip trap).
// If voice session handlers need db, register them in the post-unlock bootPoll.
```

### emitToRenderer Push Pattern

**Source:** `src/main/ipc/voice.ts` lines 44–45, 85–95
**Apply to:** `src/main/voice/voice-session-manager.ts` (TTS chunk push)
```typescript
export interface VoiceHandlersDeps {
  emitToRenderer?: (channel: string, payload?: unknown) => void;
}
// Push from streaming loop:
deps.emitToRenderer?.(CHANNELS.VOICE_TTS_CHUNK, { text: segmentText, sessionId });
```

### OK/Error Envelope

**Source:** `src/main/ipc/voice.ts` lines 97–106
**Apply to:** All new IPC handlers in voice.ts
```typescript
return { ok: true, delta };
// on error:
return { ok: false, error: (err as Error).message };
```

### Thread Persistence (createThread / appendTurn / getThread)

**Source:** `src/main/rag/threads.ts` + `src/main/rag/answer-service.ts` lines 246–249, 313–320, 328–333
**Apply to:** `src/main/voice/voice-session-manager.ts`
```typescript
// D-11: create thread on first voice turn
const thread = createThread(db, { title: '(voice session)' });
const threadId = thread.id;

// D-12: on barge-in, write synthetic interrupted turn BEFORE next user turn
appendTurn(db, {
  threadId: session.threadId,
  role: 'assistant',
  text: `[interrupted: "${session.spokenSoFar}…"]`,
  routing: { route: 'LOCAL', reason: 'voice-barge-in', sensitivity: 'none' },
});

// D-11: load thread history for each turn
const t = getThread(db, threadId, { lastN: 6 });
const threadHistory = t ? t.turns.map((tr) => ({ role: tr.role, text: tr.text })) : [];
```

### ARIA_DEBUG Gate

**Source:** `src/main/scheduling/propose.ts` line 162
**Apply to:** `src/main/voice/voice-latency-log.ts`
```typescript
if (process.env.ARIA_DEBUG === '1' && debug) r.debug = debug;
// → mirror:
export function writeVoiceLatencyLog(db: Db, e: VoiceLatencyInput): void {
  if (process.env.ARIA_DEBUG !== '1') return;
  // ... db.prepare(INSERT_SQL).run(...)
}
```

### Pino Logger Hygiene

**Source:** `src/main/ipc/voice.ts` lines 99–103; `src/main/rag/answer-service.ts` lines 267–270
**Apply to:** `src/main/voice/voice-session-manager.ts`
```typescript
logger.warn(
  { scope: 'voice.sessionManager', err: (err as Error).message },
  'streamVoiceAnswer.failed',
);
// Never log raw question text, chunk text, or transcript text.
```

---

## No Analog Found

All Phase 16 files have analogs in the codebase. No files require falling back to RESEARCH.md patterns only.

The TtsSegmenter (pure text utility with no codebase analog for its domain) is closest to `routingLog.ts` as a structural pattern (no-deps pure utility), but its algorithm content (D-04 hybrid segmenter) has no existing analog — executor should derive from RESEARCH.md Pattern 2.

---

## Critical Constraints for Planner

1. **Handler count invariant** — `tests/unit/main/ipc/index.spec.ts` line 77 asserts `handlers.size === Object.keys(CHANNELS).length`. Currently 149. Phase 16 adds 3 channels → must become 152 in the same wave. Do NOT add CHANNELS entries without simultaneously adding handlers.

2. **VOICE_ABORT = fire-and-forget** — renderer must NOT await `voiceAbort()`. The ~5ms renderer-side cancel is what hits SC3. Only main's AbortController.abort() races independently.

3. **onAbort trap (AI SDK #8088)** — spokenSoFar MUST live in an `onChunk` accumulator ref, not in `onAbort`. Fast abort redirects to `onError`.

4. **briefing surface = walk stored BriefingPayload** — no LLM streaming needed for briefing read-aloud. Pitfall 4: do NOT add `streamText` to `briefing/generate.ts`.

5. **KokoroTtsInstance speed type gap** — `useKokoroPlayer.ts` line 33 declares `generate(text, { voice? })` with no `speed`. MUST add `speed?: number` before D-08 implementation or speed controls silently do nothing.

6. **Queue cancel on barge-in** — `useReadAloudQueue.cancel()` must BOTH stop the current source AND reset `queueRef.current = Promise.resolve()` (Pitfall 5). Missing the reset causes old speech to resume mid-new-turn.

7. **Migration 136 = next available** — last committed migration is 135 (`135_repair_approval_child_fks.sql`). Phase 16 uses 136.

8. **D-13 renderer voice dir** — the new static ratchet must walk `src/renderer/features/voice/` in addition to `src/main/voice/`, since barge-in and queue logic lives in renderer files.

---

## Metadata

**Analog search scope:** `src/main/ipc/`, `src/main/rag/`, `src/main/llm/`, `src/main/db/migrations/`, `src/renderer/features/voice/`, `src/preload/`, `src/shared/`, `tests/static/`, `tests/unit/main/ipc/`
**Files scanned:** 17 source files read directly
**Pattern extraction date:** 2026-06-07
