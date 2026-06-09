---
phase: 260609-qqb
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/main/ipc/voice.ts
  - src/main/rag/answer-service.ts
  - src/main/voice/voice-session-manager.ts
autonomous: true
requirements:
  - VOICE-AUDIO-WIRE-01

must_haves:
  truths:
    - "A voice turn with nomic-embed-text absent still produces spoken audio (llama3.1:8b answers from question alone)"
    - "createVoiceSessionManager is constructed with a real EmbedClient and VectorStore"
    - "Retrieval failure in streamVoiceAnswer logs the error and continues with retrieved=[] instead of bailing before streamText"
    - "streamText onError logs the error instead of swallowing it silently"
    - "onDone logs final text length so an empty string is visible in logs"
    - "Diagnostic logs appear in the app's rotating log file (same logger instance as existing voice.* diag lines) — D-02 logger threading"
  artifacts:
    - path: "src/main/ipc/voice.ts"
      provides: "ensureVoiceSessionManager passes embedClient and vectorStore to createVoiceSessionManager"
      contains: "createEmbedClient"
    - path: "src/main/rag/answer-service.ts"
      provides: "streamVoiceAnswer retrieval catch degrades to retrieved=[] instead of returning early; logger threaded via deps"
      contains: "voice.answer"
    - path: "src/main/voice/voice-session-manager.ts"
      provides: "startAnswer threads app logger into streamDeps passed to streamVoiceAnswer"
      contains: "logger: deps.logger"
  key_links:
    - from: "src/main/ipc/voice.ts ensureVoiceSessionManager"
      to: "src/main/voice/voice-session-manager.ts createVoiceSessionManager"
      via: "embedClient + vectorStore deps"
      pattern: "createEmbedClient\\(\\)"
    - from: "src/main/rag/answer-service.ts streamVoiceAnswer retrieval catch"
      to: "streamText call (~line 568)"
      via: "retrieved = [] fallback (non-fatal path)"
      pattern: "retrieved = \\[\\]"
    - from: "src/main/voice/voice-session-manager.ts startAnswer streamDeps"
      to: "src/main/rag/answer-service.ts streamVoiceAnswer"
      via: "logger: deps.logger threaded through streamDeps"
      pattern: "logger: deps\\.logger"
---

<objective>
Wire real embedClient and vectorStore into the voice session manager construction, and degrade retrieval failure in streamVoiceAnswer to non-fatal so llama3.1:8b always answers.

Purpose: Three compounding silent faults prevent any voice audio output even when Ollama and llama3.1:8b are fully operational. This fix makes the voice path resilient: nomic-embed-text being absent (or any retrieval error) no longer silences the LLM.

Output:
- src/main/ipc/voice.ts — ensureVoiceSessionManager passes createEmbedClient() and getVectorStore(db) to createVoiceSessionManager
- src/main/rag/answer-service.ts — streamVoiceAnswer deps Pick widened to include optional logger; retrieval catch degrades gracefully; streamText onError and onDone emit diagnostic logs via that logger
- src/main/voice/voice-session-manager.ts — startAnswer threads deps.logger into the streamDeps object passed to streamVoiceAnswer
</objective>

<execution_context>
@/home/HomePC/.claude/get-shit-done/workflows/execute-plan.md
@/home/HomePC/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md

Prior quick 260609-poa confirmed: ensureVoiceSessionManager fires exactly once
(hasManager:true logged), so the manager creation site is the right injection
point. No further investigation of the manager lifecycle is needed.
</context>

<interfaces>
<!-- Key contracts extracted from the codebase — executor should use these directly. -->

From src/main/rag/ollama-embeddings.ts:
```typescript
export function createEmbedClient(opts: EmbedClientOptions = {}): EmbedClient
// EmbedClient.embed(inputs: string[]): Promise<Float32Array[]>
// Opts are optional; zero-arg call uses DEFAULT_OLLAMA_BASE_URL + DEFAULT_EMBED_MODEL
```

From src/main/rag/vector-store.ts:
```typescript
export interface VectorStore {
  upsert(chunkId: string, vector: Float32Array, modelId: string): void;
  query(queryVector: Float32Array, k: number): Hit[];
}
export function getVectorStore(db: Db, opts: GetVectorStoreOpts = {}): VectorStore
// db is Database.Database (non-null); opts optional
```

