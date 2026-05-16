---
phase: 01-foundation
plan: 04
type: execute
wave: 3
depends_on: ["01-foundation/01", "01-foundation/02", "01-foundation/03"]
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
  - tests/e2e/hello-aria.spec.ts
autonomous: true
requirements: [LLM-01, LLM-03, LLM-04, LLM-05]
tags: [llm, ai-sdk, routing, classifier, ollama, anthropic, openai, google]

must_haves:
  truths:
    - "Every LLM call passes through router.classify({ prompt, source }) which returns { route, reason }"
    - "Hard-rules classifier (regex over emails, phones, $$, SSN, names list) forces LOCAL when matched; fail-closed: source unset OR classifier uncertain → LOCAL (LLM-04)"
    - "Each call writes one row to routing_log: timestamp, route, reason, source, prompt_hash, model, latency_ms, ok"
    - "User asks a question in Settings → Diagnostics → 'Ask Aria'; UI shows the answer AND the route (LOCAL/FRONTIER) + reason"
    - "Frontier unreachable or rate-limited OR missing key → router falls back to LOCAL transparently; routing_log records reason='frontier-unavailable' (LLM-05)"
    - "Routing-log panel shows the last 100 entries, newest first, read-only (D-07)"
    - "Hello-Aria loop works LOCAL-only with Ollama running and NO frontier key configured (D-10)"
  artifacts:
    - path: "src/main/llm/classifier.ts"
      provides: "Hard-rules regex classifier returning { sensitive: bool, matched: string[] }"
      exports: ["classifySensitivity", "DEFAULT_PII_PATTERNS"]
    - path: "src/main/llm/router.ts"
      provides: "classify({prompt, source}) → {route, reason, model}; chooseProvider() helper"
      exports: ["LLMRouter", "RoutingDecision"]
    - path: "src/main/llm/providers.ts"
      provides: "Lazy-construct AI SDK 6 provider clients: anthropic, openai, google, ollama via ollama-ai-provider-v2"
      exports: ["getFrontierModel", "getLocalModel"]
    - path: "src/main/llm/routingLog.ts"
      provides: "Insert + read-last-N rows from routing_log table"
      exports: ["writeRoutingLog", "readRecentRoutingLog"]
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

**As a** solo developer dogfooding Aria on Windows 11, **I want to** type a question into Settings → Diagnostics → "Ask Aria" and see (a) the model's answer and (b) the routing decision with reason, with the decision row persisted to the encrypted routing_log, **so that** the LLM-router contract every later phase plugs into is proven end-to-end (the "hello briefing" dogfood loop).

Purpose: Implements LLM-01 (PII → LOCAL only), LLM-03 (every decision logged with reason), LLM-04 (fail closed → LOCAL when uncertain), LLM-05 (graceful frontier degradation). Closes the Walking Skeleton: renderer → IPC → router → Ollama or Anthropic/OpenAI/Google → SQLCipher routing_log → renderer display.

Output: Hard-rules sensitivity classifier, LLM router skeleton over AI SDK 6, Diagnostics surface with "Ask Aria" + "last 100 routing decisions" panel, full hello-Aria e2e test.
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
@.planning/phases/01-foundation/01-01-SUMMARY.md
@.planning/phases/01-foundation/01-02-SUMMARY.md
@.planning/phases/01-foundation/01-03-SUMMARY.md
@src/shared/ipc-contract.ts
@src/main/db/connect.ts
@src/main/secrets/safeStorage.ts
@src/main/llm/ollamaProbe.ts
@src/main/log/pino.ts
@src/main/log/redact.ts

