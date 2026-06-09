---
phase: quick-260609-poa
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/main/ipc/voice.ts
  - src/renderer/features/voice/useVoiceSession.ts
autonomous: true
requirements: []

must_haves:
  truths:
    - "After vault unlock, VOICE_FEED_ANSWER log shows hasManager:TRUE (not false)"
    - "A single STT transcript fires voiceFeedAnswer exactly once (not 5x in the same ms)"
    - "No new ipcMain.handle registrations are added for any existing VOICE_* channel"
    - "npm run typecheck exits with no new errors (baseline 84)"
  artifacts:
    - path: src/main/ipc/voice.ts
      provides: "ensureVoiceSessionManager() lazy-init helper called inside VOICE_FEED_ANSWER/VOICE_ABORT/VOICE_LATENCY_MARK handlers"
    - path: src/renderer/features/voice/useVoiceSession.ts
      provides: "module-level ref-count guard on the singleton store so subscribeToIpc installs real listeners on 0→1 and tears them down only on N→0"
  key_links:
    - from: "VOICE_FEED_ANSWER handler (voice.ts:535)"
      to: "deps.voiceSessionManager"
      via: "ensureVoiceSessionManager(deps) call at handler invocation time"
      pattern: "ensureVoiceSessionManager"
    - from: "useVoiceSession hook (useVoiceSession.ts)"
      to: "store.subscribeToIpc"
      via: "module-level _ipcSubscriberCount ref-count guard; real listeners fire on 0→1, tear down on N→0"
      pattern: "_ipcSubscriberCount"
---

<objective>
Fix two bugs that together silenced all voice answer output after STT.

Bug 1 (no output): VoiceSessionManager is created inline at handler-registration time inside
registerVoiceHandlers(). At that point deps.dbHolder.db is null (vault not yet unlocked), so
the guard fails and deps.voiceSessionManager stays undefined. VOICE_FEED_ANSWER permanently
takes the hasManager:false stub branch returning {ok:true} with no answer. Fix: extract an
ensureVoiceSessionManager(deps) helper that creates the manager lazily the first time any
handler that needs it is invoked (db is live by then).

Bug 2 (5x dispatch): useVoiceSession() is a React hook backed by a module-level singleton
store, but the subscribedRef guard is per-component-instance. N mounted consumers register N
onVoiceTranscript listeners on the same store, producing N voiceFeedAnswer sends per
transcript. Fix: promote the subscription guard to a module-level ref-count on the singleton
so real IPC listeners are installed exactly once (on 0→1) and torn down only when the last
consumer unmounts (N→0). Partial unmount (e.g. navigating away from BriefingScreen while
App.tsx, Topbar.tsx, VoicePTTButton.tsx, VoiceHUDBand.tsx remain mounted) is safe.

Purpose: Voice turns will produce actual LLM answers instead of silent {ok:true} stubs.
Output: Modified voice.ts (lazy manager init) + modified useVoiceSession.ts (safe ref-counted IPC subscription).
</objective>

<execution_context>
@C:\Users\HomePC\.claude\get-shit-done\workflows\execute-plan.md
@C:\Users\HomePC\.claude\get-shit-done\templates\summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md

Key interfaces already read by planner — executor does not need to re-read full files:

From src/main/ipc/voice.ts:
- VoiceHandlersDeps.voiceSessionManager is optional (line 209-219)
- VoiceHandlersDeps.dbHolder: DbHolder — has a .db property (null pre-unlock, live post-unlock)
- VoiceHandlersDeps.emitToRenderer is optional (line 205)
- VoiceHandlersDeps.sessionAbortControllers is optional (line 207)
- createVoiceSessionManager() is already imported from ../voice/voice-session-manager (line 46)
- The inline creation block at lines 299-312 is the exact code to extract into a helper
- VOICE_FEED_ANSWER handler is at line 528; VOICE_ABORT at line 494; VOICE_LATENCY_MARK at line 551

