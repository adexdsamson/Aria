---
phase: 16-streaming-cascade-barge-in-read-only
plan: 04b
type: execute
wave: 2
depends_on: [16-02, 16-03]
files_modified:
  - src/renderer/features/voice/VoiceHUDBand.tsx
  - src/renderer/features/briefing/BriefingScreen.tsx
autonomous: false
requirements: [VOICE-02, VOICE-03, VOICE-06]

must_haves:
  truths:
    # D-07 briefing read-aloud
    - "BriefingScreen reads BriefingPayload sections (calendar/email/news) as pre-built text — no LLM streaming per Pitfall 4 / D-07"
    - "Skip (currentSectionIndex++) stops current section audio via queue.cancel() and starts next per D-10"
    # D-09 transport controls wired
    - "VoiceHUDBand shows pause/resume/skip/speed controls when voiceState==='speaking' per D-09/D-10"
    - "Speed slider range 0.5–2x calls Kokoro generate({speed}) re-synth at section boundaries per D-08"
    - "Pause calls session.pause() + player.suspend() — both state flag and AudioContext gate per D-09 WARNING 3 (known interface from 16-03)"
    - "Resume calls session.resume() + player.resume() — both state flag and AudioContext resume per D-09"
    # VOICE_TTS_CHUNK subscription
    - "VoiceHUDBand subscribes to onVoiceTtsChunk push channel and enqueues each chunk into useReadAloudQueue per D-05"
    # VOICE_LATENCY_MARK emission (WARNING 2 fix — renderer reports timing to main)
    - "useKokoroPlayer's onPlaybackStart / AudioBufferSourceNode.start() fires voiceLatencyMark({sessionId, mark:'first_audio_out', t:Date.now()}) per D-06 SC2"
    - "VoiceHUDBand fires voiceLatencyMark({sessionId, mark:'kokoro_synth_start', t:Date.now()}) when Kokoro generate() begins per D-06 SC2"
  artifacts:
    - path: "src/renderer/features/voice/VoiceHUDBand.tsx"
      provides: "Transport controls sub-row (pause/resume/skip/speed slider) + VOICE_TTS_CHUNK subscription + VOICE_LATENCY_MARK emissions (D-07/D-08/D-09/D-10)"
      contains: "pause|resume|skip|speed"
    - path: "src/renderer/features/briefing/BriefingScreen.tsx"
      provides: "Briefing read-aloud: walk BriefingPayload sections + useReadAloudQueue + speak button (D-07/D-10)"
      contains: "useReadAloudQueue"
  key_links:
    - from: "src/renderer/features/voice/VoiceHUDBand.tsx onVoiceTtsChunk subscription"
      to: "src/renderer/features/voice/useReadAloudQueue.ts enqueue()"
      via: "window.aria.onVoiceTtsChunk?.(chunk => queue.enqueue(chunk.text))"
      pattern: "onVoiceTtsChunk"
    - from: "src/renderer/features/briefing/BriefingScreen.tsx speak button"
      to: "useReadAloudQueue.enqueue(sectionText)"
      via: "sections[currentSectionIndex] text walked via readAloudQueue"
      pattern: "currentSectionIndex"
    - from: "src/renderer/features/voice/VoiceHUDBand.tsx Kokoro generate start"
      to: "window.aria.voiceLatencyMark (VOICE_LATENCY_MARK IPC)"
      via: "window.aria.voiceLatencyMark?.({ sessionId, mark: 'kokoro_synth_start', t: Date.now() })"
      pattern: "voiceLatencyMark"
---

<objective>
Implement the renderer-side half of the streaming cascade integration: extend VoiceHUDBand with
transport controls (pause/resume/skip/speed slider) and the VOICE_TTS_CHUNK subscription that
feeds the Kokoro playback queue; add VOICE_LATENCY_MARK emissions for SC2 per-stage telemetry;
and add the briefing read-aloud walk to BriefingScreen.

This plan covers only src/renderer/ files — zero overlap with Plan 16-04a (main process).
Both 16-04a and 16-04b depend on [16-02, 16-03] and run in parallel in Wave 2.

The human-verify checkpoint at the end of this plan smoke-tests the full cascade after both
16-04a and 16-04b have landed.

Key integration point: Plan 16-03 declared suspend()/resume() on KokoroPlayerHandle. This
plan calls them without guessing — the interface is a known contract (WARNING 3 fix respected).

Purpose: after this plan, the full streaming cascade is wired: PTT → STT (Phase 15) →
VOICE_FEED_ANSWER → VoiceSessionManager → streamVoiceAnswer → TtsSegmenter → VOICE_TTS_CHUNK →
useReadAloudQueue → Kokoro → audio, with barge-in, briefing read-aloud, and per-stage telemetry.

