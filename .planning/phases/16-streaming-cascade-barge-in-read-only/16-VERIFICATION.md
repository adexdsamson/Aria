---
phase: 16-streaming-cascade-barge-in-read-only
verified: 2026-06-07T22:00:00Z
status: gaps_closed
score: 13/13 (the 1 partial gap closed post-verification in f168a6a; 5 runtime-smoke items remain as deferred human-verify by user decision)
overrides_applied: 0
gap_closures:
  - truth: "Aria speaks /ask answers aloud — streaming TTS cascade active on /ask route"
    resolved_by: "f168a6a"
    note: "VoiceHUDBandConnected in App.tsx now calls useKokoroPlayer() and passes player={player} (mode defaults to 'ask', no briefing Skip). /ask route no longer falls back to noopPlayer. typecheck 0 new; renderer voice specs 22/22 green; briefing route unchanged."
gaps:
  - truth: "Aria speaks /ask answers aloud — streaming TTS cascade active on /ask route"
    status: resolved (was partial; closed in f168a6a)
    reason: >
      VoiceSessionManager, streamVoiceAnswer, TtsSegmenter, and VOICE_TTS_CHUNK push are all
      correctly implemented. VoiceHUDBand subscribes to VOICE_TTS_CHUNK and enqueues chunks.
      However, the App-shell VoiceHUDBandConnected in src/renderer/app/App.tsx renders
      <VoiceHUDBand state={voiceState} transcript={liveTranscript} /> WITHOUT passing a player
      prop. VoiceHUDBand falls back to a noopPlayer (speak: async () => undefined) when player
      is absent. Result: VOICE_TTS_CHUNK chunks are enqueued but produce no audio on the /ask
      route. BriefingScreen (SC1) is fully wired with a real player and is unaffected. To fix:
      App.tsx VoiceHUDBandConnected needs to call useKokoroPlayer() and pass the result as
      player, OR AskScreen needs its own VoiceHUDBand with player (same pattern as BriefingScreen).
    artifacts:
      - path: "src/renderer/app/App.tsx"
        issue: "VoiceHUDBandConnected renders <VoiceHUDBand> without player prop — noopPlayer used; VOICE_TTS_CHUNK chunks produce no audio on /ask route"
      - path: "src/renderer/features/voice/VoiceHUDBand.tsx"
        issue: "Transport controls and VOICE_TTS_CHUNK subscription exist; audio only plays when player prop is provided (line 318: state==='speaking' && player)"
    missing:
      - "Pass a real KokoroPlayerHandle to the App-shell VoiceHUDBandConnected (call useKokoroPlayer() in VoiceHUDBandConnected or add a player prop to it), OR add a VoiceHUDBand with player inside AskScreen"
human_verification:
  - test: "SC1 — Briefing read-aloud: pause / skip-section / speed (0.5-2x)"
    expected: >
      Navigate to /briefing. Click Read Aloud. Aria reads calendar, then email, then news.
      Pause button freezes audio promptly. Resume continues from the pause point.
      Skip button cancels current section and advances to next.
      Set speed to 1.5x — audio is perceptibly faster; no chipmunk pitch shift.
      Set speed to 0.5x — audio is slower; no slur.
    why_human: "Perceptual audio quality (prosody, pitch-neutrality, pause timing) requires listening. Test 4 in 16-04b checkpoint."
  - test: "SC2 — /ask streaming first audio p50 <900ms + voice_latency_log telemetry (AFTER gap fix)"
    expected: >
      After fixing the App.tsx VoiceHUDBandConnected player wiring: hold PTT on /ask, ask a
      question. First Kokoro audio starts within ~1 second of PTT release (p50 target).
      With ARIA_DEBUG=1: check voice_latency_log — all four columns t_llm_first_token,
      t_first_sentence_ready, t_kokoro_synth_start, t_first_audio_out should be populated.
    why_human: "Latency feel and per-stage timing require a running pnpm dev session + ARIA_DEBUG=1. Test 1 in 16-04b checkpoint."
  - test: "SC3 — Barge-in cancels within <200ms and no leftover audio"
    expected: >
      While Aria is speaking an /ask answer, press PTT. Aria stops promptly (<1s perceived);
      HUD transitions to 'listening'; the new turn starts. No old audio resumes after barge-in.
    why_human: "Timing feel and audio drain require listening. Test 2 in 16-04b checkpoint."
  - test: "SC4 — Multi-turn referent resolution"
    expected: >
      Ask 'Who is Elon Musk?' (answer spoken aloud). Then without naming anyone, ask 'What
      company did he found?' Aria should answer about SpaceX/Tesla — resolving 'he' from
      thread history.
    why_human: "Requires live LLM + RAG + thread context; cannot be unit-asserted. Test 3 in 16-04b checkpoint."
  - test: "SC5 — Backchannel does not interrupt (PTT-only by construction)"
    expected: >
      While Aria is speaking, do NOT press PTT — listen passively. Aria continues uninterrupted
      regardless of ambient noise or voice. Only a PTT press should trigger barge-in.
    why_human: "Requires ambient noise observation in a live session. Test 5 in 16-04b checkpoint (pass by construction — verified by useVoiceSession.spec.ts no-barge-in-guard, but runtime confirmation still needed)."