<interfaces>
<!-- Implements these channels declared in plan-01 CHANNELS: -->
<!-- ASK_ARIA: (req: AskRequest) => Promise<AskResponse | { error: string; route?: Route; reason?: string }> -->
<!-- DIAGNOSTICS_ROUTING_LOG: (req?: { limit?: number }) => Promise<{ entries: RoutingLogEntry[] }> -->
<!-- RoutingDecision (this plan): { route: 'LOCAL' | 'FRONTIER'; reason: string; model: string; provider: ProviderId | 'ollama' } -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Hard-rules sensitivity classifier + LLM router (fail-closed) + providers factory</name>
  <files>src/main/llm/classifier.ts, src/main/llm/router.ts, src/main/llm/providers.ts, src/main/llm/routingLog.ts, tests/unit/main/llm/classifier.spec.ts, tests/unit/main/llm/router.spec.ts, tests/unit/main/llm/routingLog.spec.ts</files>
  <read_first>
    - .planning/phases/01-foundation/01-CONTEXT.md (D-05 source-default + pattern overrides; D-06 routing_log columns; D-08 fail-closed; D-09 three frontier providers, one active)
    - .planning/phases/01-foundation/01-RESEARCH.md lines 420-475 (router/provider code shape; ollama-ai-provider-v2 import)
    - .planning/phases/01-foundation/01-RESEARCH.md lines 539-547 (Pitfall 4: ollama-ai-provider-v2 NOT ollama-ai-provider)
    - src/main/db/connect.ts (Db type; routing_log table from Plan 02 task 2)
    - src/main/log/redact.ts (DEFAULT_PII_PATTERNS — reuse same patterns for classifier consistency)
    - src/main/secrets/safeStorage.ts (getActiveProvider, getFrontierKey, hasFrontierKey)
  </read_first>
  <behavior>
    - `classifySensitivity(prompt)` returns `{ sensitive: boolean, matched: string[] }`. Patterns: email, E.164/NANP phone, currency `\\$[\\d,]+(?:\\.\\d+)?`, SSN `\\b\\d{3}-\\d{2}-\\d{4}\\b`. Reuse `DEFAULT_PII_PATTERNS` from `src/main/log/redact.ts` (single source-of-truth).
    - `LLMRouter.classify({ prompt, source })`:
      1. If `source` is undefined/empty → `{ route: 'LOCAL', reason: 'fail-closed-source-unset', model: <local>, provider: 'ollama' }` (LLM-04)
      2. If `classifySensitivity(prompt).sensitive` → `{ route: 'LOCAL', reason: 'pii-pattern-matched:<comma-separated-names>', ... }` (LLM-01)
      3. Else if `source` ∈ `{ 'user-email', 'user-calendar', 'user-transcript' }` → `{ route: 'LOCAL', reason: 'user-data-source:<source>', ... }` (D-05)
      4. Else if `source === 'generic'` AND a frontier provider is active AND has a key → `{ route: 'FRONTIER', reason: 'generic-source-frontier-active', model: <frontier-model-id>, provider: <activeProvider> }`
      5. Else (generic, no frontier configured) → `{ route: 'LOCAL', reason: 'frontier-not-configured', ... }` (D-10 + LLM-05)
    - `getLocalModel()` returns the ollama-ai-provider-v2 model object for `llama3.1:8b-instruct-q4_K_M` (per CLAUDE.md default), constructed via `createOllama({ baseURL: 'http://127.0.0.1:11434' })`. If Ollama is unreachable (probe), throw `OllamaUnavailableError` — caller handles.
    - `getFrontierModel(provider)` returns the AI SDK 6 model for the active provider using the safeStorage-decrypted key:
      - `anthropic`: `createAnthropic({ apiKey })('claude-sonnet-4-5')` (or current default; pin a const)
      - `openai`: `createOpenAI({ apiKey })('gpt-4o-mini')` (placeholder default; pin)
      - `google`: `createGoogleGenerativeAI({ apiKey })('gemini-2.5-flash')` (placeholder default; pin)
    - `writeRoutingLog(db, entry)` inserts one row; `readRecentRoutingLog(db, limit=100)` selects `ORDER BY id DESC LIMIT ?`. Prompt is NEVER stored — only `prompt_hash` (SHA-256 hex). Implements LLM-03 + D-06.
  </behavior>
  <action>
    Create `src/main/llm/classifier.ts` re-exporting `DEFAULT_PII_PATTERNS` from `src/main/log/redact.ts` and adding `classifySensitivity(prompt: string): { sensitive: boolean; matched: string[] }`. `matched` returns names of the patterns that hit (e.g. `['email', 'currency']`) for use in routing reason strings.

    Create `src/main/llm/providers.ts` exporting `getLocalModel(opts?: { probe?: OllamaStatus })` and `getFrontierModel(provider: ProviderId)`. Use lazy module-singleton caches keyed by `provider+key-hash` to avoid reconstructing on every call. Imports: `import { createOllama } from 'ollama-ai-provider-v2'`, `import { createAnthropic } from '@ai-sdk/anthropic'`, `import { createOpenAI } from '@ai-sdk/openai'`, `import { createGoogleGenerativeAI } from '@ai-sdk/google'`. Pin default model IDs as exported consts: `DEFAULT_LOCAL_MODEL = 'llama3.1:8b-instruct-q4_K_M'`, `DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5'`, `DEFAULT_OPENAI_MODEL = 'gpt-4o-mini'`, `DEFAULT_GOOGLE_MODEL = 'gemini-2.5-flash'`. If these names drift between CLAUDE.md scaffold time and execute time, executor MUST verify against `https://docs.anthropic.com/en/docs/about-claude/models`, `https://platform.openai.com/docs/models`, and `https://ai.google.dev/gemini-api/docs/models` before pinning — record chosen IDs in 01-04-SUMMARY.md.

    Create `src/main/llm/router.ts` exporting `LLMRouter` class with constructor `({ getActiveProviderFn, hasFrontierKeyFn, classifierFn })` so unit tests can inject stubs. Method `async classify({ prompt, source })` implements the five-branch logic above. Also export `RoutingDecision` type and `OllamaUnavailableError`, `FrontierUnavailableError` classes.

    Create `src/main/llm/routingLog.ts`. `writeRoutingLog(db, { ts, route, reason, source, prompt_hash, model, latency_ms, ok })` runs `db.prepare('INSERT INTO routing_log (ts, route, reason, source, prompt_hash, model, latency_ms, ok) VALUES (?,?,?,?,?,?,?,?)').run(...)`. `readRecentRoutingLog(db, limit = 100)` runs the SELECT and maps to `RoutingLogEntry[]`. `hashPrompt(prompt)` = `crypto.createHash('sha256').update(prompt).digest('hex')`. Per security note: `hashPrompt` is the ONLY way prompt content enters the DB — full prompt text never persisted.

    Create `tests/unit/main/llm/classifier.spec.ts` covering: empty string → not sensitive; `Email me at foo@bar.com` → sensitive matched=['email']; `$1,234.56` → sensitive matched=['currency']; `My SSN is 123-45-6789` → sensitive matched=['ssn']; `Plain question about weather` → not sensitive.

    Create `tests/unit/main/llm/router.spec.ts` injecting stubs: source unset → LOCAL fail-closed; source=`user-email` + benign prompt → LOCAL `user-data-source:user-email`; source=`generic` + PII prompt → LOCAL `pii-pattern-matched:email`; source=`generic` + benign + active provider with key → FRONTIER `generic-source-frontier-active`; source=`generic` + benign + no active provider → LOCAL `frontier-not-configured`. Use a fake `getActiveProvider`/`hasFrontierKey` that returns deterministic values per test.

    Create `tests/unit/main/llm/routingLog.spec.ts` against a temp SQLCipher DB (random key): insert 3 rows; `readRecentRoutingLog(db, 2)` returns the last 2 in DESC order; `hashPrompt('hello')` returns the known SHA-256 hex `2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824`.
  </action>
  <verify>
    <automated>npm run test:unit -- tests/unit/main/llm</automated>
  </verify>
  <acceptance_criteria>
    - `tests/unit/main/llm/classifier.spec.ts` passes (≥5 cases)
    - `tests/unit/main/llm/router.spec.ts` passes covering all 5 router branches
    - `tests/unit/main/llm/routingLog.spec.ts` passes and asserts the known SHA-256 hex for `hashPrompt('hello')`
    - `grep -c "fail-closed-source-unset" src/main/llm/router.ts` returns ≥`1`
    - `grep -c "pii-pattern-matched" src/main/llm/router.ts` returns ≥`1`
    - `grep -c "frontier-not-configured" src/main/llm/router.ts` returns ≥`1`
    - `grep -c "ollama-ai-provider-v2" src/main/llm/providers.ts` returns ≥`1` (NOT `from 'ollama-ai-provider'`)
    - `grep -c "from 'ollama-ai-provider'" src/main/llm/providers.ts` returns `0` (deprecated package not imported)
    - `grep -c "INSERT INTO routing_log" src/main/llm/routingLog.ts` returns ≥`1`
    - Full prompt text is NEVER persisted: `grep -c "prompt_hash" src/main/llm/routingLog.ts` returns ≥`1` AND the INSERT statement has 8 columns matching the Plan 02 schema exactly
  </acceptance_criteria>
  <done>Router decides routes deterministically across five branches; classifier reuses the redact patterns; ollama-ai-provider-v2 (not the abandoned v1) is the local provider; routing_log writes are hash-only.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: ASK_ARIA + DIAGNOSTICS_ROUTING_LOG IPC handlers with frontier-degradation fallback</name>
  <files>src/main/ipc/ask.ts, src/main/ipc/diagnostics.ts, src/main/ipc/index.ts, tests/unit/main/ipc/ask.spec.ts</files>
  <read_first>
    - src/main/llm/router.ts, src/main/llm/providers.ts, src/main/llm/routingLog.ts (task 1 outputs)
    - src/main/ipc/index.ts (current registration scaffold; Plan 02 task 3 added registerOnboardingHandlers + registerBackupHandlers + registerSecretsHandlers + registerOllamaHandlers; THIS task adds registerAskHandlers + registerDiagnosticsHandlers)
    - .planning/phases/01-foundation/01-CONTEXT.md (D-10 LOCAL-only mode; D-12 dogfood loop)
    - src/main/log/pino.ts (logger; routing-log INSERT params must not include raw prompt)
  </read_first>
  <behavior>
    - `ASK_ARIA({ prompt, source })` flow:
      1. Start time = `performance.now()`
      2. `decision = await router.classify({ prompt, source })`
      3. If decision.route === 'LOCAL': try `getLocalModel()`; if Ollama unreachable, write routing_log with `ok=0, reason='ollama-unreachable'`, return `{ error: 'ollama-unreachable', route: 'LOCAL', reason: 'ollama-unreachable' }`
      4. Else (FRONTIER): try `getFrontierModel(decision.provider)`. If `generateText` throws (network / 429 / auth) → fall back to LOCAL (LLM-05): re-classify with `reason='frontier-unavailable:<error-class>'`, call local model, write routing_log with the FALLBACK reason
      5. Call `await generateText({ model, prompt })` from `ai@^6`
      6. latency_ms = end - start
      7. `writeRoutingLog(db, { ts: ISO, route, reason, source, prompt_hash: hashPrompt(prompt), model, latency_ms, ok: 1 })`
      8. Return `{ answer, route, reason, latency_ms }`
    - `DIAGNOSTICS_ROUTING_LOG({ limit = 100 })` returns `{ entries: readRecentRoutingLog(db, limit) }`. Renderer-facing; `prompt_hash` is included but never the prompt text.
    - All IPC handlers receive the shared `dbHolder` (from Plan 02) so they can access the open Db handle after onboarding/unlock
    - `registerHandlers` in `src/main/ipc/index.ts` now calls (in order): registerOnboardingHandlers, registerBackupHandlers, registerSecretsHandlers, registerOllamaHandlers, registerAskHandlers, registerDiagnosticsHandlers
  </behavior>
  <action>
    Create `src/main/ipc/ask.ts` exporting `registerAskHandlers(ipcMain, deps)` with deps `{ logger, dbHolder, router }`. Implementation per behavior above. Pre-build router as `new LLMRouter({ getActiveProviderFn: getActiveProvider, hasFrontierKeyFn: hasFrontierKey, classifierFn: classifySensitivity })` and pass in via deps OR construct lazily in handler — choose lazy to keep test injection simple. Catch frontier errors: `Error` instances with codes `'ENOTFOUND' | 'ECONNREFUSED' | 'ETIMEDOUT'` → `frontier-unavailable:network`; HTTP 4xx → `frontier-unavailable:auth`; HTTP 5xx / 429 → `frontier-unavailable:rate-limited-or-down`. Use AI SDK 6's typed errors (`APICallError`) where available.

    Create `src/main/ipc/diagnostics.ts` exporting `registerDiagnosticsHandlers(ipcMain, deps)` with deps `{ logger, dbHolder }`. `DIAGNOSTICS_ROUTING_LOG` returns `readRecentRoutingLog(dbHolder.db, req.limit ?? 100)`.

    Update `src/main/ipc/index.ts` `registerHandlers` to invoke `registerAskHandlers` + `registerDiagnosticsHandlers` after the others. Remove the corresponding no-op stubs.

    Create `tests/unit/main/ipc/ask.spec.ts` injecting:
    - `dbHolder = { db: <real temp SQLCipher> }`
    - A fake `generateText` (vi.mock('ai', ...)) that returns `{ text: 'hello world' }` for the local model and throws `APICallError` for the frontier model
    - Stubs for `getLocalModel` (returns sentinel), `getFrontierModel` (returns sentinel)
    Test cases:
    1. Source=`generic`, prompt='What is the capital of France?', no frontier configured → invokes local, writes routing_log row with reason `frontier-not-configured`, returns `{ answer: 'hello world', route: 'LOCAL', reason: 'frontier-not-configured' }`
    2. Source=`generic`, prompt benign, frontier configured AND generateText resolves on frontier → routing_log shows route=FRONTIER reason=`generic-source-frontier-active`
    3. Source=`generic`, prompt benign, frontier configured BUT generateText throws APICallError → falls back to LOCAL, routing_log shows reason `frontier-unavailable:...`
    4. Source=`user-email`, prompt benign → route=LOCAL reason=`user-data-source:user-email`
    5. Source omitted → route=LOCAL reason=`fail-closed-source-unset`
  </action>
  <verify>
    <automated>npm run test:unit -- tests/unit/main/ipc/ask.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - `tests/unit/main/ipc/ask.spec.ts` passes all 5 cases
    - `grep -c "frontier-unavailable" src/main/ipc/ask.ts` returns ≥`1`
    - `grep -c "writeRoutingLog" src/main/ipc/ask.ts` returns ≥`2` (success and ok=0 failure paths)
    - `grep -c "hashPrompt" src/main/ipc/ask.ts` returns ≥`1`
    - `grep -cE "logger\\.(info|debug).*prompt\\b" src/main/ipc/ask.ts` returns `0` (never log raw prompt)
    - `src/main/ipc/index.ts` `registerHandlers` calls all 6 handler-registration functions: onboarding, backup, secrets, ollama, ask, diagnostics — verifiable by `grep -cE "register(Onboarding|Backup|Secrets|Ollama|Ask|Diagnostics)Handlers" src/main/ipc/index.ts` returning `6`
  </acceptance_criteria>
  <done>ASK_ARIA implements LLM-01, LLM-03, LLM-04, LLM-05 against the routing_log; frontier degradation is transparent to the renderer; routing_log persists only prompt hashes; all six IPC surfaces wired in registerHandlers.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Settings → Diagnostics UI ("Ask Aria" box + routing-log panel) and hello-Aria e2e</name>
  <files>src/renderer/features/settings/DiagnosticsSection.tsx, src/renderer/features/settings/AskAriaBox.tsx, src/renderer/features/settings/RoutingLogPanel.tsx, src/renderer/features/settings/SettingsScreen.tsx, tests/e2e/hello-aria.spec.ts</files>
  <read_first>
    - .planning/phases/01-foundation/01-CONTEXT.md (D-07 minimal last-N read-only; D-12 Ask Aria input + answer + route display; D-13 design tokens)
    - src/shared/ipc-contract.ts (AskRequest/Response, RoutingLogEntry)
    - src/renderer/features/settings/SettingsScreen.tsx (current shell)
    - src/main/ipc/ask.ts, src/main/ipc/diagnostics.ts (task 2 outputs)
  </read_first>
  <behavior>
    - Settings → Diagnostics route contains an `<AskAriaBox/>` and a `<RoutingLogPanel/>`
    - `AskAriaBox`: textarea (placeholder "Ask Aria anything…"), source selector (`generic` default; dropdown for testing other sources), Submit button. On submit calls `window.aria.askAria({ prompt, source })`. While pending shows a spinner. On success shows a panel with: the answer (markdown-rendered), a badge `[LOCAL]` or `[FRONTIER]`, and the reason string + latency_ms.
    - `RoutingLogPanel`: calls `window.aria.diagnosticsRoutingLog({ limit: 100 })` on mount and after every successful Ask submission; renders a read-only table with columns: ts, route, source, reason, model, latency_ms, ok. No filtering or search (D-07 — full UI deferred to Phase 3).
    - Playwright e2e launches with a freshly-onboarded userData (use a shared fixture that pre-creates vault + DB from the Plan 02 e2e), navigates to Settings → Diagnostics, asks "What is the capital of France?" with source=`generic`, asserts the answer panel appears with route=`LOCAL` and reason=`frontier-not-configured` (since no key is set in the test), asserts the routing-log table now has at least 1 row whose route column is `LOCAL`.
  </behavior>
  <action>
    Create the three renderer components. Use shadcn primitives if introduced (`<Button>`, `<Textarea>`, `<Select>`, `<Table>`); otherwise plain Tailwind. Apply tokens from `src/renderer/app/theme/tokens.ts` for badge colors: LOCAL = accent indigo, FRONTIER = neutral. Display reason verbatim — the strings are the contract per D-06.

    Update `src/renderer/features/settings/SettingsScreen.tsx` to mount `<DiagnosticsSection/>` under the `data-testid="settings-diagnostics"` block. Wave-coordination note: Plan 02 task 3 had ownership of SettingsScreen.tsx via the resolution recorded in Plan 03 task 2's action. Plan 04 also touches SettingsScreen.tsx. Since this is wave 3 AFTER Plans 02/03 complete, there is no parallel-wave file-overlap conflict; Plan 04 simply adds the Diagnostics subsection mount.

    Create `tests/e2e/hello-aria.spec.ts`. Pre-setup: use a Playwright `beforeAll` that runs the same onboarding fixture as `tests/e2e/onboarding.spec.ts` (extract the helper into `tests/e2e/fixtures/onboarded.ts` during this task; both specs use it). Spec body:
    1. Launch Electron app in the onboarded userData
    2. Navigate to `/settings/diagnostics` via UI click on side nav → Settings → Diagnostics subsection
    3. Type prompt "What is the capital of France?" into the Ask Aria textarea
    4. Select source `generic`
    5. Click Submit
    6. Wait for answer panel (timeout 30s — local model can be slow on first call)
    7. Assert the answer panel contains a route badge with text `LOCAL`
    8. Assert the answer panel contains the literal reason text `frontier-not-configured` (since no API key is configured in the test)
    9. Click into the routing-log panel; assert at least 1 row exists with route=LOCAL and source=generic
    10. Pre-flight skip: if `ollamaProbe()` (called from main process via a test-only IPC) returns unreachable, skip the test with a clear message — Ollama presence on the test box is required for the LOCAL branch to actually generate; document in 01-04-SUMMARY.md whether the test ran or was skipped on the dev box.
  </action>
  <verify>
    <automated>npm run build && npm run test:e2e -- tests/e2e/hello-aria.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - `tests/e2e/hello-aria.spec.ts` passes OR cleanly skips with a documented `OLLAMA_REQUIRED` message
    - Diagnostics route renders both `AskAriaBox` and `RoutingLogPanel` components
    - `grep -c "LOCAL\\|FRONTIER" src/renderer/features/settings/AskAriaBox.tsx` returns ≥`2`
    - `grep -c "diagnosticsRoutingLog" src/renderer/features/settings/RoutingLogPanel.tsx` returns ≥`1`
    - `grep -c "limit: 100" src/renderer/features/settings/RoutingLogPanel.tsx` returns ≥`1` (D-07 last-N default)
    - Routing-log panel table renders columns ts/route/source/reason/model/latency_ms/ok — verifiable by `grep -c "<th>" src/renderer/features/settings/RoutingLogPanel.tsx` returning ≥`7`
  </acceptance_criteria>
  <done>Hello-Aria dogfood loop is live; renderer shows answer + route + reason; routing-log panel reflects the new row; e2e test exercises the entire Walking Skeleton (renderer → preload → IPC → router → Ollama → SQLCipher → renderer).</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Renderer → Main askAria | Renderer sends the prompt to main; main owns route decision + model call; prompt never sent to FRONTIER if classifier flags PII |