From src/main/voice/voice-session-manager.ts:
```typescript
export interface VoiceSessionManagerDeps {
  db: Database.Database;
  logger?: Logger;             // OPTIONAL — but voice.ts always passes one in production
  embedClient?: EmbedClient;   // <-- currently never set
  vectorStore?: VectorStore;   // <-- currently never set
  emitToRenderer: (channel: string, payload?: unknown) => void;
  sessionAbortControllers?: Map<string, AbortController>;
}
export function createVoiceSessionManager(deps: VoiceSessionManagerDeps): VoiceSessionManager
```

From src/main/rag/answer-service.ts (current signature — Task 2 widens this):
```typescript
// CURRENT (before Task 2):
export async function streamVoiceAnswer(
  deps: Pick<AnswerServiceDeps, 'db' | 'embedClient' | 'vectorStore'>,
  ...
)

// AFTER Task 2 (target signature):
export async function streamVoiceAnswer(
  deps: Pick<AnswerServiceDeps, 'db' | 'embedClient' | 'vectorStore'> & { logger?: Logger },
  ...
)
// AnswerServiceDeps.logger is required (logger: Logger), so Pick<..., 'logger'> would
// force callers to always supply one. Using an intersection with { logger?: Logger }
// keeps it optional — matching VoiceSessionManagerDeps.logger?  — and lets all
// three logger?.warn/debug calls use optional-call syntax without type errors.
```

From src/main/voice/voice-session-manager.ts startAnswer (~line 146 — current):
```typescript
const streamDeps = {
  db,
  embedClient: deps.embedClient as EmbedClient,
  vectorStore: deps.vectorStore as VectorStore,
};
```
// After Task 2: add `logger: deps.logger` here. deps.logger is Logger|undefined;
// the widened Pick accepts Logger|undefined via the optional intersection field — no cast needed.

From src/main/ipc/index.ts (working /ask path — mirror this):
```typescript
import { getVectorStore } from '../rag/vector-store';
import { createEmbedClient } from '../rag/ollama-embeddings';
// ...
openVectorStore: (db) => getVectorStore(db),
makeEmbedClient: () => createEmbedClient(),
```

From src/main/rag/answer-service.ts streamVoiceAnswer (~line 536-551):
```typescript
let retrieved: Awaited<ReturnType<typeof hybridRetrieve>> = [];
try {
  retrieved = await hybridRetrieve({ db, embedClient, vectorStore }, question, { topK: 10 });
} catch {
  // CURRENT (FATAL): calls onDone('') and returns before streamText
  onDone('');
  appendTurn(db, { threadId, role: 'assistant', text: '',
    routing: { route: 'LOCAL', reason: 'voice-answer:retrieve-failed', sensitivity: 'none' } });
  return;
}
```

From src/main/rag/answer-service.ts streamText onError (~line 579-584):
```typescript
onError: ({ error }) => {
  void error;  // CURRENT: silently swallows
},
```
</interfaces>

<tasks>

<task type="auto">
  <name>Task 1: Wire embedClient and vectorStore into ensureVoiceSessionManager</name>
  <files>src/main/ipc/voice.ts</files>
  <action>
Add two import lines near the top of voice.ts (after the existing imports, alongside the other RAG/LLM imports at ~line 54):

```
import { createEmbedClient } from '../rag/ollama-embeddings';
import { getVectorStore } from '../rag/vector-store';
```

Inside the ensureVoiceSessionManager function (~line 284-290), the createVoiceSessionManager call currently passes only db, logger, emitToRenderer, and sessionAbortControllers. Add embedClient and vectorStore to that call:

```typescript
deps.voiceSessionManager = createVoiceSessionManager({
  db: deps.dbHolder.db,
  logger,
  emitToRenderer: deps.emitToRenderer,
  sessionAbortControllers: abortControllers,
  embedClient: createEmbedClient(),
  vectorStore: getVectorStore(deps.dbHolder.db),
});
```

Both createEmbedClient() and getVectorStore(db) are zero-config calls (same pattern as the /ask path in ipc/index.ts). db is guaranteed non-null at this point because the guard `deps.dbHolder.db &&` already checked it on the line above the if-block.

