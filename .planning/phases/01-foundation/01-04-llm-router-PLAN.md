---
phase: 01-foundation
plan: 04
type: execute
wave: 5
depends_on: ["01-foundation/01a", "01-foundation/01b", "01-foundation/02", "01-foundation/03"]
files_modified:
  - src/main/llm/router.ts
  - src/main/llm/classifier.ts
  - src/main/llm/providers.ts
  - src/main/llm/routingLog.ts
  - src/main/ipc/ask.ts
  - src/main/ipc/diagnostics.ts
  - src/main/ipc/index.ts
  - src/renderer/features/settings/DiagnosticsSection.tsx
  - src/renderer/features/settings/AskAriaBox.tsx
  - src/renderer/features/settings/RoutingLogPanel.tsx
  - src/renderer/features/settings/SettingsScreen.tsx
  - tests/unit/main/llm/classifier.spec.ts
  - tests/unit/main/llm/router.spec.ts
  - tests/unit/main/llm/routingLog.spec.ts
  - tests/unit/main/ipc/ask.spec.ts
  - tests/unit/main/ipc/ask-local-handler.spec.ts
  - tests/e2e/hello-aria.spec.ts
autonomous: true
requirements: [LLM-01, LLM-03, LLM-04, LLM-05]
tags: [llm, ai-sdk, routing, classifier, ollama, anthropic, openai, google]

must_haves:
  truths:
    - "Every LLM call passes through router.classify({ prompt, source }) which returns { route, reason }"
    - "Hard-rules classifier (regex over emails, phones, $$, SSN) forces LOCAL when matched; fail-closed: source unset OR classifier uncertain → LOCAL (LLM-04)"
    - "Each call writes one row to routing_log: timestamp, route, reason, source, prompt_hash, model, latency_ms, ok"
    - "User asks a question in Settings → Diagnostics → 'Ask Aria'; UI shows the answer AND the route (LOCAL/FRONTIER) + reason"
    - "Frontier unreachable / rate-limited / missing key → router falls back to LOCAL transparently; routing_log records reason='frontier-unavailable' (LLM-05)"
    - "Routing-log panel shows the last 100 entries, newest first, read-only (D-07)"
    - "Hello-Aria loop works LOCAL-only with Ollama running and NO frontier key configured (D-10)"
    - "Full ASK_ARIA handler integration test exercises real classifier + real router + real routingLog + temp SQLCipher DB + mocked generateText (closes Warning D from checker iteration 1)"
  artifacts:
    - path: "src/main/llm/classifier.ts"
      provides: "Hard-rules regex classifier"
      exports: ["classifySensitivity", "DEFAULT_PII_PATTERNS"]
    - path: "src/main/llm/router.ts"
      provides: "classify({prompt, source}) → {route, reason, model}; chooseProvider() helper"
      exports: ["LLMRouter", "RoutingDecision"]
    - path: "src/main/llm/providers.ts"
      provides: "Lazy-construct AI SDK 6 provider clients: anthropic, openai, google, ollama via ollama-ai-provider-v2"
      exports: ["getFrontierModel", "getLocalModel"]
    - path: "src/main/llm/routingLog.ts"
      provides: "Insert + read-last-N rows from routing_log table"
      exports: ["writeRoutingLog", "readRecentRoutingLog", "hashPrompt"]
    - path: "src/main/ipc/ask.ts"
      provides: "ASK_ARIA handler — router.classify → generateText → routingLog.insert → return"
    - path: "src/main/ipc/diagnostics.ts"
      provides: "DIAGNOSTICS_ROUTING_LOG handler"
  key_links:
    - from: "src/main/ipc/ask.ts"
      to: "src/main/llm/router.ts → src/main/llm/providers.ts → ai@^6 generateText"
      via: "router decides LOCAL/FRONTIER → providers returns model object → generateText({ model, prompt })"
      pattern: "generateText\\("
    - from: "src/main/ipc/ask.ts"
      to: "src/main/llm/routingLog.ts → SQLCipher routing_log table"
      via: "writeRoutingLog(db, decision, latency, ok) called after every call"
      pattern: "writeRoutingLog\\("
    - from: "src/renderer/features/settings/AskAriaBox.tsx"
      to: "window.aria.askAria + window.aria.diagnosticsRoutingLog"
      via: "preload IPC bridge; renders { answer, route, reason }"
      pattern: "window\\.aria\\.askAria"
