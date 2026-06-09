---
phase: 260609-qqb
plan: 01
subsystem: voice
tags: [voice, rag, embeddings, diagnostics, resilience]
dependency_graph:
  requires: [quick-260609-poa]
  provides: [voice-rag-retrieval-wired, voice-answer-non-fatal-degrade]
  affects: [src/main/ipc/voice.ts, src/main/rag/answer-service.ts, src/main/voice/voice-session-manager.ts]
tech_stack:
  added: []
  patterns: [non-fatal-degrade, optional-logger-intersection, DI-dep-threading]
key_files:
  created: []
  modified:
    - src/main/ipc/voice.ts
    - src/main/rag/answer-service.ts
    - src/main/voice/voice-session-manager.ts
decisions:
  - "Non-fatal retrieval degrade: set retrieved=[] + continue to streamText (vs returning early with onDone(''))"
  - "Optional logger intersection type (& { logger?: Logger }) avoids forcing callers to always provide a logger"
  - "logger?.warn/debug optional-call syntax — no casts, no non-null assertions"
metrics:
  duration: "~20 minutes"
  completed: "2026-06-09"
  tasks_completed: 2
  files_changed: 3
---

# Phase 260609-qqb Plan 01: Fix Voice No Audio — Wire embedClient + Non-Fatal Retrieval Summary

**One-liner:** Wire real EmbedClient/VectorStore into VoiceSessionManager construction and degrade retrieval failure to non-fatal so llama3.1:8b always produces spoken audio even when nomic-embed-text is absent.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Wire embedClient + vectorStore into ensureVoiceSessionManager | 87cbd11 | src/main/ipc/voice.ts |
| 2 | Widen streamVoiceAnswer deps + thread logger + 3 diag logs | 97f3be9 | src/main/rag/answer-service.ts, src/main/voice/voice-session-manager.ts |

## What Was Done

**Task 1 — voice.ts:**
- Added imports for `createEmbedClient` (from `../rag/ollama-embeddings`) and `getVectorStore` (from `../rag/vector-store`)
- In `ensureVoiceSessionManager`, passed `embedClient: createEmbedClient()` and `vectorStore: getVectorStore(deps.dbHolder.db)` to `createVoiceSessionManager`
- `db` is guaranteed non-null at this call site (guard on line above)
- Pattern mirrors the `/ask` path in `ipc/index.ts` (zero-arg `createEmbedClient()`)

**Task 2 — answer-service.ts + voice-session-manager.ts:**
- Widened `streamVoiceAnswer` deps signature: `Pick<AnswerServiceDeps, 'db' | 'embedClient' | 'vectorStore'> & { logger?: Logger }` — optional intersection avoids forcing all callers to supply a non-optional logger
- Destructured `logger` from deps
- Retrieval catch block: replaced fatal `onDone('') + return` with `logger?.warn(...) + retrieved = []` — falls through to `streamText` below; llama3.1:8b answers from question alone
- `streamText onError`: replaced `void error` with `logger?.warn(...)` so stream errors appear in logs
- After `onDone(spokenSoFar)`: added `logger?.debug({ textLen })` so empty answers are visible
- `voice-session-manager.ts startAnswer`: added `logger: deps.logger` to `streamDeps` — threads the real pino logger from voice.ts through to `streamVoiceAnswer`
- All three logger call sites use optional-call syntax (`logger?.warn` / `logger?.debug`)
- Preserved all `[diag 260609]` logs from quick 260609-poa unchanged

## Deviations from Plan

None — plan executed exactly as written.

## Typecheck Results

- Baseline (pre-existing): 84 errors
- After Task 1: 84 errors (0 new)
- After Task 2: 84 errors (0 new)

## Test Results

- `tests/unit/main/voice/voice-session-manager.spec.ts`: 3/3 PASS
- `tests/unit/main/rag/answer-service.test.ts`: 9/9 FAIL — pre-existing native ABI failure (NODE_MODULE_VERSION 145 vs 141 mismatch in test runner); confirmed pre-existing by stash check; unrelated to this quick task

## Verification Checks

1. `createEmbedClient` and `getVectorStore` appear in `voice.ts` — both in import block and inside `ensureVoiceSessionManager` (lines 47-48, 291-292)
2. `voice.answer` tag appears in `answer-service.ts` in three places: retrieval catch warn, onError warn, onDone debug
3. `retrieved = []` in catch block NOT followed by `return`
4. Sole remaining `return;` in `streamVoiceAnswer` is the 4096-char cap (line 528 — correct)
5. `streamVoiceAnswer` signature contains `& { logger?: Logger }`
6. `voice-session-manager.ts` startAnswer streamDeps contains `logger: deps.logger`

## Known Stubs

None — all wiring is real production code.

## Threat Flags

No new threat surface introduced. EmbedClient construction is cheap (no network call at construction time). Logger warn only logs `error.message` and scope tag — no user content or PII.

## Self-Check

- [x] `src/main/ipc/voice.ts` modified and committed (87cbd11)
- [x] `src/main/rag/answer-service.ts` modified and committed (97f3be9)
- [x] `src/main/voice/voice-session-manager.ts` modified and committed (97f3be9)
- [x] Typecheck: 84 errors — 0 new vs baseline
- [x] voice-session-manager spec: 3/3 green
- [x] answer-service failures: pre-existing (confirmed by stash)

## Self-Check: PASSED