| Main → Ollama localhost | Loopback only; no auth |
| Main → frontier API (anthropic / openai / google) | TLS, key in safeStorage; PII pre-filtered by classifier; no raw prompt in logs |
| Main → SQLCipher routing_log | Only prompt HASH stored, not text |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-04-01 | Information Disclosure | PII routed to FRONTIER | mitigate (HIGH; LLM-01) | Hard-rules classifier forces LOCAL on email/phone/$$/SSN; fail-closed on unset source; classifier reuses redact patterns so drift is impossible |
| T-01-04-02 | Information Disclosure | Raw prompt persisted in routing_log → readable in user-facing log panel | mitigate (HIGH) | Schema stores `prompt_hash` (SHA-256) only; tested by Plan 02 schema and Task 1 grep-gate; renderer never has a channel to retrieve the prompt text |
| T-01-04-03 | Information Disclosure | Raw prompt in pino logs | mitigate (HIGH) | Grep-gate on `logger.(info|debug).*prompt`; redact pipeline covers; `pino.formatters.log` redacts payloads |
| T-01-04-04 | Denial of Service | Frontier down → app freezes | mitigate (HIGH; LLM-05) | Transparent fallback to LOCAL; routing_log records `frontier-unavailable:<class>`; UI surfaces the actual route used |
| T-01-04-05 | Spoofing | Active provider switched silently | mitigate (LOW) | `model` column in routing_log records the exact model ID used; user-visible in the log panel |
| T-01-04-06 | Repudiation | Classifier decision not auditable | mitigate (HIGH; LLM-03) | `reason` column records the verbatim decision string; user-inspectable in routing-log panel |
| T-01-04-07 | Tampering | Reason string drift between code and DB (e.g., dev renames `pii-pattern-matched` and breaks downstream Phase 3 audit UI) | mitigate (MEDIUM) | Reason strings are part of the contract; pinned by acceptance grep on the exact literals; Phase 3 review will further formalize |
</threat_model>