---

<objective>
Phase Goal

**As a** solo developer dogfooding Aria on Windows 11, **I want to** type a question into Settings → Diagnostics → "Ask Aria" and see (a) the model's answer and (b) the routing decision with reason, with the decision row persisted to the encrypted routing_log, **so that** the LLM-router contract every later phase plugs into is proven end-to-end.

Purpose: Implements LLM-01 (PII → LOCAL), LLM-03 (every decision logged), LLM-04 (fail closed → LOCAL), LLM-05 (graceful frontier degradation). Closes the Walking Skeleton: renderer → IPC → router → Ollama or Anthropic/OpenAI/Google → SQLCipher routing_log → renderer display.

Output: Hard-rules classifier, LLM router over AI SDK 6, Diagnostics surface with "Ask Aria" + "last 100 routing decisions" panel, full hello-Aria e2e test plus a NEW unit test that exercises the FULL ASK_ARIA handler path with a real DB + real router + real routingLog (Warning D fix).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@CLAUDE.md
@.planning/phases/01-foundation/01-CONTEXT.md
@.planning/phases/01-foundation/01-RESEARCH.md
@.planning/phases/01-foundation/SKELETON.md
@.planning/phases/01-foundation/01-01a-SUMMARY.md
@.planning/phases/01-foundation/01-01b-SUMMARY.md
@.planning/phases/01-foundation/01-02-SUMMARY.md
@.planning/phases/01-foundation/01-03-SUMMARY.md
@src/shared/ipc-contract.ts
@src/main/db/connect.ts
@src/main/secrets/safeStorage.ts
@src/main/llm/ollamaProbe.ts
@src/main/log/pino.ts
@src/main/log/redact.ts

