# Architecture Research

**Domain:** Aria - local-first desktop AI exec assistant
**Researched:** 2026-05-14
**Confidence:** MEDIUM-HIGH

**Note:** Shell choice (Electron vs Tauri) is resolved in STACK.md: **Electron** wins for solo-dev velocity. The patterns below apply identically to either shell.

## 1. Process / Runtime Model

### Recommended: Three-process model

```
Aria Desktop (Electron)
  - UI Process (Renderer / React) - chat, dashboard, approval queue
       | typed IPC
       v
  - Main Process (Node) - orchestrator, agents, integrations, SQLite, LLM router
       | HTTP localhost:11434
       v
  - Local LLM sidecar (Ollama daemon, separate OS process)

OS scheduler (launchd / Task Scheduler) -> optional headless runner for background sync when app closed
```

Why three processes:
- UI must stay responsive while heavy work runs (briefing assembly, RAG queries, sync)
- Local LLM crashes/OOMs must not crash the app - Ollama is out-of-process, restartable independently
- Main is single source of truth for data, decisions, approval state; UI is a view; LLM is a pure function

### Background tasks across app close / sleep

| Approach | Survives close? | Survives sleep? | Complexity |
|---|---|---|---|
| In-app cron (node-cron in Main) | No | No | Low |
| Autostart + minimize-to-tray | Yes | No (paused) | Medium |
| OS-level scheduled task | Yes | Wakes (macOS/Linux clean; Windows hardware-dependent) | High |

v1 recommendation: in-app cron + minimize-to-tray + autostart-at-login. Briefing fires when user wakes machine. OS-level scheduling deferred to v1.5.

For email: prefer push (Gmail Pub/Sub, MS Graph change notifications) over polling. BUT Pub/Sub on a NAT'd desktop client is a known concern - flag for a phase-specific spike. Fall back to 5-15 min polling while foregrounded.

## 2. Major Components

```
UI Layer (React) - Chat | Dashboard | Briefing | Approval Queue | Settings
        | typed IPC
Main Orchestrator
  Agent/Planner | Approval Queue | Scheduler (cron + event bus)
       v
  LLM Router (sensitivity classifier)
  local (Ollama)  <->  frontier API
       |
  RAG Layer | Local Store (SQLCipher) | Preference/Learning
       |
  Ingestion / Sync (change tokens, dedupe, normalize)
       |
  Integration Adapters - Gmail | Outlook | GCal | MS Cal | Asana | Todoist | News
```

### Component responsibilities

- **Integration adapters**: one per provider; pluggable fetchSince(token) / send(payload) / subscribe(webhook). Owns OAuth tokens (keychain) and API client config.
- **Ingestion / sync layer**: incremental fetch via change tokens (Gmail historyId, Graph deltaLink); normalize to canonical entities; dedupe. Owns sync cursors and retry state.
- **Local Store**: canonical entities (Message, Thread, Event, Contact, Task, Note, Briefing, ApprovalItem); SQLite + SQLCipher. Owns schema, migrations, transactions.
- **RAG Layer**: chunk + embed locally (nomic-embed-text via Ollama); hybrid BM25 + vector search; vector index in same SQLCipher DB via sqlite-vec.
- **LLM Router**: sensitivity classify -> local vs frontier; redact PII pre-frontier; timeouts/retries/model fallback. Owns routing rules, prompt templates, redaction maps.
- **Agent / Planner**: composes multi-step tasks - briefing, draft, scheduling, action-item extraction, weekly recap.
- **Approval Queue**: persisted outbound holding pen; survives restart; emits approve/reject events for learning.
- **Scheduler**: cron triggers + event bus for webhook-driven work.
- **Preference / Learning**: user voice samples, scheduling rules, tone; updated by approval feedback (edits/rejections).
- **UI Layer**: React, two surfaces (chat + dashboard); pure view; sends commands, subscribes to state.

### Critical boundary rules

- UI never talks to integrations directly - only Main via typed IPC.
- Agents never write to integrations directly - every outbound side effect goes through Approval Queue, even pre-approved classes. Non-bypassable.
- LLM Router is the only place that decides local vs frontier. Agents call route(payload, sensitivityHint) and are backend-agnostic.
- Local Store is the single source of truth. Integrations are caches.

