# Architecture

Aria follows the standard Electron process model with a strict separation between main (Node.js), preload (context bridge), and renderer (React).

---

## Process Model

Aria runs in three processes:

**Main process** (`src/main/index.ts`) — Node.js. Owns all privileged operations: SQLCipher database access, LLM calls, OAuth flows, file I/O, background scheduling, and system tray. The renderer has no direct access to Node.js APIs or the database.

**Preload script** (`src/preload/index.ts`) — thin `contextBridge` layer. At startup it maps every entry in the shared `CHANNELS` registry to an `ipcRenderer.invoke()` call and exposes the result as `window.aria`. The renderer imports no Electron modules directly; it only uses the typed `window.aria` API surface. Two channels (`NAVIGATE`, `ENTITLEMENT_STATE_CHANGED`) use `ipcRenderer.on()` for push events and are wired with explicit unsubscribe functions.

**Renderer** (`src/renderer/`) — React 18 SPA. All calls to the main process go through `window.aria.<method>()`. No Node.js APIs, no direct database access.

```
Renderer (React 18)
    │  window.aria.<method>()
Preload (contextBridge — src/preload/index.ts)
    │  ipcRenderer.invoke(channel, ...args)
Main Process (Node.js — src/main/index.ts)
    ├── IPC handlers        (src/main/ipc/)
    ├── SQLCipher DB        (src/main/db/)
    ├── Provider adapters   (src/main/integrations/)
    ├── LLM router          (src/main/llm/)
    ├── Approval gate       (src/main/approvals/)
    └── Background scheduling
            src/main/briefing/schedule.ts
            src/main/learning/
            src/main/news/
            ...
```

---

## IPC Surface

The IPC layer is registered in `src/main/ipc/index.ts` at boot. Each sub-module registers its own channel handlers with `ipcMain.handle()`. Handler modules include:

`approvals.ts`, `ask.ts`, `background.ts`, `backup.ts`, `briefing.ts`, `calendar.ts`, `classify.ts`, `diagnostics.ts`, `drafting.ts`, `entitlement.ts`, `gmail.ts`, `gmail-send.ts`, `insights.ts`, `knowledge-folders.ts`, `learning.ts`, `microsoft.ts`, `news.ts`, `ollama.ts`, `provider-accounts.ts`, `rag.ts`, `recap.ts`, `scheduling.ts`, `tasks.ts`, `todoist.ts`, `transcripts.ts`, `triage.ts`, `updater.ts`, and others.

Channel strings are defined in `src/shared/ipc-contract.ts` as a `CHANNELS` const. The preload maps them to method names via `CHANNEL_METHODS`, so the renderer uses typed method calls rather than raw channel strings.

---

## Database and Migrations

Aria stores all data in a single SQLite database (`aria.db`) in the user data directory.

**Encryption:** The database uses SQLCipher (via `better-sqlite3-multiple-ciphers`), AES-256 whole-database encryption with ChaCha20 cipher. The encryption key is derived from the user's vault passphrase and stored in the OS keychain via Electron `safeStorage` (Keychain on macOS, DPAPI on Windows, libsecret on Linux). It is never written to disk as plaintext.

**Open sequence** (`src/main/db/connect.ts`): the `openDb()` function opens the database, applies the SQLCipher pragmas (`PRAGMA cipher`, `PRAGMA key`, `PRAGMA cipher_page_size`, `PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON`), then calls the migration runner. Any failure closes the handle and throws `DbOpenError`.

**Migrations** (`src/main/db/migrations/`): numbered SQL files (`001_init.sql`, `002_gmail.sql`, … up through the current highest migration). The migration runner (`runner.ts`) applies them sequentially on every boot. The runner is called from a single boot-time callsite, enforced by the `scripts/grep-migration-callsite.mjs` ratchet.

**Vector search:** `sqlite-vec` is loaded as an extension and lives in the same database file, enabling SQL joins between embeddings and structured metadata (used by the RAG pipeline in `src/main/rag/`).

---

## Provider Adapters

All external data integrations live under `src/main/integrations/`:

| Path | Scope |
|------|-------|
| `google/` | Gmail sync, Google Calendar sync and writeback — uses `googleapis` + `google-auth-library` (OAuth 2.0 loopback IP flow) |
| `microsoft/` | Outlook and Graph Calendar — uses `@azure/msal-node` (auth-code + PKCE) + `@microsoft/microsoft-graph-client` |
| `todoist/` | Todoist task sync |
| `registry.ts` | `ProviderRegistry` maps `accountId` to adapter instances; supports multiple accounts per provider |
| `sync-orchestrator.ts` | Coordinates polling schedules across all provider accounts via `p-queue` |
| `send.ts` | Unified email send path — see [Approval Chokepoint](#approval-chokepoint-assertapproved) |
| `write-event.ts` | Unified calendar write path — see [Approval Chokepoint](#approval-chokepoint-assertapproved) |

OAuth flows happen in the main process via a `BrowserWindow` that intercepts the loopback redirect. The renderer never participates in OAuth.

---

## Sensitivity Router and LLM Routing

All LLM calls are routed through `src/main/llm/router.ts`, which decides whether a prompt goes to a **local model** (Ollama) or a **frontier model** (Anthropic/OpenAI/Google).

**Classifier pipeline:**

1. `src/main/llm/classifier.ts` — fast regex prefilter for known PII patterns (email addresses, phone numbers, named entity heuristics). Runs synchronously, no model call.
2. `src/main/llm/sensitivityClassifier.ts` — when the regex prefilter is inconclusive, a two-stage Ollama `generateObject` call (with Zod schema) assigns a sensitivity level.

**Routing decision tree** (first match wins):

| Condition | Route |
|-----------|-------|
| No LLM provider configured | Throw `NoLlmProviderError` |
| Source tag unset | LOCAL (fail-closed) |
| Classifier flags PII | LOCAL (or FRONTIER if Ollama is unreachable) |
| Source is a user-data tag | LOCAL (same FRONTIER override) |
| Source is `generic` and frontier key present | FRONTIER |
| Else | LOCAL |

**PII-flagged content never reaches a frontier model** when Ollama is reachable.

**Models:**
- Local: Llama 3.1 8B or Qwen 2.5 7B via Ollama at `localhost:11434`
- Frontier: Vercel AI SDK (`ai` package) with `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`

All routing decisions are written to a `routing_log` table in the database (`src/main/llm/routingLog.ts`). LLM calls are serialized through a shared `p-queue` instance to prevent rate-limit storms.

`src/main/llm/ollamaProbe.ts` checks Ollama availability at startup. `src/main/llm/autoPickModel.ts` selects the best available local model if the user has not pinned one.

---

## Approval Chokepoint (assertApproved)

All outbound actions — email sends, calendar writes, task pushes — must pass through a single approval gate before executing.

**Gate implementation:** `src/main/approvals/gate.ts` exports `assertApproved(db, approvalId)`. It reads the approval row from the database and throws `ApprovalGateError` if:
- The row does not exist (`not-found`)
- The row state is not `'approved'` (`not-approved`)
- The content is high-severity or in a forced category (`financial`, `legal`, `hr`) and the approval path is not `'explicit'` (`forced-explicit-missing`)

**Enforced at write paths:**
- `src/main/integrations/send.ts` (email) — calls `assertApproved` before any Gmail API call
- `src/main/integrations/write-event.ts` (calendar) — calls `assertApproved` before any Graph/Calendar API call

**Static enforcement:** A grep ratchet in `scripts/` runs as part of `lint:guard` to verify that no code bypasses this gate by calling Gmail send methods directly. This means Aria cannot send an email or change a calendar event without an explicit user approval action recorded in the database.

Supporting modules in `src/main/approvals/`:
- `persist.ts` — reads/writes approval rows and the send log
- `state.ts` — approval state machine transitions
- `tier.ts` — severity tier resolution

---

## Background Scheduling

Aria runs several recurring background jobs:

| Scheduler location | Job |
|---|---|
| `src/main/briefing/schedule.ts` | Daily briefing generation |
| `src/main/integrations/sync-orchestrator.ts` | Provider polling (Gmail, Calendar, Todoist) |
| Per-module schedule files | Learning aggregation, news fetch, recap generation |

**Cron:** `node-cron` drives all schedules.

**Serialization:** All LLM calls are serialized through a shared `p-queue` instance, making cost predictable and preventing concurrent frontier API calls from hitting rate limits.

**Sleep/wake:** Electron's `powerMonitor` (registered in `src/main/lifecycle/powerMonitor.ts`) suspends cron jobs when the machine sleeps and queues a catch-up run on wake, preventing cron storms after a laptop wakes from overnight sleep.

**DB-null guard:** When the database is not yet unlocked (vault sealed), cron jobs silently skip and schedule a catch-up run on first unlock. This is the "entitlement pattern" enforced by the IPC registration order in `src/main/ipc/index.ts`.

---

## Background Activity and System Tray (Phase 12)

**Close-to-tray:** `src/main/background/window-decisions.ts` intercepts the window close event. If the `closeToTray` user preference is enabled, it hides the window instead of quitting. The `window-all-closed` handler in `src/main/index.ts` respects this decision.

**Tray:** `src/main/tray/`
- `icons.ts` — resolves platform-specific icon assets (PNG on macOS, ICO on Windows)
- `menu.ts` — builds the native context menu (Show, Generate Briefing Now, Settings, Quit)
- `notify.ts` — sends OS toast notifications (e.g., briefing-ready, action required)
- `index.ts` — creates and manages the `Tray` instance lifecycle

**Auto-launch:** `src/main/background/prefs.ts` mirrors the `autoLaunch` setting to the OS login item via Electron's `app.setLoginItemSettings()`.

**Single instance:** `src/main/single-instance.ts` acquires the single-instance lock at startup; a second launch focuses the existing window instead of opening a new one.

---

## Logging and Observability

**Logging:** `pino` with a rotating file transport (`pino-roll`). Log files live in the user data directory. PII fields are redacted before they reach pino via a `redactObject()` pass in `src/main/log/redact.ts`. The log file is designed to be user-attachable to bug reports.

**Crash reporting:** `@sentry/electron` with a `beforeSend` allowlist — crash stacks only, opt-in. No analytics, no usage telemetry.

**LLM routing traces:** Routing decisions are written to a local `routing_log` SQLite table (debug-only, never sent externally).

---

## Key Dependency Versions

| Package | Version in package.json |
|---------|------------------------|
| electron | 41.6.1 (pinned exact) |
| react / react-dom | ^18.3.0 |
| better-sqlite3-multiple-ciphers | ^12.0.0 |
| sqlite-vec | 0.1.9 |
| ai (Vercel AI SDK) | ^6.0.0 |
| @ai-sdk/anthropic / openai / google | ^3.0.0 |
| googleapis | ^144.0.0 |
| @azure/msal-node | ^3.8.10 |
| node-cron | ^4.0.0 |
| p-queue | ^9.0.0 |
| typescript | ^5.6.0 |
| vitest | ^4.0.0 |
| tailwindcss | ^3.4.0 |