<interfaces>
<!-- Implements these channels declared in plan 01b CHANNELS: -->
<!-- ASK_ARIA: (req: AskRequest) => Promise<AskResponse | { error: string; route?: Route; reason?: string }> -->
<!-- DIAGNOSTICS_ROUTING_LOG: (req?: { limit?: number }) => Promise<{ entries: RoutingLogEntry[] }> -->
<!-- RoutingDecision (this plan): { route: 'LOCAL' | 'FRONTIER'; reason: string; model: string; provider: ProviderId | 'ollama' } -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Hard-rules classifier + LLM router (fail-closed) + providers factory + routingLog</name>
  <files>src/main/llm/classifier.ts, src/main/llm/router.ts, src/main/llm/providers.ts, src/main/llm/routingLog.ts, tests/unit/main/llm/classifier.spec.ts, tests/unit/main/llm/router.spec.ts, tests/unit/main/llm/routingLog.spec.ts</files>
  <read_first>
    - .planning/phases/01-foundation/01-CONTEXT.md (D-05 source-default + pattern overrides; D-06 routing_log columns; D-08 fail-closed; D-09 three frontier providers, one active)
    - .planning/phases/01-foundation/01-RESEARCH.md lines 420-475 (router/provider code shape; ollama-ai-provider-v2 import)
    - .planning/phases/01-foundation/01-RESEARCH.md lines 539-547 (Pitfall 4: ollama-ai-provider-v2 NOT ollama-ai-provider)
    - src/main/db/connect.ts (Db type; routing_log table from Plan 02 task 2)
    - src/main/log/redact.ts (DEFAULT_PII_PATTERNS — reuse same patterns)
    - src/main/secrets/safeStorage.ts (getActiveProvider, getFrontierKey, hasFrontierKey)
  </read_first>
  <behavior>
    - `classifySensitivity(prompt)` returns `{ sensitive: boolean, matched: string[] }`. Patterns: email, E.164/NANP phone, currency `\\$[\\d,]+(?:\\.\\d+)?`, SSN `\\b\\d{3}-\\d{2}-\\d{4}\\b`. Reuses `DEFAULT_PII_PATTERNS` from `src/main/log/redact.ts`.
    - `LLMRouter.classify({ prompt, source })`:
      1. If `source` is undefined/empty → `{ route: 'LOCAL', reason: 'fail-closed-source-unset', model: <local>, provider: 'ollama' }` (LLM-04)
      2. If `classifySensitivity(prompt).sensitive` → `{ route: 'LOCAL', reason: 'pii-pattern-matched:<names>', ... }` (LLM-01)
      3. Else if `source ∈ { 'user-email', 'user-calendar', 'user-transcript' }` → `{ route: 'LOCAL', reason: 'user-data-source:<source>', ... }` (D-05)
      4. Else if `source === 'generic'` AND a frontier provider is active AND has a key → `{ route: 'FRONTIER', reason: 'generic-source-frontier-active', model: <frontier-model-id>, provider: <activeProvider> }`
      5. Else → `{ route: 'LOCAL', reason: 'frontier-not-configured', ... }` (D-10 + LLM-05)
    - `getLocalModel()` returns the ollama-ai-provider-v2 model for `llama3.1:8b-instruct-q4_K_M`, constructed via `createOllama({ baseURL: 'http://127.0.0.1:11434' })`. If Ollama is unreachable, throw `OllamaUnavailableError`.
    - `getFrontierModel(provider)` returns the AI SDK 6 model for the active provider using the safeStorage-decrypted key
    - `writeRoutingLog(db, entry)` inserts one row; `readRecentRoutingLog(db, limit=100)` selects `ORDER BY id DESC LIMIT ?`. Prompt is NEVER stored — only `prompt_hash` (SHA-256 hex).
  </behavior>
  <action>
    Create `src/main/llm/classifier.ts` re-exporting `DEFAULT_PII_PATTERNS` from `src/main/log/redact.ts` and adding `classifySensitivity(prompt: string): { sensitive: boolean; matched: string[] }`. `matched` returns the names of patterns that hit (e.g., `['email', 'currency']`).

    Create `src/main/llm/providers.ts` exporting `getLocalModel(opts?)` and `getFrontierModel(provider: ProviderId)`. Use lazy module-singleton caches keyed by `provider+key-hash`. Imports: `import { createOllama } from 'ollama-ai-provider-v2'`, `import { createAnthropic } from '@ai-sdk/anthropic'`, `import { createOpenAI } from '@ai-sdk/openai'`, `import { createGoogleGenerativeAI } from '@ai-sdk/google'`. Pin default model IDs as exported consts: `DEFAULT_LOCAL_MODEL = 'llama3.1:8b-instruct-q4_K_M'`, `DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5'`, `DEFAULT_OPENAI_MODEL = 'gpt-4o-mini'`, `DEFAULT_GOOGLE_MODEL = 'gemini-2.5-flash'`. Executor MUST verify model IDs against current vendor docs at execute time and record chosen IDs in 01-04-SUMMARY.md.

    Create `src/main/llm/router.ts` exporting `LLMRouter` class with constructor `({ getActiveProviderFn, hasFrontierKeyFn, classifierFn })` so unit tests can inject stubs. Method `async classify({ prompt, source })` implements the five-branch logic. Also export `RoutingDecision` type and `OllamaUnavailableError`, `FrontierUnavailableError` classes.

    Create `src/main/llm/routingLog.ts`. `writeRoutingLog(db, { ts, route, reason, source, prompt_hash, model, latency_ms, ok })` runs the 8-column INSERT. `readRecentRoutingLog(db, limit = 100)` runs the SELECT and maps to `RoutingLogEntry[]`. `hashPrompt(prompt)` = `crypto.createHash('sha256').update(prompt).digest('hex')`. Full prompt text NEVER persisted.

    Create `tests/unit/main/llm/classifier.spec.ts` covering: empty string → not sensitive; `Email me at foo@bar.com` → sensitive matched=['email']; `$1,234.56` → matched=['currency']; `My SSN is 123-45-6789` → matched=['ssn']; `Plain question about weather` → not sensitive.

    Create `tests/unit/main/llm/router.spec.ts` injecting stubs and covering all 5 branches (fail-closed-source-unset; user-data-source:user-email; pii-pattern-matched:email; generic-source-frontier-active; frontier-not-configured).

    Create `tests/unit/main/llm/routingLog.spec.ts` against a temp SQLCipher DB (random key + Plan 02 migration runner to create the table): insert 3 rows; `readRecentRoutingLog(db, 2)` returns the last 2 in DESC order; `hashPrompt('hello')` returns the known SHA-256 hex `2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824`.
  </action>
  <verify>
    <automated>npm run test:unit -- tests/unit/main/llm</automated>
  </verify>
  <acceptance_criteria>
    - `tests/unit/main/llm/classifier.spec.ts` passes (≥5 cases)
    - `tests/unit/main/llm/router.spec.ts` passes covering all 5 router branches
    - `tests/unit/main/llm/routingLog.spec.ts` passes; locks the SHA-256 hex for `hashPrompt('hello')`
    - `grep -c "fail-closed-source-unset" src/main/llm/router.ts` returns ≥`1`
    - `grep -c "pii-pattern-matched" src/main/llm/router.ts` returns ≥`1`
    - `grep -c "frontier-not-configured" src/main/llm/router.ts` returns ≥`1`
    - `grep -c "ollama-ai-provider-v2" src/main/llm/providers.ts` returns ≥`1`
    - `grep -c "from 'ollama-ai-provider'" src/main/llm/providers.ts` returns `0`
    - `grep -c "INSERT INTO routing_log" src/main/llm/routingLog.ts` returns ≥`1`
    - `grep -c "prompt_hash" src/main/llm/routingLog.ts` returns ≥`1`; INSERT has 8 columns matching Plan 02 schema exactly
  </acceptance_criteria>
  <done>Router decides routes deterministically; classifier reuses redact patterns; ollama-ai-provider-v2 used; routing_log writes are hash-only.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: ASK_ARIA + DIAGNOSTICS_ROUTING_LOG IPC handlers + FULL local-path integration test</name>
  <files>src/main/ipc/ask.ts, src/main/ipc/diagnostics.ts, src/main/ipc/index.ts, tests/unit/main/ipc/ask.spec.ts, tests/unit/main/ipc/ask-local-handler.spec.ts</files>
  <read_first>
    - src/main/llm/router.ts, src/main/llm/providers.ts, src/main/llm/routingLog.ts (task 1)
    - src/main/ipc/index.ts (current state: Plan 03 wired Onboarding + Backup + Secrets + Ollama; THIS task appends Ask + Diagnostics)
    - .planning/phases/01-foundation/01-CONTEXT.md (D-10 LOCAL-only; D-12 dogfood loop)
    - src/main/db/connect.ts + src/main/db/migrations/runner.ts (Plan 02 — used by the new integration test)
  </read_first>
  <behavior>
    - `ASK_ARIA({ prompt, source })` flow:
      1. Start time = `performance.now()`
      2. `decision = await router.classify({ prompt, source })`
      3. If decision.route === 'LOCAL': call `getLocalModel()`; if Ollama unreachable, write routing_log with `ok=0, reason='ollama-unreachable'`, return error
      4. Else (FRONTIER): try `getFrontierModel(decision.provider)`. If `generateText` throws → fall back to LOCAL (LLM-05): re-classify with `reason='frontier-unavailable:<class>'`, call local model, write routing_log with the FALLBACK reason
      5. Call `await generateText({ model, prompt })` from `ai@^6`
      6. `writeRoutingLog(db, { ts: ISO, route, reason, source, prompt_hash: hashPrompt(prompt), model, latency_ms, ok: 1 })`
      7. Return `{ answer, route, reason, latency_ms }`
    - `DIAGNOSTICS_ROUTING_LOG({ limit = 100 })` returns `{ entries: readRecentRoutingLog(db, limit) }`
    - `registerHandlers` in `src/main/ipc/index.ts` calls (in order): registerOnboardingHandlers, registerBackupHandlers, registerSecretsHandlers, registerOllamaHandlers, registerAskHandlers, registerDiagnosticsHandlers
    - The NEW `ask-local-handler.spec.ts` integration test wires REAL classifier + REAL router + REAL routingLog + REAL temp SQLCipher DB (via Plan 02 openDb + migration runner) + MOCKED `generateText` returning a fixed string — and asserts `route=LOCAL`, `reason='frontier-not-configured'`, AND that a row is actually written to the routing_log table (Warning D fix from checker iteration 1: closes the gap that the LOCAL hello-Aria handler had no automated proof apart from the Ollama-dependent e2e).
  </behavior>
  <action>
    Create `src/main/ipc/ask.ts` exporting `registerAskHandlers(ipcMain, deps)` with deps `{ logger, dbHolder, router }`. Construct router lazily as `new LLMRouter({ getActiveProviderFn: getActiveProvider, hasFrontierKeyFn: hasFrontierKey, classifierFn: classifySensitivity })` (default; tests inject). Catch frontier errors: codes `'ENOTFOUND' | 'ECONNREFUSED' | 'ETIMEDOUT'` → `frontier-unavailable:network`; HTTP 4xx → `frontier-unavailable:auth`; HTTP 5xx / 429 → `frontier-unavailable:rate-limited-or-down`. Use AI SDK 6's typed errors (`APICallError`) where available.

    Create `src/main/ipc/diagnostics.ts` exporting `registerDiagnosticsHandlers(ipcMain, deps)` with deps `{ logger, dbHolder }`. `DIAGNOSTICS_ROUTING_LOG` returns `readRecentRoutingLog(dbHolder.db, req.limit ?? 100)`.

    Update `src/main/ipc/index.ts` `registerHandlers` to ALSO invoke `registerAskHandlers` + `registerDiagnosticsHandlers` after the existing four. Remove the no-op stubs for `ASK_ARIA` and `DIAGNOSTICS_ROUTING_LOG`.

    Create `tests/unit/main/ipc/ask.spec.ts` (stub-injected version):
    - `dbHolder = { db: <real temp SQLCipher with routing_log table> }`
    - `vi.mock('ai', ...)` so `generateText` returns `{ text: 'hello world' }` for the local sentinel and throws `APICallError` for the frontier sentinel
    - Stubs for `getLocalModel` (returns sentinel) and `getFrontierModel` (returns sentinel)
    Cases:
    1. Source=`generic`, prompt='What is the capital of France?', no frontier configured → routing_log row written with reason `frontier-not-configured`, return `{ answer: 'hello world', route: 'LOCAL', reason: 'frontier-not-configured' }`
    2. Source=`generic`, prompt benign, frontier configured AND generateText resolves on frontier → routing_log row with route=FRONTIER reason=`generic-source-frontier-active`
    3. Source=`generic`, prompt benign, frontier configured BUT generateText throws APICallError → falls back to LOCAL, routing_log row with reason starting `frontier-unavailable:`
    4. Source=`user-email`, prompt benign → route=LOCAL reason=`user-data-source:user-email`
    5. Source omitted → route=LOCAL reason=`fail-closed-source-unset`

    Create `tests/unit/main/ipc/ask-local-handler.spec.ts` — the FULL-PATH integration test (Warning D fix):
    - Create a fresh temp `userData` dir via `tests/setup.ts` factory
    - Generate a random 32-byte key with `crypto.randomBytes(32)`; call `openDb({ dataDir, dbKey, runMigrationsOnOpen: true })` from Plan 02 — produces a real SQLCipher DB with the routing_log table
    - Construct a real `LLMRouter` with real `classifySensitivity`, a `getActiveProviderFn` returning `null` (no frontier), and a real `hasFrontierKeyFn` returning `false`
    - Mock ONLY `ai.generateText` to return `{ text: 'Paris is the capital of France.' }` regardless of model argument
    - Mock `getLocalModel` to return a sentinel object (so the test does not require a running Ollama)
    - Register handlers against a stub `ipcMain` that records `.handle(name, fn)` mappings
    - Invoke the registered `ASK_ARIA` handler with `{ prompt: 'What is the capital of France?', source: 'generic' }`
    - Assertions:
      a. Return value matches `{ answer: 'Paris is the capital of France.', route: 'LOCAL', reason: 'frontier-not-configured', latency_ms: <number> }`
      b. `db.prepare('SELECT * FROM routing_log').all()` returns exactly 1 row
      c. That row has `route === 'LOCAL'`, `reason === 'frontier-not-configured'`, `source === 'generic'`, `ok === 1`, `prompt_hash === hashPrompt('What is the capital of France?')`, `model` matches `DEFAULT_LOCAL_MODEL`, `latency_ms > 0`
      d. The row's `ts` parses as a valid ISO timestamp
    - This test closes the gap (Warning D) by proving the entire ASK_ARIA → router → classifier → providers (mocked) → routingLog → DB write chain works without depending on Ollama or any network call.
  </action>
  <verify>
    <automated>npm run test:unit -- tests/unit/main/ipc/ask.spec.ts tests/unit/main/ipc/ask-local-handler.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - `tests/unit/main/ipc/ask.spec.ts` passes all 5 stub cases
    - `tests/unit/main/ipc/ask-local-handler.spec.ts` passes all 4 assertions (a, b, c, d)
    - `grep -c "frontier-unavailable" src/main/ipc/ask.ts` returns ≥`1`
    - `grep -c "writeRoutingLog" src/main/ipc/ask.ts` returns ≥`2` (success + ok=0 failure paths)
    - `grep -c "hashPrompt" src/main/ipc/ask.ts` returns ≥`1`
    - `grep -cE "logger\\.(info|debug).*prompt\\b" src/main/ipc/ask.ts` returns `0` (never log raw prompt)
    - `grep -cE "register(Onboarding|Backup|Secrets|Ollama|Ask|Diagnostics)Handlers" src/main/ipc/index.ts` returns `6`
  </acceptance_criteria>
  <done>ASK_ARIA implements LLM-01, LLM-03, LLM-04, LLM-05; frontier degradation transparent; routing_log persists only hashes; all six handler-registration functions wired; full-path LOCAL handler integration test provides Ollama-free automated proof of the hello-Aria loop.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Settings → Diagnostics UI ("Ask Aria" + routing-log panel) and hello-Aria e2e</name>
  <files>src/renderer/features/settings/DiagnosticsSection.tsx, src/renderer/features/settings/AskAriaBox.tsx, src/renderer/features/settings/RoutingLogPanel.tsx, src/renderer/features/settings/SettingsScreen.tsx, tests/e2e/hello-aria.spec.ts</files>
  <read_first>
    - .planning/phases/01-foundation/01-CONTEXT.md (D-07 last-N read-only; D-12 Ask Aria input + answer + route display; D-13 design tokens)
    - src/shared/ipc-contract.ts (AskRequest/Response, RoutingLogEntry)
    - src/renderer/features/settings/SettingsScreen.tsx (current state from Plan 03)
    - src/main/ipc/ask.ts, src/main/ipc/diagnostics.ts (task 2)
    - tests/e2e/fixtures/onboarded.ts (Plan 02 shared fixture)
  </read_first>
  <behavior>
    - Settings → Diagnostics route contains `<AskAriaBox/>` and `<RoutingLogPanel/>`
    - `AskAriaBox`: textarea (placeholder "Ask Aria anything…"), source selector (`generic` default), Submit button. On submit calls `window.aria.askAria({ prompt, source })`. While pending shows a spinner. On success shows: the answer, a badge `[LOCAL]` or `[FRONTIER]`, and the reason string + latency_ms.
    - `RoutingLogPanel`: calls `window.aria.diagnosticsRoutingLog({ limit: 100 })` on mount and after every successful Ask; renders a read-only table with columns ts, route, source, reason, model, latency_ms, ok.
    - Playwright e2e launches with a freshly-onboarded userData (uses `tests/e2e/fixtures/onboarded.ts` from Plan 02), navigates to Settings → Diagnostics, asks "What is the capital of France?" with source=`generic`, asserts answer panel appears with route=`LOCAL` reason=`frontier-not-configured`, asserts the routing-log table has ≥1 row.
  </behavior>
  <action>
    Create the three renderer components. Apply tokens from `src/renderer/app/theme/tokens.ts` for badge colors: LOCAL = accent indigo, FRONTIER = neutral. Display reason verbatim — the strings are the contract per D-06.

    Update `src/renderer/features/settings/SettingsScreen.tsx` to mount `<DiagnosticsSection/>` under the `data-testid="settings-diagnostics"` block. This is an additive edit to the composite created by Plan 03; the four Plan-03 sections remain mounted.

    Create `tests/e2e/hello-aria.spec.ts` reusing `tests/e2e/fixtures/onboarded.ts`:
    1. Launch Electron in the onboarded userData
    2. Navigate to `/settings/diagnostics` via side-nav click
    3. Type prompt "What is the capital of France?" into the Ask Aria textarea
    4. Select source `generic`
    5. Click Submit; wait for answer panel (timeout 30s — first local-model call can be slow)
    6. Assert the answer panel contains route badge `LOCAL`
    7. Assert reason text `frontier-not-configured` (no API key configured in test)
    8. Click into the routing-log panel; assert ≥1 row with route=LOCAL source=generic
    9. Pre-flight skip: if Ollama unreachable (via a test-only IPC), skip with a clear `OLLAMA_REQUIRED` message — the full-path unit test in Task 2 already proves the handler chain without Ollama.
  </action>
  <verify>
    <automated>npm run build && npm run test:e2e -- tests/e2e/hello-aria.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - `tests/e2e/hello-aria.spec.ts` passes OR cleanly skips with `OLLAMA_REQUIRED`
    - Diagnostics route renders both `AskAriaBox` and `RoutingLogPanel`
    - `grep -c "LOCAL\\|FRONTIER" src/renderer/features/settings/AskAriaBox.tsx` returns ≥`2`
    - `grep -c "diagnosticsRoutingLog" src/renderer/features/settings/RoutingLogPanel.tsx` returns ≥`1`
    - `grep -c "limit: 100" src/renderer/features/settings/RoutingLogPanel.tsx` returns ≥`1`
    - `grep -c "<th>" src/renderer/features/settings/RoutingLogPanel.tsx` returns ≥`7`
  </acceptance_criteria>
  <done>Hello-Aria dogfood loop is live; renderer shows answer + route + reason; routing-log panel reflects the new row; e2e exercises the Walking Skeleton end-to-end (and the Task-2 integration test provides Ollama-free coverage of the same path).</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Renderer → Main askAria | Renderer sends prompt; main owns route decision + model call; prompt never sent to FRONTIER if classifier flags PII |