Output: VoiceHUDBand transport controls + VOICE_TTS_CHUNK subscription + latency marks;
BriefingScreen speak button + section walker.
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
@.planning/phases/16-streaming-cascade-barge-in-read-only/16-04a-SUMMARY.md

<interfaces>
<!-- Key contracts from Plans 16-02/16-03/16-04a that this plan uses. -->

From Plan 16-03 (now implemented):
  KokoroPlayerHandle (all Phase 16 methods — WARNING 3: these are known contracts):
    speak(text: string, options?: { speed?: number }): Promise<void>
    cancel(): void
    suspend(): void    — wraps AudioContext.suspend() — call on pause
    resume(): void     — wraps AudioContext.resume() — call on resume and barge-in

  useReadAloudQueue(player: KokoroPlayerHandle, speed: number) → { enqueue(text): void; cancel(): void }
  useVoiceSession with: bargeIn(), pause(), resume(), paused: boolean

From Plan 16-01 (contract):
  AriaApi.onVoiceTtsChunk?: (cb: (chunk: { text: string; sessionId: string }) => void) => () => void
  AriaApi.voiceLatencyMark(req: { sessionId: string; mark: 'kokoro_synth_start' | 'first_audio_out'; t: number }): Promise<void>

From 16-04a (now implemented):
  VOICE_LATENCY_MARK handler in main stores t_kokoro_synth_start and t_first_audio_out on the VoiceSession.
  Renderer emits voiceLatencyMark at Kokoro generate() start and AudioBufferSourceNode.start() for SC2.

BriefingPayload section keys (from briefing/persist.ts):
  sections: ['calendar', 'email', 'news']
  BriefingPayload.calendar / .email / .news each has text or structured items

