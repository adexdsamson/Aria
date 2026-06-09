---
phase: 260609-khr
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/main/voice/cloud-stt.ts
  - src/main/ipc/voice.ts
  - tests/unit/main/voice/cloud-stt.spec.ts
autonomous: true
requirements: []

must_haves:
  truths:
    - "cloudTranscribe resolves the stored OpenAI key from safeStorage before calling whisper-1"
    - "cloudTranscribe returns { error: 'no OpenAI frontier key configured' } when key is null — never throws"
    - "cloudTranscribe accepts an injectable key-getter as a 3rd optional param so unit tests bypass Electron safeStorage"
    - "VOICE_FEED_AUDIO logs route:cloud|local at info level immediately after useCloudPath is computed"
    - "VOICE_FEED_AUDIO logs a warn with err when cloudTranscribe returns { error } before the local fallback"
    - "All existing cloud-stt.spec.ts and cloud-stt-routing.spec.ts tests stay green"
  artifacts:
    - path: "src/main/voice/cloud-stt.ts"
      provides: "cloudTranscribe with injectable key getter + safeStorage key resolution"
    - path: "src/main/ipc/voice.ts"
      provides: "route log line + cloud-error warn before fallback"
    - path: "tests/unit/main/voice/cloud-stt.spec.ts"
      provides: "updated cloudTranscribe tests exercising injectable getter"
  key_links:
    - from: "src/main/voice/cloud-stt.ts"
      to: "src/main/secrets/safeStorage.ts"
      via: "getFrontierKey({ provider: 'openai' }) — default key getter"
      pattern: "getFrontierKey.*openai"
    - from: "src/main/voice/cloud-stt.ts"
      to: "@ai-sdk/openai createOpenAI"
      via: "createOpenAI({ apiKey: key }) replacing bare openai provider"
      pattern: "createOpenAI"
    - from: "src/main/ipc/voice.ts"
      to: "logger"
      via: "logger.info({ route }, 'voice.stt route') + logger.warn on cloud error"
      pattern: "voice.stt route"
---

<objective>
Fix cloudTranscribe to authenticate with the stored OpenAI frontier key rather than the bare
`openai` provider which reads the unset OPENAI_API_KEY env var. Add route observability to
VOICE_FEED_AUDIO so it is visible in logs whether each audio turn goes cloud or local.

Purpose: Cloud STT (whisper-1) has been silently 401-ing and falling back to the slow local
sidecar on every turn since Phase 17. The key is present in safeStorage; the call site just
needs to fetch it the same way providers.ts:117/133 does.

Output: cloud-stt.ts with injectable safeStorage key resolution; voice.ts with two new log
lines; updated unit tests.
</objective>

<execution_context>
@/home/HomePC/.claude/get-shit-done/workflows/execute-plan.md
@/home/HomePC/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@C:\Users\HomePC\Documents\GitHub\Aria\.planning\PROJECT.md
@C:\Users\HomePC\Documents\GitHub\Aria\.planning\ROADMAP.md

<!-- Key interfaces extracted for the executor — no codebase exploration needed. -->
<interfaces>
From src/main/secrets/safeStorage.ts:
  export async function getFrontierKey(opts: { provider: ProviderId }): Promise<string | null>
  // ProviderId = 'anthropic' | 'openai' | 'google'  (from src/shared/ipc-contract)
  // Returns null when no key stored; throws SafeStorageUnavailableError on decrypt failure.

From src/main/llm/providers.ts (canonical key-resolution pattern):
  import { createOpenAI } from '@ai-sdk/openai';
  import { getFrontierKey } from '../secrets/safeStorage';
  // Usage: const key = await getFrontierKey({ provider: 'openai' });
  //        const client = createOpenAI({ apiKey: key });
  //        const model = client.transcription('whisper-1');

Current cloud-stt.ts cloudTranscribe (the broken version):
  import { experimental_transcribe as transcribe } from 'ai';
  import { openai } from '@ai-sdk/openai';
  // Uses: openai.transcription('whisper-1') — reads process.env.OPENAI_API_KEY → 401