| Main → Ollama localhost | Loopback only; no auth |
| Main → frontier API | TLS, key in safeStorage; PII pre-filtered; no raw prompt in logs |
| Main → SQLCipher routing_log | Only prompt HASH stored, not text |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-04-01 | Information Disclosure | PII routed to FRONTIER | mitigate (HIGH; LLM-01) | Hard-rules classifier forces LOCAL on email/phone/$$/SSN; fail-closed on unset source; classifier reuses redact patterns so drift is impossible |
| T-01-04-02 | Information Disclosure | Raw prompt persisted in routing_log | mitigate (HIGH) | Schema stores `prompt_hash` (SHA-256); tested by Plan 02 schema and Task 1 grep-gate |
| T-01-04-03 | Information Disclosure | Raw prompt in pino logs | mitigate (HIGH) | Grep-gate on `logger.(info|debug).*prompt`; redact pipeline covers |
| T-01-04-04 | Denial of Service | Frontier down → app freezes | mitigate (HIGH; LLM-05) | Transparent fallback to LOCAL; routing_log records `frontier-unavailable:<class>` |
| T-01-04-05 | Spoofing | Active provider switched silently | mitigate (LOW) | `model` column in routing_log records the exact model ID used |
| T-01-04-06 | Repudiation | Classifier decision not auditable | mitigate (HIGH; LLM-03) | `reason` column records the verbatim decision string |
| T-01-04-07 | Tampering | Reason string drift between code and DB | mitigate (MEDIUM) | Reason strings are part of the contract; pinned by acceptance grep on exact literals |
</threat_model>