<verification>
- All three `<automated>` commands pass on Windows 11
- Manual: with Ollama running and no frontier key configured, ask "Hello" in Diagnostics → answer appears, route=LOCAL, reason=`frontier-not-configured`, routing-log panel shows the new row
- Manual: configure an Anthropic key + set active provider, ask "What is 2+2?" with source=`generic` → answer appears, route=FRONTIER, reason=`generic-source-frontier-active`
- Manual: ask "Email me at foo@bar.com" with source=`generic` → answer appears, route=LOCAL, reason starts with `pii-pattern-matched:email` (LLM-01 satisfied)
- Manual: disconnect network OR clear the Anthropic key while keeping active provider set, ask a generic prompt → answer appears via LOCAL, reason=`frontier-unavailable:network` or `frontier-unavailable:auth` (LLM-05)
</verification>

<success_criteria>
Plan 04 completes Phase-1 success criterion #3 (routing decision logged with reason for every Ask). Combined with Plans 01/02/03, ALL five Phase-1 success criteria from ROADMAP.md are satisfied:
1. Working app window — Plan 01
2. Frontier API key in OS keychain (verifiable) — Plan 03
3. Routing decision logged with reason — Plan 04
4. Encrypted SQLCipher DB backed up + restored — Plan 02
5. Ollama-missing warning with install instructions — Plan 03
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation/01-04-SUMMARY.md` describing:
- Exact model IDs pinned for local + each frontier provider (verify against current vendor docs at execute time)
- Whether hello-Aria e2e ran or was skipped (Ollama presence)
- Sample routing-log rows from a real Ask Aria session (LOCAL + FRONTIER paths)
- Confirmation that the four LLM requirements (LLM-01, LLM-03, LLM-04, LLM-05) are each demonstrably satisfied with the reason-string used and a manual-test transcript
- Confirmation that the five ROADMAP Phase-1 success criteria are all green (table)
</output>