## 3. Data Flow Patterns

### Pattern 1: Inbound email -> draft -> approval -> send

```
Gmail push notification
  -> Adapter.onWebhook enqueues sync
  -> Sync fetches since historyId
  -> Local Store inserts Message + Thread (encrypted), updates historyId
  -> Event bus: message.created
  -> Agent.triage classifies priority + intent (LOCAL model - has PII)
       low priority -> index only
       needs-reply -> Agent.draft
            -> LLM Router sensitivity check
                 contains PII/financial -> LOCAL
                 generic prose -> FRONTIER (with redaction)
            -> Draft generated using user voice profile
            -> Approval Queue.enqueue(ApprovalItem)
            -> UI surfaces, notifies
            -> User approves / edits / rejects
            -> on approve -> Adapter.gmail.send
            -> Local Store marks Message.sent
            -> Learning records "accepted as-is" or edit diff
```

Failure handling: LLM timeout -> mark draft failed, retry button. Send fails (auth expired) -> keep in queue, prompt re-auth. App crash mid-draft -> items in state "generating" re-enqueued on restart; nothing transitions to "sent" without an explicit recorded user action.

### Pattern 2: Daily briefing

```
Scheduler cron fires at user time (default 7:00 local)
  -> Agent.briefing
       -> Query Local Store: today events, overdue tasks, unread priority email
       -> Query RAG: "what is happening with top 3 active threads"
       -> Query News adapter (filtered by user interests)
       -> Compute insights: calendar load delta, response-time trend, recurring themes
       -> LLM Router assembles prose
            names+subjects present -> LOCAL preferred
            sufficiently redactable -> FRONTIER for better prose
       -> Local Store saves Briefing
       -> UI notifies + dashboard updates
       -> Optional feedback ("more like this", "skip section") -> Learning
```

### Pattern 3: Sensitivity routing decision

```
route(payload, hints):
  1. Hard rules (deterministic):
     - PII regex match (SSN, card, account#) -> LOCAL
     - Thread tagged sensitive by user -> LOCAL
     - No frontier API key configured -> LOCAL
     - Offline -> LOCAL
     - hints.forceLocal -> LOCAL
  2. Classifier (LOCAL 7B model, fast prompt):
     - "Does this contain personal/financial/medical info?"
     - yes/unsure -> LOCAL (fail safe)
     - no -> continue
  3. Redaction pass (always before frontier):
     - Names -> [PERSON_1], emails -> [EMAIL_1], etc.
     - Per-request mapping to re-hydrate response
     - If redaction destroys meaning -> LOCAL
  4. Frontier call with redacted payload
  5. Re-hydrate response from mapping
```

This is the single most trust-critical component. Every routing decision must be locally logged with a reason; users must be able to inspect "why did this go to OpenAI?" for any past interaction.

## 4. Suggested Build Order

### Tier 0 - Foundation (nothing works without these)
1. Local Store + schema + migrations (SQLite + SQLCipher)
2. Secrets management (OS keychain via safeStorage)
3. IPC contract between UI and Main (typed commands + subscriptions). Painful to refactor later.
4. LLM Router skeleton with Ollama + one frontier provider (Anthropic). Hard-rules classifier initially.

### Tier 1 - First vertical slice
5. Gmail adapter read-only (Gmail before Outlook; friendlier quotas/docs)
6. Sync layer with Gmail change tokens
7. Briefing agent MVP - today calendar + unread priorities. No RAG, no insights yet. Proves data flow end-to-end.
8. UI: chat + briefing view + settings

At this point Aria shows a useful daily briefing. Ship to design partner.

### Tier 2 - Trust-critical features
9. Approval Queue as first-class persisted entity
10. Email draft agent - generate + queue, never auto-send
11. Sensitivity classifier model + redaction layer - upgrade Router from hard-rules to classifier-driven
12. Google Calendar adapter + smart-scheduling agent (read -> propose-with-approval)