---

# Phase 16: Streaming Cascade + Barge-in (read-only) Verification Report

**Phase Goal:** Aria holds a natural spoken conversation over read-only surfaces — it starts speaking before it finishes thinking, the user can interrupt and be heard immediately, and context carries across turns. Zero write risk.
**Verified:** 2026-06-07T22:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | TtsSegmenter flushes ~8-word first chunk then accumulates sentences with abbreviation deny-list (D-04) | VERIFIED | `src/main/voice/tts-segmenter.ts` lines 57-135; dual-regime push(); ABBREVIATION_RE + DECIMAL_RE guards; 9/9 unit tests green (tts-segmenter.spec.ts) |
| 2 | streamVoiceAnswer exists alongside ask() as standalone export, LOCAL-route only, onChunk accumulator (D-03, AI SDK #8088 mitigation) | VERIFIED | `src/main/rag/answer-service.ts` lines 518-602; standalone export after `createAnswerService`; LOCAL buildLocalPrompt only; onChunk accumulates via `chunk.text` (not `chunk.textDelta`); ask() entirely untouched |
| 3 | VoiceSessionManager per-turn AbortController + spokenSoFar accumulator in onChunk + D-12 onBargeIn writes synthetic [interrupted] turn via appendTurn | VERIFIED | `src/main/voice/voice-session-manager.ts` lines 110-175; accumulator at line 132; appendTurn synthetic turn at lines 183-189; 3/3 spec tests green (voice-session-manager.spec.ts) |
| 4 | voice_latency_log table with 4 stage columns; writeVoiceLatencyLog ARIA_DEBUG-gated; all 4 t_* columns populatable via onChunk + markLatency | VERIFIED | Migration 136 (`src/main/db/migrations/136_voice_latency_log.sql`); `voice-latency-log.ts` lines 60-79; markLatency in VoiceSessionManager lines 192-207; renderer fires VOICE_LATENCY_MARK for kokoro_synth_start + first_audio_out in VoiceHUDBand; 4/4 latency-log spec tests green |
| 5 | bargeIn() renderer-first: AudioBufferSourceNode.stop() via cancel() + fire-and-forget voiceAbort IPC; half-duplex preserved (D-01/D-02) | VERIFIED | `useVoiceSession.ts` lines 262-276; bargeIn() guards voiceState!=='speaking' (SC5 by construction); fires window.aria.voiceAbort without await; 13/13 useVoiceSession.spec.ts + 5/5 half-duplex.spec.ts green |
| 6 | useReadAloudQueue promise-chain queue (D-05): in-order speak, cancel resets queue + stops source (Pitfall 5 fix) | VERIFIED | `useReadAloudQueue.ts` lines 43-68; queueRef promise-chain; cancel() = Promise.resolve() + player.cancel(); 4/4 useReadAloudQueue.spec.ts green |
| 7 | KokoroPlayerHandle.speak(speed) + cancel() + suspend() + resume() all implemented (D-08/D-09, WARNING 3 fix) | VERIFIED | `useKokoroPlayer.ts` lines 91-282; speed threaded to generate() at line 221; cancel() stops sourceRef; suspend()/resume() guard audioCtx.state |
| 8 | BriefingScreen reads BriefingPayload sections via useReadAloudQueue — no LLM streaming (D-07/D-10, Pitfall 4) | VERIFIED | `BriefingScreen.tsx` imports useReadAloudQueue, VoiceHUDBand with player+mode="briefing"; buildSectionText() reads stored payload; 0 matches for generateObject/streamText/runBriefing in BriefingScreen; section walker over ['calendar','email','news']; Read Aloud + Stop buttons present |
| 9 | VoiceHUDBand transport controls (pause/resume/skip/speed 0.5-2x) visible when speaking; VOICE_TTS_CHUNK subscription enqueues to queue | VERIFIED | `VoiceHUDBand.tsx` lines 318-443; transport sub-row conditioned on `state==='speaking' && player`; VOICE_TTS_CHUNK subscription at lines 172-193; kokoro_synth_start + first_audio_out marks at lines 196-228 |
| 10 | 5 new IPC channels in CHANNELS + CHANNEL_METHODS + AriaApi + preload; handler-count invariant green at 154 | VERIFIED | `ipc-contract.ts` lines 194-199; preload override for VOICE_TTS_CHUNK at index.ts line 80; 4/4 ipc/index.spec.ts green |
| 11 | Multi-turn context via threadId + getThread(lastN:6) — referent resolution implicit via LLM prompt history (D-11) | VERIFIED | VoiceSessionManager `startAnswer` lines 86-99 creates thread on first turn, persists sessions Map; streamVoiceAnswer lines 556-559 loads getThread(lastN:6) for threadHistory |
| 12 | D-13 read-only ratchet: no write chokepoint imported in src/main/voice/** or src/renderer/features/voice/** | VERIFIED | `voice-streaming-no-write.spec.ts` walks both dirs; 5 chokepoints checked; 1/1 test green; 20/20 static ratchets green (70 tests) |
| 13 | Aria speaks /ask answers aloud — streaming TTS cascade active on /ask route | PARTIAL — gap found | VoiceSessionManager, streamVoiceAnswer, VOICE_TTS_CHUNK push all correct. VoiceHUDBand VOICE_TTS_CHUNK subscription exists. HOWEVER: App.tsx VoiceHUDBandConnected renders VoiceHUDBand WITHOUT player prop → noopPlayer used → VOICE_TTS_CHUNK chunks produce no audio on /ask route. BriefingScreen (SC1) is unaffected. |

**Score:** 12/13 truths verified (1 partial gap)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/main/voice/tts-segmenter.ts` | D-04 hybrid segmenter | VERIFIED | 136 lines; TtsSegmenter class with push()/flush(); ABBREVIATION_RE + DECIMAL_RE deny-lists |
| `src/main/voice/voice-latency-log.ts` | D-06 debug-gated writer | VERIFIED | 80 lines; writeVoiceLatencyLog + readRecentVoiceLatencyLog; ARIA_DEBUG gate |
| `src/main/voice/voice-session-manager.ts` | D-11/D-12 session manager | VERIFIED | 216 lines; createVoiceSessionManager factory; startAnswer/onBargeIn/markLatency/getSession |
| `src/main/rag/answer-service.ts` | streamVoiceAnswer alongside ask() | VERIFIED | Lines 518-602; standalone export; ask() at line 237 untouched |
| `src/main/db/migrations/136_voice_latency_log.sql` | voice_latency_log DDL | VERIFIED | 5 columns + index; appended at tail of EMBEDDED_MIGRATIONS (after migration 135) |
| `src/renderer/features/voice/useVoiceSession.ts` | bargeIn/pause/resume + paused state | VERIFIED | bargeIn() lines 262-276; pause()/resume() lines 278-289; paused boolean in VoiceSessionState |
| `src/renderer/features/voice/useReadAloudQueue.ts` | D-05 promise-chain queue | VERIFIED | 69 lines; enqueue/cancel; correct Pitfall 5 fix |
| `src/renderer/features/voice/tts/useKokoroPlayer.ts` | speed/cancel/suspend/resume | VERIFIED | KokoroPlayerHandle lines 91-130; all 4 methods implemented |
| `src/renderer/features/voice/VoiceHUDBand.tsx` | transport controls + VOICE_TTS_CHUNK | VERIFIED | Transport sub-row present; VOICE_TTS_CHUNK subscription; latency marks |
| `src/renderer/features/briefing/BriefingScreen.tsx` | Section walker + VoiceHUDBand(player) | VERIFIED | VoiceHUDBand rendered with player + mode="briefing"; Read Aloud button; section walker |
| `tests/static/voice-streaming-no-write.spec.ts` | D-13 read-only ratchet | VERIFIED | 102 lines; both voice dirs walked; 5 chokepoints; GREEN |
| `src/main/ipc/voice.ts` | 5 new handlers registered | VERIFIED | VOICE_TTS_CHUNK, VOICE_ABORT, DIAGNOSTICS_VOICE_LATENCY, VOICE_FEED_ANSWER, VOICE_LATENCY_MARK all registered; VOICE_ABORT wires onBargeIn + AbortController; VOICE_FEED_ANSWER calls voiceSessionManager.startAnswer |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| VoiceSessionManager.startAnswer | streamVoiceAnswer | `streamVoiceAnswer(deps, { question, threadId, signal, onChunk, onDone })` | WIRED | voice-session-manager.ts line 126 |
| streamVoiceAnswer onChunk | TtsSegmenter.push | `segmenter.push(delta)` in VoiceSessionManager onChunk | WIRED | voice-session-manager.ts lines 135-136 |
| TtsSegmenter chunks | VOICE_TTS_CHUNK push | `emitToRenderer(CHANNELS.VOICE_TTS_CHUNK, { text: chunk, sessionId })` | WIRED | voice-session-manager.ts line 146 |
| VOICE_TTS_CHUNK push | VoiceHUDBand VOICE_TTS_CHUNK subscription | `window.aria.onVoiceTtsChunk(chunk => queue.enqueue(chunk.text))` | WIRED (shell HUD — but noopPlayer) | VoiceHUDBand.tsx lines 172-193 |
| VOICE_TTS_CHUNK → briefing route | BriefingScreen VoiceHUDBand queue | VoiceHUDBand rendered with real player in BriefingScreen | WIRED | BriefingScreen.tsx lines 389-396 |
| VOICE_TTS_CHUNK → /ask route | App shell VoiceHUDBandConnected | App.tsx VoiceHUDBandConnected passes no player → noopPlayer | NOT WIRED (audio) | App.tsx line 243 — missing player prop |
| bargeIn() | voiceAbort IPC (fire-and-forget) | `(window.aria as AriaApi).voiceAbort?.({ sessionId })` | WIRED | useVoiceSession.ts line 272 |
| VOICE_ABORT IPC | AbortController.abort() + onBargeIn | `deps.sessionAbortControllers?.get(req.sessionId)?.abort(); deps.voiceSessionManager.onBargeIn(...)` | WIRED | voice.ts lines 213-216 |
| BriefingScreen "Read Aloud" | useReadAloudQueue.enqueue | `setCurrentSectionIndex(0)` → useEffect → `queue.enqueue(sectionTexts[idx])` | WIRED | BriefingScreen.tsx lines 190-198 |
| BriefingScreen skip | queue.cancel() + index advance | `handleSkipSection: queue.cancel(); setCurrentSectionIndex(idx+1)` | WIRED | BriefingScreen.tsx lines 202-211 |
| VOICE_LATENCY_MARK IPC | VoiceSession.t_kokoro_synth_start / t_first_audio_out | `deps.voiceSessionManager?.markLatency(...)` in voice.ts handler | WIRED | voice.ts lines 268-274 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| VoiceSessionManager | spokenSoFar | streamVoiceAnswer onChunk callbacks (chunk.text from AI SDK streamText) | Yes — real LLM token stream | FLOWING |
| voice-latency-log | t_llm_first_token, t_first_sentence_ready | Computed in VoiceSessionManager onChunk (Date.now() - session.startMs) | Yes | FLOWING |
| voice-latency-log | t_kokoro_synth_start, t_first_audio_out | Renderer VOICE_LATENCY_MARK IPC → markLatency → session fields | Yes (renderer timing) | FLOWING |
| BriefingScreen read-aloud | sectionTexts | buildSectionText() over loaded BriefingPayload (real IPC data) | Yes — reads real briefing payload | FLOWING |
| VoiceHUDBand (/ask route) | VOICE_TTS_CHUNK queue | noopPlayer (player prop absent in App.tsx) | NO — no audio output | HOLLOW_PROP |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TtsSegmenter 9 unit tests | `npx vitest run tts-segmenter.spec.ts --no-file-parallelism` | 9/9 PASS | PASS |
| voice-session-manager spec (onChunk accumulator, fast-abort, D-12) | `npx vitest run voice-session-manager.spec.ts --no-file-parallelism` | 3/3 PASS | PASS |
| voice-latency-log spec | `npx vitest run voice-latency-log.spec.ts --no-file-parallelism` | 4/4 PASS | PASS |
| useVoiceSession spec (bargeIn/pause/resume/paused) | `npx vitest run useVoiceSession.spec.ts --no-file-parallelism` | 13/13 PASS | PASS |
| useReadAloudQueue spec | `npx vitest run useReadAloudQueue.spec.ts --no-file-parallelism` | 4/4 PASS | PASS |
| half-duplex spec (D-01 barge-in behavior change) | `npx vitest run half-duplex.spec.ts --no-file-parallelism` | 5/5 PASS | PASS |
| D-13 read-only ratchet | `npx vitest run voice-streaming-no-write.spec.ts --no-file-parallelism` | 1/1 PASS | PASS |
| IPC handler-count invariant (154 CHANNELS) | `npx vitest run tests/unit/main/ipc/index.spec.ts --no-file-parallelism` | 4/4 PASS | PASS |
| Full static ratchet suite | `npx vitest run tests/static/ --no-file-parallelism` | 70/70 PASS | PASS |
| Full runtime cascade (SC1–SC5) | `pnpm dev` + human audio verification | NOT RUN — deferred per user decision | SKIP (deferred) |

### Probe Execution

No `scripts/*/tests/probe-*.sh` declared for this phase. Step 7c: SKIPPED (no probes declared).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| VOICE-02 | 16-03, 16-04b | Aria reads daily briefing aloud with pause/skip/speed controls | SATISFIED (code-complete; runtime pending) | BriefingScreen VoiceHUDBand(player, mode="briefing") + Read Aloud button + section walker; pause/resume/skip/speed slider 0.5-2x all wired |
| VOICE-03 | 16-02, 16-04a, 16-04b | Aria speaks /ask answers aloud (streaming first sentence) | PARTIAL | VoiceSessionManager + streamVoiceAnswer + TtsSegmenter + VOICE_TTS_CHUNK push: correct. Renderer audio output on /ask route: NOT WIRED (App.tsx VoiceHUDBandConnected lacks player) |
| VOICE-06 | 16-03, 16-04a | Multi-turn context + barge-in via single AbortController | SATISFIED (code-complete; runtime pending) | AbortController per turn in VoiceSessionManager; bargeIn() PTT-to-interrupt; D-12 synthetic turn; threadId + getThread(lastN:6) for multi-turn context |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/renderer/app/App.tsx` | 243 | `<VoiceHUDBand>` rendered without `player` prop | WARNING | No audio output from VOICE_TTS_CHUNK for /ask route — noopPlayer silently discards chunks |

No TBD/FIXME/XXX/TODO debt markers found in any Phase 16 modified files.

### Human Verification Required

#### 1. SC1 — Briefing Read Aloud (pause / skip-section / speed 0.5-2x)

**Test:** Navigate to /briefing in `pnpm dev`. Click "Read Aloud". Listen through calendar, email, news sections. Test pause (freezes audio), resume (continues). Test skip (advances to next section). Test 1.5x speed (faster, pitch-neutral). Test 0.5x (slower, no slur).
**Expected:** All three sections read without choppy mid-clause artifacts. Pause/resume bit-perfect. Skip cancels immediately. Speed range 0.5-2x pitch-neutral (Kokoro generate({speed}) not playbackRate).
**Why human:** Perceptual audio quality cannot be unit-asserted. Also confirms player initialization succeeds.

#### 2. SC2 — /ask Streaming First Audio <900ms + Telemetry (AFTER gap fix)

**Pre-condition:** Fix App.tsx VoiceHUDBandConnected to pass a real player.
**Test:** Hold PTT on /ask, ask "What are three tips for effective meetings?". Time from PTT release to first audio.
**Expected:** First audio starts within ~1 second. With ARIA_DEBUG=1: voice_latency_log row shows t_llm_first_token, t_first_sentence_ready, t_kokoro_synth_start, t_first_audio_out all populated.
**Why human:** End-to-end latency feel + telemetry confirmation require a live session.

#### 3. SC3 — Barge-in (<200ms + no leftover audio)

**Test:** While Aria is speaking an /ask answer, press PTT. Observe stop timing and HUD transition.
**Expected:** Audio stops promptly (<1s perceived); HUD transitions to 'listening'; no old audio resumes after barge-in completes.
**Why human:** Timing perception and audio drain behavior require listening.

#### 4. SC4 — Multi-turn Referent Resolution

**Test:** Ask "Who is Elon Musk?" (answer spoken). Then ask "What company did he found?" (no name given).
**Expected:** Aria resolves "he" from thread history and answers about SpaceX/Tesla.
**Why human:** Requires live LLM + RAG + thread context integration.

#### 5. SC5 — Backchannel Non-Interruption

**Test:** While Aria is speaking, do NOT press PTT. Observe with ambient noise or soft speech.
**Expected:** No interruption — PTT-only barge-in by construction means ambient sound cannot trigger barge-in.
**Why human:** Ambient noise behavior requires live audio observation (though proven by construction via the voiceState guard in useVoiceSession.ts bargeIn()).

---

## Gaps Summary

**1 gap blocks full VOICE-03 audio on /ask route:**

The `VoiceHUDBandConnected` component in `src/renderer/app/App.tsx` (line 243) renders `<VoiceHUDBand state={voiceState} transcript={liveTranscript} />` without passing a `player` prop. VoiceHUDBand's VOICE_TTS_CHUNK subscription enqueues chunks into `useReadAloudQueue(activePlayer, speed)` where `activePlayer` falls back to a no-op player when `player` is absent. The no-op player's `speak()` is `async () => undefined`, so VOICE_TTS_CHUNK chunks produce no audio on the /ask route.

**Fix (minimal):** In `VoiceHUDBandConnected`, call `useKokoroPlayer()` and pass the result as `player`:

```tsx
function VoiceHUDBandConnected(): JSX.Element {
  const { voiceState, liveTranscript } = useVoiceSession();
  const player = useKokoroPlayer();   // add this
  return <VoiceHUDBand state={voiceState} transcript={liveTranscript} player={player} />;
}
```

This is not deferred to Phase 17 — Phase 17 covers voice-confirm/writes, not the basic /ask audio output. The SC2 human-verify test (Test 1) would fail at runtime without this fix.

**Why SC1 (briefing) is unaffected:** BriefingScreen creates its own VoiceHUDBand with `player={player}` (real `useKokoroPlayer()` instance). The /ask gap is specific to the App shell's `VoiceHUDBandConnected`.

---

*Verified: 2026-06-07T22:00:00Z*
*Verifier: Claude (gsd-verifier)*