Do NOT add any new ipcMain.handle calls. Do NOT modify VoiceHandlersDeps or registerVoiceHandlers. This is only a change to the createVoiceSessionManager call site inside ensureVoiceSessionManager.
  </action>
  <verify>
    <automated>cd /c/Users/HomePC/Documents/GitHub/Aria && npm run typecheck 2>&1 | tail -20</automated>
  </verify>
  <done>typecheck reports 0 new errors beyond the 83-error flat baseline; grep confirms `createEmbedClient` appears in voice.ts and `getVectorStore` appears in voice.ts; the ensureVoiceSessionManager block passes both deps to createVoiceSessionManager.</done>
</task>

<task type="auto">
  <name>Task 2: Widen streamVoiceAnswer deps + thread logger + add diag logs</name>
  <files>src/main/rag/answer-service.ts, src/main/voice/voice-session-manager.ts</files>
  <action>
This task makes three coordinated changes. Scope: streamVoiceAnswer in answer-service.ts and startAnswer in voice-session-manager.ts. Do NOT touch the ask() function or its retrieval path (~line 303 in answer-service.ts). The 260609-poa diagnostic logs (feedAnswer entry, startAnswer entry, hasManager checks) MUST remain untouched.

**Change 1 — widen the streamVoiceAnswer deps type (answer-service.ts ~line 519):**

Change the function signature from:
```
deps: Pick<AnswerServiceDeps, 'db' | 'embedClient' | 'vectorStore'>,
```
to:
```
deps: Pick<AnswerServiceDeps, 'db' | 'embedClient' | 'vectorStore'> & { logger?: Logger },
```

AnswerServiceDeps.logger is required (Logger, not Logger|undefined), so Pick<..., 'logger'> would force every caller to supply a non-optional logger. Using an intersection with { logger?: Logger } keeps the field optional, matching VoiceSessionManagerDeps.logger?: Logger. All three diag call sites use optional-call syntax (logger?.warn / logger?.debug), so TypeScript accepts Logger|undefined cleanly without casts.

Also update the destructure on the next line to extract logger:
```
const { db, embedClient, vectorStore, logger } = deps;
```

The Logger type is already imported in answer-service.ts (used by AnswerServiceDeps). No new import needed.

**Change 2 — retrieval catch (non-fatal degradation) (answer-service.ts ~line 542-551):**

Replace the existing catch block:
```typescript
} catch {
  onDone('');
  appendTurn(db, { ... });
  return;                     // <-- FATAL: never reaches streamText
}
```

With a degrading catch that logs and continues:
```typescript
} catch (retrieveErr: unknown) {
  // [voice.answer] Retrieval failed — degrading to no-context answer.
  // nomic-embed-text may not be installed; llama3.1:8b still answers from
  // question alone. Do NOT bail here (would produce zero audio).
  logger?.warn(
    { scope: 'voice.answer', err: (retrieveErr as Error)?.message ?? String(retrieveErr) },
    'voice.answer: retrieval failed, degrading to empty context',
  );
  retrieved = [];
  // Do NOT return — fall through to streamText below.
}
```

**Change 3 — streamText onError diag log (answer-service.ts ~line 579-584):**

Replace:
```typescript
onError: ({ error }) => {
  // D-03: fast abort (<~500ms) redirects here instead of onAbort per AI SDK
  // #8088. spokenSoFar is safe in the accumulator above regardless of which
  // error path fires.
  void error;
},
```

With:
```typescript
onError: ({ error }) => {
  // D-03: fast abort (<~500ms) redirects here instead of onAbort per AI SDK
  // #8088. spokenSoFar is safe in the accumulator above regardless of which
  // error path fires.
  logger?.warn(
    { scope: 'voice.answer', err: (error as Error)?.message ?? String(error) },
    'voice.answer: streamText error',
  );
},
```

**Change 4 — onDone diag log (answer-service.ts ~line 601):**