From src/renderer/features/voice/useVoiceSession.ts:
- Module-level singleton: _singleton (line 429) + getSessionStore() (line 431)
- useVoiceSession hook: subscribedRef per-instance guard at line 462-477
- store.subscribeToIpc delegates to actions.subscribeToIpc (line 420-422)
- actions.subscribeToIpc registers aria.onVoiceTranscript + aria.onVoiceState + aria.onVoiceModelProgress (lines 376-405)
- The preload onVoiceTranscript (src/preload/index.ts) does NOT deduplicate — each call adds a new ipcRenderer.on listener

From src/main/index.ts (bootstrap):
- registerVoiceHandlers is called ONCE at app-ready (line 430), before vault unlock, passing
  dbHolder whose .db is null at that point
- The bootPoll (line 501) fires post-unlock but does NOT re-create the voice manager
- The entitlement pattern (lines 453-496) uses removeHandler + re-registerHandlers in bootPoll
  but voice does NOT need that — the existing handler closure already reads deps.voiceSessionManager
  live; a single lazy assignment inside the handler is sufficient
</context>

<tasks>

<task type="auto">
  <name>Task 1: Lazy-init VoiceSessionManager in main-process voice IPC</name>
  <files>src/main/ipc/voice.ts</files>
  <action>
Extract an ensureVoiceSessionManager helper function (not exported) immediately above
registerVoiceHandlers, with this signature:

  function ensureVoiceSessionManager(deps: VoiceHandlersDeps, logger: Logger): void

The body is the exact block currently at lines 299-312, moved verbatim:
  - Guard: if (!deps.voiceSessionManager && deps.dbHolder.db && deps.emitToRenderer)
  - Create abortControllers map if deps.sessionAbortControllers is absent, assign to both
    deps.sessionAbortControllers and a local const
  - Call createVoiceSessionManager({ db: deps.dbHolder.db, logger, emitToRenderer: deps.emitToRenderer, sessionAbortControllers })
  - Assign the result to deps.voiceSessionManager

Inside registerVoiceHandlers, delete the existing inline block (lines 299-312) and replace
it with nothing (the manager is no longer created eagerly at registration time).

Inside the three handlers that use deps.voiceSessionManager, add a call to
ensureVoiceSessionManager(deps, logger) as the FIRST line of the handler body (before any
other logic), so the manager is created on the first invocation after unlock:
  - VOICE_FEED_ANSWER handler (the one at line 528 with the hasManager log)
  - VOICE_ABORT handler (line 494 — uses deps.voiceSessionManager.onBargeIn)
  - VOICE_LATENCY_MARK handler (line 551 — uses deps.voiceSessionManager.markLatency)

Do NOT touch VOICE_CONFIRM_APPROVAL, VOICE_CANCEL_APPROVAL, VOICE_GET_PREFS, VOICE_SET_PREFS,
VOICE_FEED_AUDIO, or any other handler — they do not use voiceSessionManager.
Do NOT add or remove any ipcMain.handle call.
Do NOT remove the [diag 260609] logger.info lines — they are the verification instrument.
  </action>
  <verify>
    <automated>cd C:\Users\HomePC\Documents\GitHub\Aria && npx tsc --noEmit --project tsconfig.json 2>&amp;1 | tail -20</automated>
  </verify>
  <done>
    typecheck exits with 0 new errors vs the 84-error baseline.
    grep confirms "ensureVoiceSessionManager" appears in the file.
    grep confirms the inline block "if (!deps.voiceSessionManager &amp;&amp; deps.dbHolder.db" is gone from inside registerVoiceHandlers body.
  </done>
</task>

<task type="auto">
  <name>Task 2: Ref-counted IPC subscription on the singleton voice session store</name>
  <files>src/renderer/features/voice/useVoiceSession.ts</files>
  <action>
Add two module-level variables immediately after the _singleton declaration (line 429) —
outside createVoiceSessionStore, scoped to the singleton only:

  let _ipcSubscriberCount = 0;
  let _ipcUnsub: (() => void) | null = null;