VoiceHUDBand.tsx current structure (Phase 15 PATTERNS.md):
  ACTIVE_STATES Set determines expansion
  Uses VoiceState from voice-types.ts
  Renders per-state copy as prose inside the band
  Phase 16: add a sub-row visible only when voiceState==='speaking' with transport controls
  AudioContext access: use player.suspend() / player.resume() from the KokoroPlayerHandle
  (NOT audioContext directly — the interface method is the contract per WARNING 3 fix)
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: VoiceHUDBand transport controls + VOICE_TTS_CHUNK subscription + VOICE_LATENCY_MARK emissions (D-09/D-10/WARNING 2)</name>
  <files>src/renderer/features/voice/VoiceHUDBand.tsx</files>
  <read_first>
    - src/renderer/features/voice/VoiceHUDBand.tsx (FULL FILE — understand current structure: ACTIVE_STATES, per-state rendering, CSS, aria-live, grid-template-rows expand pattern; find where session is passed in or accessed; find where useKokoroPlayer / KokoroPlayerHandle is received or instantiated)
    - src/renderer/features/voice/useVoiceSession.ts (confirm bargeIn/pause/resume/paused are now available from Plan 16-03)
    - src/renderer/features/voice/useReadAloudQueue.ts (confirm enqueue/cancel API from Plan 16-03)
    - src/renderer/features/voice/tts/useKokoroPlayer.ts (confirm suspend()/resume() are now on KokoroPlayerHandle interface from Plan 16-03 — WARNING 3: call them directly)
    - .planning/phases/16-streaming-cascade-barge-in-read-only/16-PATTERNS.md (§ VoiceHUDBand.tsx — transport control design spec, editorial colors)
    - .planning/phases/16-streaming-cascade-barge-in-read-only/16-CONTEXT.md (D-08 speed re-synth at boundaries, D-09 AudioContext.suspend/resume via KokoroPlayerHandle, D-10 skip via currentSectionIndex)
  </read_first>
  <action>
    In src/renderer/features/voice/VoiceHUDBand.tsx:

    1. Instantiate useReadAloudQueue inside the component (or receive it as a prop if the component
    already receives the Kokoro player handle). Add a speedState (useState<number>(1.0)) for
    the speed slider.

    2. Subscribe to VOICE_TTS_CHUNK push channel inside a useEffect:
    window.aria.onVoiceTtsChunk?.((chunk) => { queue.enqueue(chunk.text); }).
    Return the unsubscribe fn on cleanup. Track the current sessionId from the chunk payload so
    voiceLatencyMark can reference it.

    3. Add transport controls sub-row rendered ONLY when voiceState === 'speaking'. Use editorial
    design system tokens (gold=#B8963E or --aria-gold, ivory=#FAF8F4 or --aria-ivory,
    ink=#1A1814 or --aria-ink, IBM Plex Mono for speed label, Playfair Display for any copy).
    The sub-row contains:
       - Pause/Resume button: when !paused calls session.pause() AND player.suspend()
       (WARNING 3: player is KokoroPlayerHandle with known suspend() — call it directly);
       when paused calls session.resume() AND player.resume().
       Label: "Pause" / "Resume". aria-label mirrors label.
       - Skip button (visible when in briefing mode — add `mode?: 'briefing' | 'ask'` prop
       defaulting to 'ask'): calls an `onSkipSection` callback prop. Label: "Skip".
       Only show when mode==='briefing'.
       - Speed slider: input type="range" min={0.5} max={2} step={0.25} value={speed}.
       onChange updates speed state. Label: speed.toFixed(2) + "×" in IBM Plex Mono.
       aria-label: "Speed". Speed re-synth happens on the NEXT enqueued chunk
       (useReadAloudQueue uses the current speed value at enqueue time).

    4. Add `onSkipSection?: () => void` prop to VoiceHUDBand props type.

    5. VOICE_LATENCY_MARK emissions (WARNING 2 fix — SC2 per-stage telemetry):
       - Fire voiceLatencyMark for 'kokoro_synth_start': in the onVoiceTtsChunk handler (or when
       enqueue() is called for the first chunk of a session), call
       window.aria.voiceLatencyMark?.({ sessionId, mark: 'kokoro_synth_start', t: Date.now() }).
       Use a ref to track whether the mark has been sent for the current session (only fire once
       per session, not once per chunk).
       - Fire voiceLatencyMark for 'first_audio_out': wire into the onPlaybackStart callback from
       the VoiceHUDBand's session subscription (Phase 15 already calls onPlaybackStart when
       voiceState transitions to 'speaking'; hook into that transition to fire the mark).
       If VoiceHUDBand does not directly observe onPlaybackStart, use a useEffect watching
       voiceState: when it transitions to 'speaking', call
       window.aria.voiceLatencyMark?.({ sessionId, mark: 'first_audio_out', t: Date.now() }).
       Use a ref to ensure the mark fires at most once per session.

    6. When barge-in fires (voiceState transitions from 'speaking' to non-speaking): call
    queue.cancel() to drain pending TTS chunks. If paused, call player.resume() first
    (Pitfall 6 — AudioContext must be resumed before barge-in playback can continue).
    Wire this in a useEffect watching voiceState: when it was 'speaking' and is now not, call
    queue.cancel() and if paused call player.resume().

    7. Keep existing HUD behavior (ACTIVE_STATES, grid expansion, aria-live, per-state copy)
    entirely intact. Transport controls are additive only.

    Run pnpm typecheck.
  </action>
  <verify>
    <automated>pnpm typecheck</automated>
  </verify>
  <acceptance_criteria>
    - source: grep "onVoiceTtsChunk\|VOICE_TTS_CHUNK" src/renderer/features/voice/VoiceHUDBand.tsx confirms push subscription
    - source: grep "pause()\|resume()\|suspend()\|player\.suspend\|player\.resume" src/renderer/features/voice/VoiceHUDBand.tsx confirms D-09 wiring via KokoroPlayerHandle interface (not raw audioContext)
    - source: grep "skip\|onSkipSection" src/renderer/features/voice/VoiceHUDBand.tsx confirms skip prop
    - source: grep "speed\|range\|0\.5.*2\|IBM Plex Mono\|toFixed" src/renderer/features/voice/VoiceHUDBand.tsx confirms speed slider (D-08)
    - source: grep "queue\.cancel\(\)" src/renderer/features/voice/VoiceHUDBand.tsx confirms Pitfall 5/6 fix (queue drained on barge-in)
    - source: grep "voiceLatencyMark\|kokoro_synth_start\|first_audio_out" src/renderer/features/voice/VoiceHUDBand.tsx confirms WARNING 2 fix (timing marks emitted per D-06 SC2)
    - test-command: pnpm typecheck exits 0
    - note: behavioral logic for useReadAloudQueue is verified by tests/unit/renderer/voice/useReadAloudQueue.spec.ts (turned GREEN in 16-03); useVoiceSession bargeIn/pause/resume verified by tests/unit/renderer/voice/useVoiceSession.spec.ts (turned GREEN in 16-03)
  </acceptance_criteria>
  <done>VoiceHUDBand has transport sub-row (pause/resume/skip/speed); VOICE_TTS_CHUNK subscription enqueues chunks; queue.cancel() called on barge-in; player.suspend()/resume() called via KokoroPlayerHandle interface; voiceLatencyMark fired for kokoro_synth_start + first_audio_out; editorial design system respected; typechecks clean.</done>