Current voice.ts VOICE_FEED_AUDIO routing block (lines 356-390):
  const useCloudPath = prefs.useCloud === true && cloudSttResolved != null && wavUtilsResolved != null;
  // ...cloud branch at line 363 calls cloudSttResolved.cloudTranscribe(audioBuffer, abortCtrl.signal)
  // ...cloud-error fallback warn already at line 382-385
  // logger is in scope throughout the handler (deps.logger)
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Fix cloudTranscribe key resolution + add injectable getter</name>
  <files>
    src/main/voice/cloud-stt.ts,
    tests/unit/main/voice/cloud-stt.spec.ts
  </files>
  <behavior>
    - cloudTranscribe(buf, signal) with no 3rd arg resolves key via getFrontierKey({ provider: 'openai' })
    - cloudTranscribe(buf, signal, () => Promise.resolve(null)) returns { error: 'no OpenAI frontier key configured' } without calling transcribe
    - cloudTranscribe(buf, signal, () => Promise.resolve('sk-test')) calls createOpenAI({ apiKey: 'sk-test' }), calls .transcription('whisper-1'), returns { text: 'hello' } on mock success
    - cloudTranscribe never throws — any exception from transcribe returns { error: message }
    - Existing shouldUseCloud tests are unaffected
  </behavior>
  <action>
    In src/main/voice/cloud-stt.ts:

    Replace the bare `openai` import (`import { openai } from '@ai-sdk/openai'`) with
    `import { createOpenAI } from '@ai-sdk/openai'`. Add an import for getFrontierKey:
    `import { getFrontierKey } from '../secrets/safeStorage'`.

    Change the cloudTranscribe signature to add an optional third parameter:
    `getKey: () => Promise<string | null> = () => getFrontierKey({ provider: 'openai' })`.

    Inside cloudTranscribe, before the try block, resolve the key:
    `const key = await getKey();`
    If key is falsy, `return { error: 'no OpenAI frontier key configured' }` immediately.

    Inside the try block, replace `openai.transcription('whisper-1')` with:
    `const client = createOpenAI({ apiKey: key }); client.transcription('whisper-1')` as the
    model argument passed to transcribe(). The call to `transcribe({ model, audio, abortSignal })`
    otherwise stays identical.

    The `key` variable resolved before the try block is available inside the try block as a
    non-null string (the null branch returned early above).

    In tests/unit/main/voice/cloud-stt.spec.ts:

    The existing `vi.mock('@ai-sdk/openai', ...)` mock stubs `openai.transcription` — update it
    to also export `createOpenAI` as a vi.fn() that returns an object with a `transcription` method
    (same shape). Add a `mockCreateOpenAI` capture so tests can assert on it if needed.

    Update the `cloudTranscribe` describe block:
    - Add a test: "returns { error: 'no OpenAI frontier key configured' } when key getter resolves null" —
      call cloudTranscribe(buf, signal, () => Promise.resolve(null)); expect { error: 'no OpenAI frontier key configured' };
      expect mockTranscribe not.toHaveBeenCalled().
    - Update the existing "returns { text }" test to inject a getter: cloudTranscribe(buf, signal, () => Promise.resolve('sk-test')).
    - Update the existing "returns { error } when transcribe throws" test similarly — inject getter returning 'sk-test'.
    - Update the existing "never throws even when transcribe rejects with non-Error" test similarly.

    The two-arg call sites in cloud-stt-routing.spec.ts (which inject cloudTranscribe as a mock via
    the `cloudStt` dep object) do not call the real cloudTranscribe — they are unaffected.
    Verify cloud-stt-routing.spec.ts still passes without modification.
  </action>
  <verify>
    <automated>npx vitest run tests/unit/main/voice/cloud-stt.spec.ts tests/unit/main/voice/cloud-stt-routing.spec.ts --no-file-parallelism 2>&1 | tail -20</automated>
  </verify>
  <done>
    All cloud-stt.spec.ts tests pass (including the new "no key configured" case).
    cloud-stt-routing.spec.ts stays green.
    cloud-stt.ts has no bare `openai` import remaining (grep -c "^import.*{ openai }" src/main/voice/cloud-stt.ts returns 0).
  </done>
