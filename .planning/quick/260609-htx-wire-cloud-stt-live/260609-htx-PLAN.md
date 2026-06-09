---
phase: quick-260609-htx
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/main/ipc/voice.ts
  - tests/unit/main/voice/cloud-stt-routing.spec.ts
autonomous: true
requirements:
  - D-13
  - D-15
must_haves:
  truths:
    - "When useCloud=true and shouldUseCloud returns true, cloudTranscribe is called and sttSidecar.transcribe is NOT called"
    - "When useCloud=false or shouldUseCloud returns false, sttSidecar.transcribe is called and cloudTranscribe is NOT called"
    - "When cloudTranscribe throws or returns { error }, the handler falls back to sttSidecar.transcribe and does NOT drop the turn"
    - "The TranscriptDelta pushed to renderer has the same shape (text, final) from both paths"
    - "sensitivity-flagged turns stay local regardless of useCloud setting (D-15 fail-safe enforced by shouldUseCloud)"
  artifacts:
    - path: "src/main/ipc/voice.ts"
      provides: "VOICE_FEED_AUDIO handler routing to cloud or local STT"
      contains: "shouldUseCloud"
    - path: "tests/unit/main/voice/cloud-stt-routing.spec.ts"
      provides: "Unit tests asserting routing logic: cloud path, local path, fallback"
      exports: []
  key_links:
    - from: "src/main/ipc/voice.ts VOICE_FEED_AUDIO"
      to: "src/main/voice/cloud-stt.ts shouldUseCloud + cloudTranscribe"
      via: "injected deps.cloudStt"
      pattern: "shouldUseCloud"
    - from: "src/main/ipc/voice.ts VOICE_FEED_AUDIO"
      to: "src/main/voice/stt/wav.ts writePcmToWav"
      via: "deps.writePcm (injected)"
      pattern: "writePcmToWav"
---

<objective>
Wire cloud STT (OpenAI whisper-1) into the live VOICE_FEED_AUDIO transcription path.

Purpose: The "Enable cloud audio processing" toggle currently has no effect — the VOICE_FEED_AUDIO handler unconditionally calls sttSidecar.transcribe(pcm). cloudTranscribe() and shouldUseCloud() from Phase-17 Plan-04 (src/main/voice/cloud-stt.ts) have zero call sites outside their own file and tests. This fix routes each turn through shouldUseCloud() first, then dispatches to either cloudTranscribe() or the local sidecar.

Output: Modified voice.ts handler with cloud routing + fallback, new spec file asserting all three branches.
</objective>

<execution_context>
@C:\Users\HomePC\.claude\get-shit-done\workflows\execute-plan.md
@C:\Users\HomePC\.claude\get-shit-done\templates\summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md

Key interfaces the executor needs:

From src/main/voice/cloud-stt.ts:
- cloudTranscribe(audioBuffer: Buffer, signal: AbortSignal): Promise<{ text: string } | { error: string }>
  - audioBuffer is a WAV/PCM Buffer (not raw Int16Array)
  - NEVER throws — returns { error } on failure
- shouldUseCloud(context: string, queue: PQueueLike, useCloudPref: boolean): Promise<boolean>
  - context: text context for the turn (pass '' when no prior transcript is available — the gate still works)
  - queue: PQueueLike stub or real p-queue instance
  - useCloudPref: boolean from getVoicePrefs(db).useCloud
  - D-15 invariant: returns false for sensitivity-flagged, low-confidence, or unconsented turns
- PQueueLike = { add: <T>(fn: () => Promise<T>) => Promise<T> }

From src/main/voice/stt/wav.ts:
- writePcmToWav(pcm: Int16Array, sampleRate: number, destPath: string): string
  - sampleRate: 16000 (matches sidecar usage in sidecar-manager.ts line 158)
- tempWavPath(): string

From src/main/voice/prefs.ts:
- getVoicePrefs(db: Db | null): VoicePrefsDto  — returns { useCloud: boolean, speed, voiceId }
  - db-null tolerant: returns VOICE_PREF_DEFAULTS (useCloud=false) when db is null