</task>

<task type="auto">
  <name>Task 2: Briefing read-aloud — walk BriefingPayload sections via useReadAloudQueue (D-07/D-10)</name>
  <files>src/renderer/features/briefing/BriefingScreen.tsx</files>
  <read_first>
    - src/renderer/features/briefing/BriefingScreen.tsx (FULL FILE — understand current structure: how BriefingPayload is loaded via BRIEFING_TODAY IPC, current section rendering, existing voice state access if any)
    - src/main/briefing/persist.ts (confirm BriefingPayload type: { calendar: {...}; email: {...}; news: {...} } with section keys)
    - src/renderer/features/voice/useReadAloudQueue.ts (enqueue/cancel API from Plan 16-03)
    - src/renderer/features/voice/VoiceHUDBand.tsx (onSkipSection prop added in Task 1)
    - .planning/phases/16-streaming-cascade-barge-in-read-only/16-CONTEXT.md (D-07 shared queue; D-10 currentSectionIndex over ['calendar','email','news']; D-09 speed at boundaries)
    - .planning/phases/16-streaming-cascade-barge-in-read-only/16-RESEARCH.md (§ Pitfall 4 — briefing read-aloud walks stored sections, NO LLM streaming)
  </read_first>
  <action>
    In src/renderer/features/briefing/BriefingScreen.tsx:

    1. Add a "Read Aloud" button in the briefing header. Editorial styling: small secondary Button
    using the existing editorial Button primitive; label "Read Aloud";
    data-testid="briefing-read-aloud-btn".

    2. Add state: const [currentSectionIndex, setCurrentSectionIndex] = useState(-1) (−1 = not reading).

    3. Build a section text array from the loaded BriefingPayload: ['calendar', 'email', 'news'].map(key =>
    buildSectionText(briefing[key])) — a helper function buildSectionText() that returns a plain
    string from the section (join item.text or item.title fields; keep it concise for TTS; no
    HTML/markdown).

    4. Wire the "Read Aloud" button onClick: when currentSectionIndex === -1, set to 0 and
    enqueue sections[0] text via queue.enqueue(). When queue finishes a section, advance
    currentSectionIndex and enqueue the next (use a useEffect watching currentSectionIndex to
    call enqueue for the corresponding section in sequence, or chain enqueues for all sections
    upfront and track progress).

    5. Pass onSkipSection={() => { queue.cancel(); setCurrentSectionIndex(idx => Math.min(idx + 1, sections.length - 1)); }} to VoiceHUDBand. Skip cancels the current section audio via
    queue.cancel() then starts the next section.

    6. A "Stop" action: when voiceState transitions out of 'speaking', call queue.cancel() and
    reset currentSectionIndex to -1 in a useEffect watching voiceState.

    7. Pass mode="briefing" to VoiceHUDBand so the skip button appears.

    DO NOT modify BriefingPayload generation, runBriefing(), briefing/generate.ts, or any backend
    briefing service. Read-aloud reads from the already-loaded payload — Pitfall 4 explicitly
    forbids touching the briefing generation path.

    Run pnpm typecheck.
  </action>
  <verify>
    <automated>pnpm typecheck</automated>
  </verify>
  <acceptance_criteria>
    - source: grep "Read Aloud\|briefing-read-aloud-btn" src/renderer/features/briefing/BriefingScreen.tsx confirms button
    - source: grep "currentSectionIndex\|sections\[" src/renderer/features/briefing/BriefingScreen.tsx confirms section walker per D-10
    - source: grep "queue\.enqueue\|useReadAloudQueue" src/renderer/features/briefing/BriefingScreen.tsx confirms shared queue (D-07)
    - source: grep "onSkipSection\|mode.*briefing" src/renderer/features/briefing/BriefingScreen.tsx confirms VoiceHUDBand integration (D-10 skip)
    - source: grep "generateObject\|streamText\|runBriefing" src/renderer/features/briefing/BriefingScreen.tsx returns NO match (Pitfall 4 guard)
    - test-command: pnpm typecheck exits 0
    - note: queue behavior is proven by tests/unit/renderer/voice/useReadAloudQueue.spec.ts (turned GREEN in 16-03)
  </acceptance_criteria>
  <done>BriefingScreen has Read Aloud button; walks BriefingPayload sections via useReadAloudQueue; skip/stop wired with queue.cancel(); mode=briefing enables skip in HUD; no LLM streaming (Pitfall 4 avoided); typechecks clean.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    Full streaming cascade end-to-end: PTT → STT (Phase 15) → VOICE_FEED_ANSWER IPC → VoiceSessionManager
    → streamVoiceAnswer → TtsSegmenter → VOICE_TTS_CHUNK push → useReadAloudQueue → Kokoro TTS → audio.
    Barge-in via PTT while speaking. Briefing read-aloud with pause/skip/speed (0.5–2x).
    Multi-turn context via RAG thread machinery. Transport controls in VoiceHUDBand.
    Per-stage telemetry: voiceLatencyMark fires kokoro_synth_start + first_audio_out so all four
    t_* columns in voice_latency_log are populated when ARIA_DEBUG=1.
  </what-built>
  <how-to-verify>
    Test 1 — /ask streaming answer:
    1. Open Aria dev build (pnpm dev).
    2. Navigate to /ask (Cmd-K or sidebar Ask Aria).
    3. Hold PTT, ask "What are three tips for effective meetings?" and release.
    4. Expected: Kokoro speaks the first sentence BEFORE the full answer finishes.
    5. Observe: first audio starts within ~1s of PTT release (SC2 first-audio p50 target).
    6. Optional (ARIA_DEBUG=1): check voice_latency_log via Settings > Diagnostics — confirm all four t_* columns populated.

    Test 2 — Barge-in (SC3):
    1. While Aria is speaking an /ask answer, press PTT again.
    2. Expected: Aria stops within < 1 second; HUD transitions to listening state; a new PTT turn starts.
    3. Observe: no leftover audio from old answer resumes.

    Test 3 — Multi-turn referent resolution (SC4):
    1. Ask "Who is Elon Musk?" (answer spoken).
    2. While on the same session, ask "What company did he found?" (without saying the name).
    3. Expected: Aria answers about SpaceX/Tesla using the thread history — "he" resolved from prior turn.

    Test 4 — Briefing read-aloud (SC1):
    1. Navigate to /briefing.
    2. Click "Read Aloud" button.
    3. Expected: Aria reads calendar section, then email, then news.
    4. Test pause button: audio pauses promptly. Test resume: audio continues.
    5. Test skip: skips to next section. Test speed at 1.5x: perceptibly faster.

    Test 5 — Backchannel vs interruption (SC5):
    1. While Aria is speaking, do NOT press PTT — just listen.
    2. Expected: no interruption regardless of ambient noise (PTT-only by construction).

    Type "approved" if all 5 tests pass. Describe issues for each that fails.
  </how-to-verify>
  <resume-signal>Type "approved" or describe which test(s) failed and what happened</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| renderer VOICE_LATENCY_MARK → main | Timing integers cross renderer→main; stored only in debug-gated latency log; no security impact |
