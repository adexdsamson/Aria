---
phase: quick-260709-rcd
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/main/services/ResearchService.ts
  - src/main/ipc/transcripts.ts
  - tests/unit/main/research-service.spec.ts
autonomous: true
requirements: [RES-04]
must_haves:
  truths:
    - "detectResearchTopics attempts generation on the LOCAL Ollama model before any frontier call"
    - "Raw meeting transcript text is only sent to a frontier provider when the local model is unavailable AND a frontier provider+key is configured"
    - "When local is unavailable and no frontier is configured, the function returns silently with no research_job drafts and no notification"
    - "A warn log is emitted before any frontier fallback, disclosing that the transcript leaves the device"
    - "runResearchJob (Path 1) remains frontier-only and untouched"
  artifacts:
    - path: "src/main/services/ResearchService.ts"
      provides: "Local-first detectResearchTopics with frontier fallback + logger param"
      contains: "getLocalModel"
    - path: "src/main/ipc/transcripts.ts"
      provides: "Fire-and-forget call passing logger as 5th arg"
      contains: "detectResearchTopics(db, result.noteId"
  key_links:
    - from: "src/main/ipc/transcripts.ts"
      to: "detectResearchTopics"
      via: "fire-and-forget call with logger 5th arg"
      pattern: "detectResearchTopics\\(db, result\\.noteId.*logger"
    - from: "src/main/services/ResearchService.ts"
      to: "getLocalModel"
      via: "local-first generateObject attempt"
      pattern: "getLocalModel\\(\\)"
---

<objective>
Fix the Path-2 research privacy leak in `detectResearchTopics`. Today, the auto-detect
hook (RES-04: detect research topics from meeting transcripts) reads raw transcript text
and sends it straight to the frontier provider whenever a frontier key exists — violating
Aria's local-first privacy promise. This plan restructures the function to attempt the
LOCAL Ollama model FIRST, falling back to the frontier only when local is unavailable, and
only after emitting a disclosure warn log.

Purpose: Keep raw meeting transcripts on-device by default; frontier is the explicit,
logged fallback — matching the established generateObject-on-local pattern in
`sensitivityClassifier.ts` and `whatsapp/digest-cron.ts`.

Output: Local-first `detectResearchTopics`, an updated fire-and-forget call site, and a
spec updated to keep the local-first behavior honest.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md

<interfaces>
<!-- Contracts the executor needs — extracted from the codebase. Use directly. -->

From src/main/llm/providers.ts:
```typescript
// Sync factory. Throws OllamaUnavailableError if the client cannot be built.
// Returns ModelLike (= unknown) — cast at the generateObject call site.
export function getLocalModel(opts?: LocalModelOptions): ModelLike;

// Async. Throws FrontierUnavailableError('auth') if no key for provider.
export async function getFrontierModel(provider: ProviderId, opts?: FrontierModelOptions): Promise<ModelLike>;
```

From src/main/secrets/safeStorage.ts (already imported in ResearchService.ts):
```typescript
getActiveProvider(): Promise<string | null>;
hasFrontierKey(args: { provider: ProviderId }): Promise<boolean>;
```

Current detectResearchTopics signature (src/main/services/ResearchService.ts ~line 349):
```typescript
export async function detectResearchTopics(
  db: Db,
  noteId: string,
  noteTitle: string,
  emitToRenderer?: (channel: string, payload?: unknown) => void,
): Promise<void>
```

`Logger` is already imported at top of ResearchService.ts: `import type { Logger } from 'pino';`
`getLocalModel` is NOT yet imported — the current import is `import { getFrontierModel } from '../llm/providers';`

Established local-first generateObject cast pattern (already used in this file, runResearchJob line 273):
`model: model as Parameters<typeof generateObject>[0]['model']`
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Route detectResearchTopics local-first with logged frontier fallback</name>
  <files>src/main/services/ResearchService.ts, src/main/ipc/transcripts.ts</files>
  <action>
Implements RES-04 privacy fix. Two edits, no behavior change to `runResearchJob` (Path 1 stays frontier-only — do NOT touch it).

