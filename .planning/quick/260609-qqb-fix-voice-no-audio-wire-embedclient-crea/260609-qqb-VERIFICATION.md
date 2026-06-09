---
phase: 260609-qqb
verified: 2026-06-09T00:00:00Z
status: human_needed
score: 5/6 must-haves verified
human_verification:
  - test: "Trigger a voice turn with nomic-embed-text absent from Ollama"
    expected: "Main-process log shows 'voice.answer: retrieval failed, degrading to empty context' followed by 'voice.answer: onDone' with textLen > 0. VOICE_TTS_CHUNK events fire and spoken audio is heard."
    why_human: "Cannot run live Electron+Ollama environment in verifier. The code path is fully wired and non-fatal — proof requires a real audio output round-trip."
---

# Quick 260609-qqb: Fix Voice No-Audio — Verification Report

**Task Goal:** Fix voice no-audio — wire embedClient+vectorStore into the voice manager, make retrieval failure non-fatal on the voice path (degrade to local LLM with empty context), add diag logs threaded through the real app logger.
**Verified:** 2026-06-09
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | createVoiceSessionManager is constructed with a real EmbedClient and VectorStore | VERIFIED | `voice.ts` lines 47-48 import both; lines 291-292 pass `embedClient: createEmbedClient()` and `vectorStore: getVectorStore(deps.dbHolder.db)` inside `ensureVoiceSessionManager`. The undefined-deps throw is eliminated. |
| 2 | Retrieval failure in streamVoiceAnswer logs the error and continues with retrieved=[] instead of bailing before streamText | VERIFIED | `answer-service.ts` lines 542-552: catch block uses `logger?.warn(...)`, sets `retrieved = []`, ends with comment "Do NOT return — fall through to streamText below." No `return` statement follows `retrieved = []`. |
| 3 | ask() retrieval behavior is unchanged | VERIFIED | `answer-service.ts` lines 302-315: the `ask()` retrieval catch (around line 309) still does `return { kind: 'error', ... }` — the non-fatal change was scoped to `streamVoiceAnswer` only. The ask() path is untouched. |
| 4 | streamText onError logs the error instead of swallowing it silently | VERIFIED | `answer-service.ts` lines 579-587: `onError` now calls `logger?.warn({ scope: 'voice.answer', err: ... }, 'voice.answer: streamText error')` replacing the old `void error`. |
| 5 | onDone logs final text length so an empty string is visible in logs | VERIFIED | `answer-service.ts` lines 605-609: `logger?.debug({ scope: 'voice.answer', textLen: spokenSoFar.length }, 'voice.answer: onDone')` appears after `onDone(spokenSoFar)`. |
| 6 | Diagnostic logs appear in the app's rotating log file (same logger instance as existing voice.* diag lines) — D-02 logger threading | VERIFIED (code path) / human_needed (runtime confirmation) | `voice-session-manager.ts` line 150: `streamDeps` includes `logger: deps.logger`. `deps.logger` is the real pino logger passed by `voice.ts`. All three call sites use `logger?.warn`/`logger?.debug` optional-call syntax — no `as` casts, no non-null assertions, no fresh module-level pino instantiation. The logger is threaded correctly in code. Runtime log appearance requires live UAT. |

**Score:** 5/6 truths verified (truth 6 is structurally verified but requires live UAT for runtime confirmation)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/main/ipc/voice.ts` | ensureVoiceSessionManager passes embedClient and vectorStore to createVoiceSessionManager | VERIFIED | Lines 291-292 pass `createEmbedClient()` and `getVectorStore(deps.dbHolder.db)`. Imports at lines 47-48. |
| `src/main/rag/answer-service.ts` | streamVoiceAnswer retrieval catch degrades to retrieved=[] instead of returning early; logger threaded via deps | VERIFIED | Signature at line 519: `Pick<AnswerServiceDeps, 'db' \| 'embedClient' \| 'vectorStore'> & { logger?: Logger }`. Catch at lines 542-552: non-fatal. Three `voice.answer` log tags present. |
| `src/main/voice/voice-session-manager.ts` | startAnswer threads app logger into streamDeps passed to streamVoiceAnswer | VERIFIED | Line 150: `logger: deps.logger` present in `streamDeps`. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `voice.ts ensureVoiceSessionManager` | `voice-session-manager.ts createVoiceSessionManager` | embedClient + vectorStore deps | VERIFIED | `createEmbedClient()` at line 291, `getVectorStore(deps.dbHolder.db)` at line 292 — both found in the call. |
| `answer-service.ts streamVoiceAnswer retrieval catch` | streamText call | `retrieved = []` fallback (non-fatal path) | VERIFIED | Line 550: `retrieved = []` followed by comment "Do NOT return", no `return;` statement. Falls through to `streamText` at line 568. |
| `voice-session-manager.ts startAnswer streamDeps` | `answer-service.ts streamVoiceAnswer` | `logger: deps.logger` threaded through streamDeps | VERIFIED | Line 150: `logger: deps.logger` in `streamDeps` object. |

---

### No New ipcMain.handle Calls

The `VOICE_HANDLER_CHANNELS` array has 13 entries. `registerVoiceHandlers` registers exactly 13 `ipcMain.handle` calls (lines 337, 444, 458, 476, 497, 507, 523, 542, 566, 605, 627, 640, 656). No new channels were added.

---

### Prior [diag 260609] Logs Preserved

Three [diag 260609] log lines from quick 260609-poa are intact in `voice.ts`:
- Line 374: `// [diag 260609] confirm mic actually captured audio`
- Line 392: `// [diag 260609] did cloud return text (and how long) vs an error?`
- Line 545: `// [diag 260609] did the renderer reach the answer path, and is the manager wired?`

---

### Anti-Patterns Found

| File | Pattern | Severity | Assessment |
|------|---------|----------|------------|
| `voice-session-manager.ts` line 148-149 | `deps.embedClient as EmbedClient` and `deps.vectorStore as VectorStore` casts | Info | Pre-existing casts from Phase 16. Now that voice.ts always passes real values via `ensureVoiceSessionManager`, these casts are safe at runtime. Not introduced by this task. No new casts added. |

No TBD / FIXME / XXX markers found in modified files. No stubs or placeholder returns in modified code paths.

---

### Human Verification Required

#### 1. Live Voice Turn with nomic-embed-text Absent

**Test:** With Ollama running (llama3.1:8b loaded) but nomic-embed-text NOT installed, trigger a voice turn via PTT.
**Expected:** Main-process pino log file shows:
  1. `voice.answer: retrieval failed, degrading to empty context` (logger.warn with err field)
  2. `voice.answer: onDone` with `textLen > 0` (logger.debug)
  3. VOICE_TTS_CHUNK events arrive in renderer
  4. Spoken audio is heard
**Why human:** Cannot launch Electron + Ollama environment from the verifier. This is the real proof that the three compounding silent faults are resolved. Code path correctness is verified; audio output requires a live run.

---

### Gaps Summary

No code gaps. The single unresolved item is a runtime UAT checkpoint — all wiring is present and correct in the codebase. The live audio test is the only remaining verification.

---

_Verified: 2026-06-09_
_Verifier: Claude (gsd-verifier)_