After the existing `onDone(spokenSoFar)` call at the end of streamVoiceAnswer (before the function's closing brace), add:
```typescript
// [voice.answer] onDone fired — log text length so empty answers are visible.
logger?.debug(
  { scope: 'voice.answer', textLen: spokenSoFar.length },
  'voice.answer: onDone',
);
```

**Change 5 — thread logger into streamDeps (voice-session-manager.ts startAnswer ~line 146):**

In startAnswer, update the streamDeps object to include logger:
```typescript
const streamDeps = {
  db,
  embedClient: deps.embedClient as EmbedClient,
  vectorStore: deps.vectorStore as VectorStore,
  logger: deps.logger,
};
```

deps.logger is Logger|undefined (VoiceSessionManagerDeps.logger is optional). The widened Pick in streamVoiceAnswer accepts Logger|undefined via the optional intersection field — no cast or non-null assertion needed. In production, voice.ts always passes a real pino logger to createVoiceSessionManager, so the diag logs will appear in the app's rotating log file alongside the existing voice.* lines.
  </action>
  <verify>
    <automated>cd /c/Users/HomePC/Documents/GitHub/Aria && npm run typecheck 2>&1 | tail -20</automated>
  </verify>
  <done>typecheck reports 0 new errors beyond the 83-error flat baseline; grep confirms `voice.answer` tag appears in answer-service.ts in three places (retrieval catch warn, onError warn, onDone debug); the retrieval catch no longer contains `return` after `retrieved = []`; the streamVoiceAnswer signature includes `& { logger?: Logger }`; voice-session-manager.ts startAnswer streamDeps includes `logger: deps.logger`.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Ollama sidecar → embedClient | Network call to localhost:11434; model may be absent |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-qqb-01 | Denial of Service | createEmbedClient() in ensureVoiceSessionManager | accept | Embed client construction is cheap (no network call at construction time); embed calls only happen inside streamVoiceAnswer which already has a non-fatal catch after this fix |
| T-qqb-02 | Information Disclosure | logger.warn in retrieval catch | accept | Logs only error.message and scope tag — no user content or PII logged (per ollama-embeddings.ts logging hygiene: log counts/errors only, never input content) |
</threat_model>

<verification>
Static verification (executor runs these):

1. `npm run typecheck` — 0 new errors beyond the known 83-error flat baseline.
2. `grep -n "createEmbedClient\|getVectorStore" src/main/ipc/voice.ts` — both appear, in the import block and inside ensureVoiceSessionManager.
3. `grep -n "voice\.answer" src/main/rag/answer-service.ts` — appears in three places: retrieval catch warn, onError warn, onDone debug.
4. `grep -n "retrieved = \[\]" src/main/rag/answer-service.ts` — the assignment is followed by a comment, NOT by `return`.
5. `grep -n "return;" src/main/rag/answer-service.ts` — the old `return;` inside the retrieval catch is gone.
6. `grep -n "logger.*Logger" src/main/rag/answer-service.ts` — streamVoiceAnswer signature contains `& { logger?: Logger }`.
7. `grep -n "logger: deps\.logger" src/main/voice/voice-session-manager.ts` — present in the streamDeps object inside startAnswer.

Runtime verification (needs-review — user or orchestrator runs live):

- Trigger a voice turn with nomic-embed-text absent.
- Expected: main-process logs show `voice.answer: retrieval failed, degrading to empty context` followed by `voice.answer: onDone` with textLen > 0.
- Expected: VOICE_TTS_CHUNK events fire and audio is heard.
- This is the real proof of fix; it cannot be automated without a live Electron + Ollama environment.
</verification>

<success_criteria>
- typecheck passes with 0 regressions.
- ensureVoiceSessionManager in voice.ts passes embedClient and vectorStore to createVoiceSessionManager.
- streamVoiceAnswer deps Pick is widened with `& { logger?: Logger }` and logger is destructured from deps.
- startAnswer in voice-session-manager.ts passes `logger: deps.logger` in streamDeps.
- streamVoiceAnswer retrieval catch no longer returns early — it logs and continues to streamText.
- Three [voice.answer]-tagged diag logs are in place (retrieval warn, streamText error warn, onDone debug).
- All logger calls use optional-call syntax (logger?.warn / logger?.debug) — no casts, no non-null assertions.
- A live voice turn with missing nomic-embed-text produces spoken audio (the local LLM answers from the question alone).
</success_criteria>

<output>
After completion, create `.planning/quick/260609-qqb-fix-voice-no-audio-wire-embedclient-crea/260609-qqb-SUMMARY.md`
</output>