Modify the store-level subscribeToIpc wrapper (lines 420-422) inside the object returned by
createVoiceSessionStore to implement a ref-count rather than a boolean flag:

  subscribeToIpc(aria: AriaApi): () => void {
    _ipcSubscriberCount++;
    if (_ipcSubscriberCount === 1) {
      _ipcUnsub = actions.subscribeToIpc(aria); // install real listeners once, on 0→1
    }
    return () => {
      _ipcSubscriberCount--;
      if (_ipcSubscriberCount === 0 && _ipcUnsub) {
        _ipcUnsub();   // tear down only when the LAST consumer unmounts
        _ipcUnsub = null;
      }
    };
  },

Rationale: there are 5 simultaneous consumers of useVoiceSession() in the production tree
(App.tsx, Topbar.tsx, VoicePTTButton.tsx, VoiceHUDBand.tsx, BriefingScreen.tsx). A boolean
no-op design gives only the first mounter a real unsubscriber; when that consumer unmounts
(e.g. navigating away from BriefingScreen) while the others remain mounted, the real
unsubscriber tears down all three IPC channels for ALL remaining consumers. The ref-count
ensures every consumer receives a meaningful decrementing unsubscriber, and real listeners
are torn down only when count reaches 0.

_ipcSubscriberCount and _ipcUnsub are declared at module scope (outside createVoiceSessionStore)
so they are shared across all callers of the singleton. The createVoiceSessionStore factory
itself is not modified — tests that call the factory directly receive fresh instances and
bypass the singleton variables entirely, keeping them unaffected.

The per-component subscribedRef in useVoiceSession() hook (lines 462-477) can stay as-is —
it is now defense-in-depth but harmless, and removing it would widen the diff unnecessarily.

Do NOT remove the [diag 260609] lines anywhere.
Do NOT introduce a boolean _ipcSubscribed flag — use only _ipcSubscriberCount and _ipcUnsub.
  </action>
  <verify>
    <automated>cd C:\Users\HomePC\Documents\GitHub\Aria && npx tsc --noEmit --project tsconfig.json 2>&amp;1 | tail -20</automated>
  </verify>
  <done>
    typecheck exits with 0 new errors vs the 84-error baseline.
    grep confirms "_ipcSubscriberCount" appears in the file and "_ipcSubscribed" does NOT.
    In the running app after both fixes: the [diag 260609] log for voice.feedAnswer startAnswer
    shows hasManager:TRUE, and only ONE log line fires per STT transcript (not 5).
    Navigating away from BriefingScreen while the other 4 consumers remain mounted does NOT
    silence subsequent transcripts (count drops to 4, real listeners stay live).
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| renderer → main (VOICE_FEED_ANSWER) | question string crosses IPC from untrusted renderer |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-poa-01 | Spoofing | ensureVoiceSessionManager — reads deps.dbHolder.db | accept | db is the real unlocked DB object from the trusted main-process dbHolder; no renderer input touches this path |
| T-poa-02 | Denial of Service | _ipcSubscriberCount ref-count — real listeners tear down only at count=0 | accept | count is bounded by the number of mounted components (5 in production); partial unmount is safe by design; count reaching 0 correctly tears down and resets for next mount cycle |
</threat_model>

<verification>
After executing both tasks, manually verify with pnpm dev:

1. Start app, unlock vault.
2. Press PTT, speak a short question (e.g. "What is on my calendar today").
3. Check electron main-process logs:
   - voice.feedAudio received: pcmBytes > 0 (audio captured)
   - voice.stt cloud result: textLen > 0, hasError: false (STT produced transcript)
   - voice.feedAnswer startAnswer: hasManager: TRUE (Bug 1 fixed)
   - voice.feedAnswer startAnswer appears EXACTLY ONCE per PTT press (Bug 2 fixed)
4. TTS audio plays back with an answer (end-to-end voice turn complete).
</verification>

<success_criteria>
- hasManager log field = true on the first voice turn after unlock
- voice.feedAnswer startAnswer log fires exactly once per transcript (not 5x)
- npm run typecheck reports 0 new errors vs the 84-error baseline
- Existing voice tests pass: pnpm test --reporter=verbose src/renderer/features/voice
</success_criteria>

<output>
After completion, create .planning/quick/260609-poa-fix-voice-answer-output-lazy-init-post-u/260609-poa-SUMMARY.md
</output>