From src/shared/voice-types.ts:
- TranscriptDelta = { text: string; final: boolean; startMs?: number; endMs?: number }

From src/main/ipc/voice.ts (current handler at line 281-324):
- sttSidecar.transcribe(pcm: Int16Array): Promise<TranscriptDelta>
- deps.emitToRenderer?(channel, payload)
- CHANNELS.VOICE_TRANSCRIPT_DELTA / VOICE_STATE_CHANGED are the push channels

From src/main/lifecycle/scheduler.ts:
- SchedulerHandle = { queue: InstanceType<typeof PQueueImport> }
- registerScheduler is already called in src/main/index.ts (line 362) as `const scheduler = registerScheduler(logger)`

From src/main/index.ts (line 430-436):
- registerVoiceHandlers(ipcMain, { logger, dbHolder, sttSidecar, downloadController, emitToRenderer })
- scheduler IS available at the call site (line 362)

From tests/unit/main/voice/cloud-stt.spec.ts:
- Shows the PQueueLike stub pattern: { add: async (fn) => fn() }
- Shows how to vi.mock cloud-stt.ts functions for the routing spec
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Inject cloud-stt deps into VoiceHandlersDeps + wire VOICE_FEED_AUDIO routing</name>
  <files>src/main/ipc/voice.ts, src/main/index.ts</files>
  <behavior>
    - When shouldUseCloud returns true: cloudTranscribe is called; sttSidecar.transcribe is NOT called; result.text is wrapped into TranscriptDelta { text, final: true }
    - When shouldUseCloud returns false: sttSidecar.transcribe is called; cloudTranscribe is NOT called
    - When cloudTranscribe returns { error }: falls back to sttSidecar.transcribe; the turn is NOT dropped; a logger.warn is emitted
    - The TranscriptDelta pushed via VOICE_TRANSCRIPT_DELTA has the same shape in all three paths
    - getVoicePrefs(db).useCloud is read each turn (not cached) so toggle changes take effect immediately
    - fs.unlinkSync is called in a finally block to clean up the temp WAV when cloud path is used
    - The AbortController used to cancel in-flight cloud requests is the existing per-session controller from sessionAbortControllers if present, otherwise a new AbortController per turn
  </behavior>
  <action>
    In src/main/ipc/voice.ts, add three optional fields to VoiceHandlersDeps (after the existing voiceSessionManager field):
      cloudStt?: { shouldUseCloud: typeof import('../voice/cloud-stt').shouldUseCloud; cloudTranscribe: typeof import('../voice/cloud-stt').cloudTranscribe };
      writePcm?: { writePcmToWav: typeof import('../voice/stt/wav').writePcmToWav; tempWavPath: typeof import('../voice/stt/wav').tempWavPath };
      llmQueue?: import('../voice/cloud-stt').PQueueLike;

    Add real defaults at the top of registerVoiceHandlers(), immediately after destructuring deps:
      const cloudStt = deps.cloudStt ?? await import('../voice/cloud-stt');
      const wavUtils = deps.writePcm ?? await import('../voice/stt/wav');
      const llmQueue = deps.llmQueue ?? { add: async (fn) => fn() };

    In the VOICE_FEED_AUDIO handler body, after the pcm reconstruction block and before the sidecar.transcribe call (around line 302-307), insert the cloud routing block:
      1. Read useCloudPref: const prefs = getVoicePrefs(deps.dbHolder.db); const useCloud = prefs.useCloud;
      2. Evaluate gate: const useCloudPath = await cloudStt.shouldUseCloud('', llmQueue, useCloud);
      3. If useCloudPath is true:
         a. const wavPath = wavUtils.tempWavPath();
         b. try { wavUtils.writePcmToWav(pcm, 16000, wavPath); } ... (wrap in try/finally for cleanup)
         c. const abortCtrl = new AbortController();
         d. const cloudResult = await cloudStt.cloudTranscribe(fs.readFileSync(wavPath), abortCtrl.signal);
         e. finally { try { fs.unlinkSync(wavPath); } catch { /* ignore */ } }
         f. If 'error' in cloudResult: logger.warn({ scope: 'voice.feedAudio', err: cloudResult.error }, 'cloudTranscribe failed, falling back to local sidecar'); fall through to local sidecar call below.
         g. If 'text' in cloudResult: set delta = { text: cloudResult.text, final: true }; skip the sidecar.transcribe call; continue to push delta.
      4. If useCloudPath is false (or cloud fell back): delta = await sttSidecar.transcribe(pcm); (unchanged)
      5. The push block (emitToRenderer VOICE_TRANSCRIPT_DELTA + idle state) is unchanged and runs for both paths.

    Add fs import at top of voice.ts: import * as fs from 'node:fs';

    In src/main/index.ts, pass scheduler.queue as llmQueue when calling registerVoiceHandlers (per D-13/D-15 — classify needs a real queue in production):
      registerVoiceHandlers(ipcMain, {
        logger,
        dbHolder,
        sttSidecar,
        downloadController,
        emitToRenderer: (channel, payload) => voiceEmitter?.(channel, payload),
        llmQueue: scheduler.queue,
      });

    Do NOT change VOICE_HANDLER_CHANNELS array. Do NOT add new ipcMain.handle() calls. Do NOT change the error catch block. The existing return { ok: true, delta } path must remain the same. Keep typecheck flat at 84 baseline — the three injected dep types are all optional (no new required fields).
  </action>
  <verify>
    <automated>cd C:/Users/HomePC/Documents/GitHub/Aria && npx tsc --noEmit 2>&1 | tail -5</automated>
  </verify>
  <done>TypeScript reports 0 new errors (baseline remains 84). voice.ts compiles. index.ts passes llmQueue to registerVoiceHandlers.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Unit tests — three routing branches (cloud, local, fallback)</name>
  <files>tests/unit/main/voice/cloud-stt-routing.spec.ts</files>
  <behavior>
    - Test A (cloud path): shouldUseCloud returns true → cloudTranscribe called with WAV buffer; sttSidecar.transcribe NOT called; VOICE_TRANSCRIPT_DELTA emitted with { text: 'cloud result', final: true }
    - Test B (local path): shouldUseCloud returns false → sttSidecar.transcribe called; cloudTranscribe NOT called; VOICE_TRANSCRIPT_DELTA emitted with sidecar delta
    - Test C (fallback path): shouldUseCloud returns true but cloudTranscribe returns { error } → sttSidecar.transcribe called as fallback; turn NOT dropped; VOICE_TRANSCRIPT_DELTA emitted with sidecar delta
  </behavior>
  <action>
    Create tests/unit/main/voice/cloud-stt-routing.spec.ts.

    Mock strategy (mirrors cloud-stt.spec.ts patterns):
      - vi.mock('../../../../src/main/voice/cloud-stt') — mock shouldUseCloud and cloudTranscribe independently per test
      - vi.mock('../../../../src/main/voice/stt/wav') — mock writePcmToWav (no-op) and tempWavPath (returns '/tmp/aria-voice-test.wav')
      - vi.mock('node:fs') — mock readFileSync (return Buffer.from([])) and unlinkSync (no-op)
      - vi.mock('../../../../src/main/voice/prefs') — mock getVoicePrefs to return { useCloud: true, speed: 1.0, voiceId: '' }

    Build a minimal registerVoiceHandlers test harness using the injected dep fields (cloudStt, writePcm, llmQueue):
      - Build mockSttSidecar = { transcribe: vi.fn().mockResolvedValue({ text: 'local result', final: true }) }
      - Build mockCloudStt = { shouldUseCloud: vi.fn(), cloudTranscribe: vi.fn() }
      - Build mockWavUtils = { writePcmToWav: vi.fn().mockReturnValue('/tmp/test.wav'), tempWavPath: vi.fn().mockReturnValue('/tmp/test.wav') }
      - Build mockQueue: PQueueLike = { add: async (fn) => fn() }
      - Call registerVoiceHandlers with injected deps; capture the VOICE_FEED_AUDIO handler by intercepting ipcMain.handle

    For each test: call the captured handler with a fake PCM ArrayBuffer payload; assert mockCloudStt calls + mockSttSidecar.transcribe calls + emitToRenderer call sequence.

    Test A: mockCloudStt.shouldUseCloud resolves true; mockCloudStt.cloudTranscribe resolves { text: 'cloud result' }. Assert cloudTranscribe called once; sttSidecar.transcribe not called; emitToRenderer received ('aria:voice:transcript-delta', { text: 'cloud result', final: true }).

    Test B: mockCloudStt.shouldUseCloud resolves false. Assert sttSidecar.transcribe called once; cloudTranscribe not called; emitToRenderer received ('aria:voice:transcript-delta', { text: 'local result', final: true }).

    Test C: mockCloudStt.shouldUseCloud resolves true; mockCloudStt.cloudTranscribe resolves { error: 'API down' }. Assert sttSidecar.transcribe called once (fallback); emitToRenderer received transcript delta from sidecar (not the error string).

    Run file individually (parallel-projects race workaround). Keep test file under tests/unit/main/voice/ to match the vitest main project include glob.
  </action>
  <verify>
    <automated>cd C:/Users/HomePC/Documents/GitHub/Aria && npx vitest run tests/unit/main/voice/cloud-stt-routing.spec.ts --no-file-parallelism 2>&1 | tail -20</automated>
  </verify>
  <done>All 3 tests pass (cloud path, local path, fallback). 0 test failures. Typecheck still at 84 baseline.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| PCM → cloud API | Raw audio bytes leave the local machine when cloud path is taken |