<verification>
- All three `<automated>` commands pass on Windows 11
- The new `ask-local-handler.spec.ts` integration test passes WITHOUT Ollama running (Warning D — Ollama-free proof of the LOCAL handler chain)
- Manual: with Ollama running and no frontier key configured, ask "Hello" in Diagnostics → route=LOCAL, reason=`frontier-not-configured`, routing-log shows the new row
- Manual: configure an Anthropic key + set active provider, ask "What is 2+2?" with source=`generic` → route=FRONTIER, reason=`generic-source-frontier-active`
- Manual: ask "Email me at foo@bar.com" with source=`generic` → route=LOCAL, reason starts with `pii-pattern-matched:email`
- Manual: disconnect network OR clear key while active provider set, ask generic prompt → route=LOCAL via fallback, reason=`frontier-unavailable:network` or `frontier-unavailable:auth`
</verification>

<success_criteria>
Plan 04 completes Phase-1 ROADMAP success criterion #3 (routing decision logged with reason for every Ask). Combined with Plans 01b/02/03, ALL five Phase-1 success criteria are satisfied:
1. Working app window — Plan 01b
2. Frontier API key in OS keychain — Plan 03
3. Routing decision logged with reason — Plan 04
4. Encrypted SQLCipher DB backed up + restored — Plan 02
5. Ollama-missing warning with install instructions — Plan 03
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation/01-04-SUMMARY.md` describing:
- Exact model IDs pinned for local + each frontier provider (verify against current vendor docs)
- Whether hello-Aria e2e ran or was skipped (Ollama presence)
- Confirmation that `ask-local-handler.spec.ts` ran without Ollama (Warning D closed)
- Sample routing-log rows from a real Ask Aria session (LOCAL + FRONTIER paths)
- Confirmation that the four LLM requirements (LLM-01, LLM-03, LLM-04, LLM-05) are each demonstrably satisfied
- Confirmation that the five ROADMAP Phase-1 success criteria are all green (table)
</output>