| BriefingPayload → TTS speech | Stored briefing content (pre-generated) read aloud; no new network path |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-16-11b | Information Disclosure | VOICE_TTS_CHUNK over IPC | accept | IPC uses Electron contextBridge — renderer-only receiver; no network exposure; LOCAL-only LLM output |
| T-16-12b | Denial of Service | TTS queue growing on slow Kokoro | mitigate | queue.cancel() on barge-in and voiceState transitions; promise-chain natural backpressure |
| T-16-15b | Tampering | VOICE_LATENCY_MARK timing values | accept | Debug-only integers; no security implication; only affects telemetry accuracy |
</threat_model>

<verification>
- pnpm typecheck exits 0 after both implementation tasks.
- Tests proving behavioral logic: tests/unit/renderer/voice/useReadAloudQueue.spec.ts (GREEN from 16-03); tests/unit/renderer/voice/useVoiceSession.spec.ts (GREEN from 16-03).
- Human checkpoint Tests 1–5 pass (streaming cascade + barge-in + briefing read-aloud + multi-turn + backchannel no-op).
</verification>

<success_criteria>
- VoiceHUDBand has transport controls: pause/resume (player.suspend/resume via known KokoroPlayerHandle interface), skip button (mode=briefing), speed slider (0.5–2x), queue cancel on barge-in; voiceLatencyMark fired for SC2 per-stage telemetry.
- BriefingScreen walks stored BriefingPayload sections via useReadAloudQueue — no LLM streaming (Pitfall 4 avoided).
- Human checkpoint: SC1/SC2/SC3/SC4/SC5 all pass by manual smoke test.
</success_criteria>

<output>
After completion, create `.planning/phases/16-streaming-cascade-barge-in-read-only/16-04b-SUMMARY.md`
</output>