### Tier 3 - Compound value
13. RAG layer - chunk + embed + hybrid search. AFTER MVP integrations because chunking strategy is data-shape-driven.
14. Outlook + MS Calendar adapters (parity for non-Google users)
15. Meeting transcript ingestion + action-item extraction
16. Task adapters (Todoist first - simplest API; Asana/Jira later)
17. Weekly recap agent
18. Preference / learning loop wired into approval feedback

### Rationale
- Local Store before everything - every component reads/writes through it
- LLM Router before any agent - agents must not embed routing logic
- One integration end-to-end before breadth - adapter interface only solidifies after pain
- Approval Queue before drafting - trust posture requires impossibility of sending without it
- RAG after MVP integrations - chunking/embedding strategy must be informed by real content shape

## 5. Cross-Cutting Concerns

### Encryption at rest
SQLCipher whole-DB + OS keychain master key. Simpler than field-level; covers messages, drafts, embeddings, preferences. Put vector index inside same SQLCipher DB via sqlite-vec - one key, one file. Encrypt attachment blobs at file level with same key.

### Secrets management
- OAuth refresh tokens -> OS keychain (one entry per provider per account)
- Frontier API keys -> OS keychain
- DB encryption key -> OS keychain
- Per-session access tokens -> in-memory only
- Never write any to logs, config, or DB

### Telemetry
Opt-in, off by default. Aggregate counters only (sessions, briefings, accept/reject ratio). Never content, names, subjects. Batched POST; drop on fail; never block.

### Logging
Two levels: info (user-facing, redacted) and debug (developer detail, opt-in, local only, never uploaded). PII filter at the log sink. Rotate locally, cap ~50MB. Crash reports local-first; opt-in upload with content preview before send.

### Update strategy
Electron auto-updater (electron-updater) with signed releases. Forward-only migrations shipped with schema change. Pre-migration backup of SQLCipher file on first launch after update. Updater never touches user data directory.

## 6. Failure Modes

| Failure | Architectural response |
|---|---|
| Frontier API down/rate-limited | Router degrades to LOCAL with visible "operating locally" indicator. Briefing/drafting still work, simpler prose. |
| Local model too slow (CPU only) | Router promotes non-sensitive requests to frontier when available. Sensitive ones show cancellable "thinking...". Settings exposes detected hardware capability. |
| User offline | Sync queues outbound calls (approved sends, calendar changes). Router forces LOCAL. UI offline banner. |
| Ollama not installed | Onboarding prompts install. Sensitive features disabled with explanation - never silently routed to frontier. |
| App crash mid-draft | ApprovalItem states: pending -> generating -> ready -> approved -> sent. On startup, generating items re-enqueued; ready survives untouched. No transition to sent without explicit recorded user action. |
| OAuth token expired | Adapter returns auth_required; that provider sync pauses; UI prompts re-auth; other providers continue. |
| Schema migration fails | Updater restores pre-migration DB backup, shows recovery dialog. |
| Vector store corruption | Rebuild from canonical Local Store; embeddings are derived cache. UI shows "rebuilding index". |
| User revokes frontier API key mid-session | Router detects 401, falls back to local, surfaces notification. No partial state held by agent. |

Unifying principle: every external dependency can fail; Aria continues to be useful in reduced mode without ever auto-sending or auto-modifying without approval.

## Anti-Patterns to Avoid

1. Agents calling integrations directly - bypasses Approval Queue; one forgotten guard = surprise send. Every outbound goes through ApprovalQueue.enqueue.
2. Embedding routing logic inside agents - each agent reinvents PII detection. Centralized llmRouter.complete(prompt, hints) only.
3. Treating integrations as source of truth - slow, quota-hits, breaks offline. Local Store is canonical.
4. Plaintext config files for tokens - leaked dotfile = leaked inbox. Keychain for all secrets.
5. RAG on raw provider payloads - embeddings drift, schema changes break index. Normalize to canonical entities first, then chunk + embed.

## Open Questions

- Gmail Pub/Sub viability for desktop client behind NAT (spike in email-push phase)
- Empirical PII-classifier accuracy on real user mail (only measurable with design partner data)
- RAG chunking strategy for email threads (per-message vs per-thread vs sliding window) - decide in RAG phase
- Light preference learning without fine-tuning - approach for learning-loop phase