In `src/main/services/ResearchService.ts`:
1. Add `getLocalModel` to the existing named import from `'../llm/providers'` so the line imports both `getFrontierModel` and `getLocalModel`.
2. Change the `detectResearchTopics` signature to add an optional trailing param `logger?: Pick<Logger, 'warn'>` after `emitToRenderer`. (`Logger` is already imported from `'pino'`.)
3. Inside the existing OUTER `try` (which must keep its current silent-return `catch` behavior — leave the outer catch as-is), restructure the generation so the transcript prompt is built ONCE and generation is attempted LOCAL-FIRST:
   - Keep the note load and the empty-note guard (`if (!note) return;`) exactly as they are.
   - Build the `prompt` string ONCE (the existing meeting-transcript prompt), BEFORE any provider resolution. Note: remove the current early `getActiveProvider()`/`hasFrontierKey()` gate that sits before the prompt — provider resolution now happens only in the fallback path.
   - Declare a result holder for the extracted topics accessible after the inner try/catch (e.g. `let topics: z.infer<typeof TopicsSchema> | undefined;`).
   - Inner `try` (local-first, keeps transcript on-device): `const localModel = getLocalModel();` then `const { object } = await generateObject({ model: localModel as Parameters<typeof generateObject>[0]['model'], schema: TopicsSchema, prompt });` and assign `topics = object;`.
   - Inner `catch` (local failed — Ollama not running / model missing / network): resolve `const activeProvider = await getActiveProvider();` and check `hasFrontierKey({ provider: activeProvider as ... ProviderId })`. If NO active provider OR no frontier key, `return;` (silent — no suggestions, no notification). If a frontier provider+key IS configured: call `logger?.warn({ scope: 'research', noteId }, 'topic-detect: local model unavailable — falling back to frontier (transcript leaves device)');` THEN `const frontierModel = await getFrontierModel(activeProvider as ... ProviderId);` and `const { object } = await generateObject({ model: frontierModel as Parameters<typeof generateObject>[0]['model'], schema: TopicsSchema, prompt });` and assign `topics = object;`.
   - After the inner try/catch, keep the existing downstream UNCHANGED but read from the holder: `if (!topics || topics.length === 0) return;` then the existing draft-row insert loop and the `emitToRenderer(BRIEFING_TODAY, ...)` call.
   - Reuse the same `activeProvider as import('../../shared/ipc-contract').ProviderId` inline cast style already used elsewhere in this file for the `ProviderId` cast.
   - NO fenced code inside runtime files beyond normal TS; do not add new imports beyond `getLocalModel`.

In `src/main/ipc/transcripts.ts` (~line 35): update the fire-and-forget call to pass the logger as the 5th argument: `detectResearchTopics(db, result.noteId, result.title ?? '', deps.emitToRenderer, logger)`. `logger` is already destructured from `deps` at the top of `registerTranscriptHandlers`. Leave the `.catch(...)` handler intact.
  </action>
  <verify>
    <automated>npx tsc --noEmit 2>&1 | grep -E "ResearchService\.ts|ipc/transcripts\.ts" | grep -v "^#" | wc -l</automated>
  </verify>
  <done>
