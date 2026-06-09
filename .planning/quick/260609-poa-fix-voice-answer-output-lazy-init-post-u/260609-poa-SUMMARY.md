---
phase: quick-260609-poa
plan: "01"
subsystem: voice
tags: [voice, ipc, bug-fix, lazy-init, ref-count]
dependency_graph:
  requires: [quick-260609-o8e]
  provides: [voice-answer-output-working]
  affects: [src/main/ipc/voice.ts, src/renderer/features/voice/useVoiceSession.ts]
tech_stack:
  added: []
  patterns: [lazy-init, ref-count, module-singleton]
key_files:
  created: []
  modified:
    - src/main/ipc/voice.ts
    - src/renderer/features/voice/useVoiceSession.ts
decisions:
  - ensureVoiceSessionManager() is a non-exported module function (not a method) so it can reference deps mutably and also be testable
  - Per-component subscribedRef preserved in useVoiceSession hook as defense-in-depth (no diff expansion needed)
  - _ipcSubscriberCount/_ipcUnsub declared after createVoiceSessionStore() at module scope; closures capture by reference so runtime access is safe
metrics:
  duration: "~15 minutes"
  completed: "2026-06-09"
  tasks_completed: 2
  files_modified: 2
---

# Quick 260609-poa: Fix Voice Answer Output — Lazy Init + Ref-Count SUMMARY

Two bugs silencing all voice answer output after STT have been fixed. Voice turns will now produce actual LLM answers via lazy VoiceSessionManager init (Bug 1) and deduplicated IPC listener registration via module-level ref-count (Bug 2).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Lazy-init VoiceSessionManager in main-process voice IPC | 1771ce0 | src/main/ipc/voice.ts |
| 2 | Ref-counted IPC subscription on the singleton voice session store | 4aab0b5 | src/renderer/features/voice/useVoiceSession.ts |

## What Was Fixed

### Bug 1: VoiceSessionManager never created (hasManager always false)

`registerVoiceHandlers()` is called at app-ready before vault unlock. At that point `deps.dbHolder.db` is `null`, so the old inline guard `if (!deps.voiceSessionManager && deps.dbHolder.db && deps.emitToRenderer)` silently skipped manager creation. `deps.voiceSessionManager` remained `undefined` permanently, and every `VOICE_FEED_ANSWER` invocation logged `hasManager:false` and returned `{ok:true}` without calling `startAnswer`.

**Fix:** Extracted `ensureVoiceSessionManager(deps, logger)` helper (non-exported, placed above `registerVoiceHandlers`). Deleted the inline creation block from inside the registration function. Added `ensureVoiceSessionManager(deps, logger)` as the first line of `VOICE_FEED_ANSWER`, `VOICE_ABORT`, and `VOICE_LATENCY_MARK` handlers — these are called post-unlock when `db` is live.

### Bug 2: 5x voiceFeedAnswer dispatches per STT transcript

`useVoiceSession()` is consumed by 5 components simultaneously (App.tsx, Topbar.tsx, VoicePTTButton.tsx, VoiceHUDBand.tsx, BriefingScreen.tsx). The old per-instance `subscribedRef` guard let only the FIRST mounter install real `onVoiceTranscript` listeners; subsequent mounts called `store.subscribeToIpc(window.aria)` again, adding a second (then third, etc.) `ipcRenderer.on` listener on the same channel. Each STT transcript fired N callbacks, each calling `voiceFeedAnswer` — producing N LLM answer requests per question.

Additionally, when the first mounter unmounted (e.g. navigating away from BriefingScreen while 4 consumers remained), its real unsubscriber tore down all IPC channels for ALL remaining consumers (silencing subsequent transcripts).

**Fix:** Added module-level `_ipcSubscriberCount` and `_ipcUnsub` variables after the `_singleton` declaration. Replaced the pass-through `subscribeToIpc` wrapper in the store's returned object with a ref-count implementation: real listeners installed on 0→1, torn down only on N→0. Every consumer receives a meaningful decrementing unsubscriber. Per-component `subscribedRef` preserved as defense-in-depth.

## Typecheck Results

**Baseline:** 84 errors (pre-existing from earlier phases — all unrelated to this fix)  
**After Task 1:** 84 errors (0 new)  
**After Task 2:** 84 errors (0 new)

## Voice Test Suite Results

```
Test Files  9 passed (9)
     Tests  137 passed (137)
```

No subscription-count pollution observed between test cases. Tests that call `createVoiceSessionStore()` directly instantiate fresh stores and bypass the module-level `_ipcSubscriberCount`/`_ipcUnsub` variables entirely, so the ref-count does not affect test isolation.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None introduced in this plan. The `[diag 260609]` logger.info lines in voice.ts are preserved as specified — they are the live verification instrument.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. Both changes are purely behavioral (call-time manager init; subscriber ref-count). No threat flags.

## Post-Execution Gap Fix (verifier-found, 2026-06-09)

**Gap:** Task 2's ref-counted `subscribeToIpc` wrapper lives at `store.subscribeToIpc` (line 420 of the store factory's returned object). The hook's `useEffect` at line 503 called `store.getState().subscribeToIpc(...)` instead. `getState()` spreads `{ ...state, ...actions }`, so `getState().subscribeToIpc` resolved to `actions.subscribeToIpc` (the raw installer at line 376) — completely bypassing the ref-count wrapper. With 5 simultaneous `useVoiceSession()` consumers this meant the "one-listener-only" guarantee was never enforced at runtime; each mount registered a fresh `onVoiceTranscript` listener, restoring the N-fold `voiceFeedAnswer` dispatch that the plan intended to prevent.

**Fix (one line, useVoiceSession.ts:503):** Changed `store.getState().subscribeToIpc(...)` to `store.subscribeToIpc(...)`. `store` is the singleton returned by `getSessionStore()` and exposes the ref-counted wrapper directly.

**Commit:** `662045d` — `fix(260609-poa): route hook through ref-counted store.subscribeToIpc (was bypassing via getState)`

**Typecheck:** 84 errors (flat — 0 new)

**Voice tests:** 9 files / 137 tests — all pass. No test referenced `getState().subscribeToIpc`; no test changes were needed.

## Self-Check: PASSED

- [x] `src/main/ipc/voice.ts` modified — confirmed `ensureVoiceSessionManager` at line 276
- [x] `src/renderer/features/voice/useVoiceSession.ts` modified — confirmed `_ipcSubscriberCount` at line 461
- [x] Commit `1771ce0` exists (Task 1)
- [x] Commit `4aab0b5` exists (Task 2)
- [x] Typecheck: 84 errors (flat baseline)
- [x] Voice tests: 137/137 pass
- [x] `_ipcSubscribed` does NOT appear in useVoiceSession.ts
- [x] Inline `if (!deps.voiceSessionManager && deps.dbHolder.db` inside `registerVoiceHandlers` body removed