| shouldUseCloud gate | Sensitivity classifier guards the boundary — must not be bypassable |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-htx-01 | Information Disclosure | VOICE_FEED_AUDIO cloud path | mitigate | shouldUseCloud() is the sole gate — called as-is, never re-implemented; sensitivity-flagged or low-confidence turns are forced local (D-15) |
| T-htx-02 | Denial of Service | cloudTranscribe failure | mitigate | cloudTranscribe never throws (returns { error }); handler falls back to local sidecar — turn is never dropped |
| T-htx-03 | Information Disclosure | temp WAV file on disk | mitigate | fs.unlinkSync in finally block; file lives in os.tmpdir() only (T-15-04 pattern) |
</threat_model>

<verification>
After both tasks:
  1. npx tsc --noEmit reports 0 new errors (84 baseline unchanged)
  2. npx vitest run tests/unit/main/voice/cloud-stt-routing.spec.ts --no-file-parallelism — 3/3 pass
  3. npx vitest run tests/unit/main/voice/cloud-stt.spec.ts --no-file-parallelism — still 9/9 pass (no regression)
  4. grep -n "shouldUseCloud" src/main/ipc/voice.ts shows at least one call site
  5. grep -n "cloudTranscribe" src/main/ipc/voice.ts shows at least one call site
</verification>

<success_criteria>
- shouldUseCloud() is called in the VOICE_FEED_AUDIO handler before every transcription turn
- When cloud path is taken: cloudTranscribe receives a WAV Buffer; delta = { text, final: true } is pushed
- When cloud path errors: sttSidecar.transcribe is the fallback; turn is not dropped
- D-15 fail-safe is intact: sensitivity-flagged or low-confidence turns route to sidecar regardless of the useCloud toggle
- Typecheck baseline unchanged at 84
- 3 new unit tests green (cloud / local / fallback branches)
- Existing cloud-stt.spec.ts (9 tests) still green
</success_criteria>

<output>
After completion, create .planning/quick/260609-htx-wire-cloud-stt-live/260609-htx-01-SUMMARY.md
</output>