`getLocalModel` is imported and called before any frontier call in `detectResearchTopics`; the frontier branch is guarded by `getActiveProvider()`+`hasFrontierKey()` and preceded by a `logger?.warn` disclosure; the outer try/catch still returns silently; the transcripts.ts call passes `logger` as the 5th arg. The verify command reports **0** typecheck errors attributable to `ResearchService.ts` or `ipc/transcripts.ts` (the repo's ~84 pre-existing errors live in other files; this diff adds none to these two).
  </done>
</task>

<task type="auto">
  <name>Task 2: Keep the research-service spec honest under local-first</name>
  <files>tests/unit/main/research-service.spec.ts</files>
  <action>
The providers mock (`vi.mock('../../../src/main/llm/providers', ...)` ~line 40) currently only stubs `getFrontierModel`. Now that `detectResearchTopics` imports and calls `getLocalModel` first, the mock and two detectResearchTopics tests must be updated so behavior is asserted, not accidental.

1. In the providers `vi.mock` factory, add `getLocalModel: vi.fn(),` alongside `getFrontierModel: vi.fn()`.
2. Add `getLocalModel` to the post-mock import line that currently imports `getFrontierModel` from `'../../../src/main/llm/providers'`.
3. In the top-level `beforeEach`, add a default: `vi.mocked(getLocalModel).mockReturnValue({} as ReturnType<typeof getLocalModel>);` (local succeeds by default so happy-path tests exercise the local branch).
4. Update the existing test `'inserts draft research_job rows when LLM extracts topics'`: it already mocks `generateObject` to resolve the topics array once — with local succeeding, that single resolved value is now consumed by the LOCAL generateObject call. No change needed to the assertion, but add an assertion that the local path was used and frontier was NOT: `expect(getLocalModel).toHaveBeenCalled();` and `expect(getFrontierModel).not.toHaveBeenCalled();`.
5. Update the existing test `'returns silently when LLM throws'`: it currently does one `mockRejectedValueOnce`. Under local-first-with-fallback a single rejection would fall through to frontier. To assert true silent failure, make BOTH attempts fail: set `vi.mocked(getLocalModel).mockImplementationOnce(() => { throw new Error('ollama down'); });` (local unavailable) AND `vi.mocked(generateObject).mockRejectedValueOnce(new Error('Model overloaded'));` (frontier attempt fails). Keep `getActiveProvider`/`hasFrontierKey` at their beforeEach truthy defaults so the fallback path is entered and then fails. Assertions stay: resolves undefined, 0 draft rows.
6. Add ONE new regression test `'falls back to frontier only when local is unavailable and frontier is configured'`: insert a meeting_note; `vi.mocked(getLocalModel).mockImplementationOnce(() => { throw new Error('ollama down'); });`; leave frontier configured (beforeEach defaults) and `generateObject` resolving a topics array (use `mockResolvedValueOnce` with a one-topic array); call `detectResearchTopics(db, noteId, title, emitToRenderer, { warn: vi.fn() } as unknown as Pick<Logger, 'warn'>)`; assert `getFrontierModel` was called and a draft row was inserted. Import `Logger` type via `import type { Logger } from 'pino';` if not already imported.
  </action>
  <verify>
    <automated>npx vitest run tests/unit/main/research-service.spec.ts 2>&1 | grep -E "Test Files|Tests " </automated>
  </verify>
  <done>
The providers mock exports `getLocalModel`; the happy-path test asserts local-was-used / frontier-not-called; the silent-failure test fails BOTH local and frontier; a new test proves frontier is only reached when local is unavailable. `vitest run` on this spec reports all tests passing. (If the desktop app is running, close it first — better-sqlite3 ABI lock per project memory.)
  </done>
</task>

</tasks>

<verification>
- `npx tsc --noEmit` introduces zero NEW errors in `src/main/services/ResearchService.ts` and `src/main/ipc/transcripts.ts` (pre-existing repo errors in other files are unaffected).
- `getLocalModel()` is invoked before any `getFrontierModel()` in `detectResearchTopics` (grep: `getLocalModel` appears above the fallback branch).
- `runResearchJob` diff is empty — Path 1 stays frontier-only.
- `research-service.spec.ts` passes with the updated local-first assertions.
</verification>

<success_criteria>
- Meeting transcripts are processed on the local Ollama model first; frontier is reached only when local throws AND a frontier provider+key exist, and only after a disclosure `logger.warn`.
- No frontier configured + local unavailable → silent no-op (no drafts, no BRIEFING_TODAY notification).
- transcripts.ts passes `logger` as the 5th arg so the fallback disclosure is actually recorded.
- No new typecheck errors in the two touched source files; the research-service spec is green.
</success_criteria>

<output>
After completion, create `.planning/quick/260709-rcd-research-topic-detect-local-first/260709-rcd-SUMMARY.md`
</output>