</task>

<task type="auto">
  <name>Task 2: Add route log lines to VOICE_FEED_AUDIO</name>
  <files>
    src/main/ipc/voice.ts
  </files>
  <action>
    In src/main/ipc/voice.ts, inside the VOICE_FEED_AUDIO handler, locate the line that computes
    `useCloudPath` (currently around line 356-359). Immediately after that assignment, add:
    `logger.info({ route: useCloudPath ? 'cloud' : 'local' }, 'voice.stt route');`
    using the in-scope `logger` (same identifier used by the existing logger.warn calls in
    the handler — deps.logger is aliased as `logger` in the handler closure).

    Locate the existing cloud-error fallback block (around lines 380-386) where cloudResult
    contains { error }. The block already has a logger.warn call. Replace the existing warn
    with a single call that includes both the scope field and the err field:
    `logger.warn({ scope: 'voice.feedAudio', err: cloudResult.error }, 'voice.stt cloud failed — falling back to local');`
    (This is a no-op restructure if the warn already has this shape — verify first; only change if
    the err field is currently stored in a separate variable before being logged.)

    Do not touch any other part of the handler.
  </action>
  <verify>
    <automated>npx vitest run tests/unit/main/voice/cloud-stt-routing.spec.ts --no-file-parallelism 2>&1 | tail -15</automated>
  </verify>
  <done>
    grep -n "voice.stt route" src/main/ipc/voice.ts returns exactly one match.
    cloud-stt-routing.spec.ts still passes (mockLogger.info/warn assertions in the routing
    tests are permissive mocks — the new log lines do not break the test).
    npm run typecheck exits 0 with no increase from the 84-error baseline.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| safeStorage → cloudTranscribe | Decrypted key passed through in-process memory only; never logged, never serialised |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-khr-01 | Information Disclosure | cloudTranscribe key param | accept | Key flows in-process only; injectable getter is used in tests with a dummy string, not a real key |
| T-khr-02 | Denial of Service | getFrontierKey null path | mitigate | Return { error } immediately — no network call made, no hang |
</threat_model>

<verification>
Run both spec files together:
  npx vitest run tests/unit/main/voice/cloud-stt.spec.ts tests/unit/main/voice/cloud-stt-routing.spec.ts --no-file-parallelism

Confirm zero bare `openai` provider import remains in cloud-stt.ts:
  grep -c "from '@ai-sdk/openai'" src/main/voice/cloud-stt.ts → still 1 (createOpenAI import)
  grep -c "{ openai }" src/main/voice/cloud-stt.ts → 0

Confirm route log line present:
  grep -c "voice.stt route" src/main/ipc/voice.ts → 1

Typecheck:
  npm run typecheck 2>&1 | tail -5  (must stay at 84 errors, 0 new)
</verification>

<success_criteria>
- cloudTranscribe calls getFrontierKey({ provider: 'openai' }) by default to obtain the stored key
- cloudTranscribe returns { error: 'no OpenAI frontier key configured' } (not throw) when key is absent
- cloudTranscribe 3rd-param injection keeps unit tests free of Electron safeStorage
- VOICE_FEED_AUDIO emits a logger.info route:cloud|local line after useCloudPath is resolved
- VOICE_FEED_AUDIO emits a logger.warn with err before the local fallback on cloud error
- cloud-stt.spec.ts and cloud-stt-routing.spec.ts both pass
- typecheck baseline unchanged (84 errors, 0 new)
</success_criteria>

<output>
After completion, create .planning/quick/260609-khr-cloud-stt-key-fix/260609-khr-SUMMARY.md
</output>
