# Phase 21: Digest + Briefing Integration - Research

**Researched:** 2026-06-10
**Domain:** WhatsApp local-model digest cron + briefing read-path enrichment (Electron/Node, Vercel AI SDK 5, better-sqlite3, Ollama)
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** Generate digest as constrained delimited markdown via `generateText` (NOT `generateObject`). Fixed headers `### KEY POINTS`, `### DECISIONS`, `### OPEN QUESTIONS`, `### MENTIONS`. Store verbatim in `whatsapp_group_digest.summary_text`. Renderer splits on known headers.

**D-02:** Pin `temperature: 0` on the digest call.

**D-03 (CRITICAL):** `whatsapp_message` has NO `mentionedJid` column. `ingest.ts` writes `sender_jid` as literal `'self'` for own messages and as the **group jid** (not participant jid) for incoming. JID-based mention attribution is impossible. `### MENTIONS` block must use heuristic body-text matching: pass user display name (from `profile.json`) and local-part of `creds.me.id` into the prompt.

**D-04:** Window = `windowStart = max(lastDigestWatermark, now − N days)`, N ≈ 2–3 days, ≤ 30-day retention floor.

**D-05:** Compute watermark from `MAX(sent_at)` of already-digested messages (or explicit stored window-end), NOT by comparing against `generated_at` (cross-clock hazard).

**D-06:** Idempotency via shipped `UNIQUE(jid, date)` constraint.

**D-07:** Layered catch-up:
  1. `pendingCatchup` channel `'whatsapp-digest'` (mirror `retention.ts` seal-guard pattern)
  2. powerMonitor-resume missed-tick check (per-day guard + `UNIQUE(jid,date)` absorbs overlap)
  3. Non-blocking briefing-read fallback (async/best-effort, never block 07:00 briefing render)

**D-08:** Discriminated union on `BriefingPayload`:
```ts
whatsApp?:
  | { state: 'ready'; groups: WhatsAppGroupSummaryDto[]; connection?: 'degraded' | 'needs-auth' }
  | { state: 'unavailable'; reason: 'model-offline'; connection?: 'degraded' | 'needs-auth' };
// undefined => omit entirely
```

**D-09:** Per-group inner sub-state (`summarized` / `no-activity` / `failed`) inside `ready` arm.

**D-10 (state matrix):**
- Not linked → omit (`undefined`)
- Linked, zero tracked groups → omit
- Sub-threshold activity (< 3 messages) → omit that group's sub-section; if all below → omit whole section
- Digest failed / model offline → render header + italic note + Generate-now affordance
- Connection degraded / needs-relink → render quiet inline line pointing to Settings

**D-11:** Attach `row.whatsApp` via read-path enrichment in `BRIEFING_TODAY` handler (`src/main/ipc/briefing.ts`). DO NOT add a `gatherWhatsApp` gatherer inside `runBriefing`. This enforces WA-09 frontier-isolation by construction.

**D-12:** Digest-generating cron file MUST live under `src/main/whatsapp/` (e.g. `digest-cron.ts`). Bootstrap in `src/main/index.ts` exactly as `startWhatsAppRetention`. Do NOT mirror `src/main/insights/aggregate.ts` placement (that lives outside the ratchet and is frontier-capable).

**D-13:** Read-only enrichment helper (pure indexed SELECT, no model) may live in `src/main/ipc/briefing.ts`. Annotate `// read-only, no model`.

### Claude's Discretion

- Exact digest prompt text (system + per-group user prompt) — research provides a verified skeleton
- Window cap N (2–3 days, ≤ 30) and min-activity threshold (≈ 3 messages)
- Whether to show "no groups tracked" hint vs pure omit for linked-but-empty state
- Per-group message cap / token budget, group ordering in section
- `WhatsAppGroupSummaryDto` DTO field names and delimiter-splitter helper details

### Deferred Ideas (OUT OF SCOPE)

- Ingest fix to persist participant jid + `mentionedJid` (Phase 22 consideration)
- Action-item / meeting-proposal / RAG extraction consumers (Phase 22, WA-F1/F2/F3)
- Per-group / configurable retention or digest cadence
- Just-in-time digest blocking the briefing (explicitly rejected)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WA-08 | Daily briefing includes a WhatsApp section summarizing each tracked group's activity since the last digest, exec-framed: key points, decisions, open questions, mentions of the user | D-01 through D-10 + prompt skeleton in Code Examples |
| WA-09 | WhatsApp group content summarized using local model only, never sent to a frontier API (enforced by a static ratchet, not convention) | D-12, SC3 ratchet verified GREEN, `getLocalModel()` signature verified |
| WA-10 | If local model unavailable, briefing still generates and WhatsApp section degrades gracefully (clear "unavailable" note) rather than failing the whole briefing | D-07.3 + D-08 + D-10 state matrix + `generate.ts` degraded-payload pattern |
</phase_requirements>

---

## Summary

Phase 21 slots two new behaviors into an already-mature codebase. The 05:00 digest cron (`src/main/whatsapp/digest-cron.ts`) is a near-literal copy of `retention.ts` (same CRON_KEY pattern, same seal-guard, same pendingCatchup shape) with the retention's `runSweep` replaced by a per-group `generateText` loop. The 07:00 briefing enrichment in `src/main/ipc/briefing.ts` is a near-literal copy of the `thisWeekInsights` try/catch block (lines 223–244), with a `readWhatsAppDigests(db, date)` helper returning the discriminated-union payload instead.

The primary technical risk is local-model prompt design: Llama 3.1 8B at temperature 0 on a delimited-markdown format is well-proven across other Aria usages, but section consistency and heuristic `### MENTIONS` accuracy will require UAT. All architecture decisions are already locked; the planner's job is sequencing tasks to satisfy the D-07 layered catch-up (pendingCatchup first, powerMonitor-resume second, briefing-read fallback third) and the D-10 state matrix in the correct order.

The no-frontier ratchet (SC3) is already shipped and green — placing `digest-cron.ts` under `src/main/whatsapp/` is the only requirement to keep it green. Zero schema migrations are needed.

**Primary recommendation:** Mirror `retention.ts` for the cron file; mirror the `thisWeekInsights` try/catch block for the briefing enrichment. Both templates exist verbatim in the live codebase and have proven track records.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Digest generation (LLM call) | Backend / main process (`src/main/whatsapp/digest-cron.ts`) | — | Local model only; runs headlessly at 05:00 before the app may be foregrounded |
| Digest scheduling + catch-up | Backend / main process (`src/main/index.ts` + lifecycle) | — | Cron must run even if renderer is not mounted; catch-up tied to DB-unlock lifecycle |
| Briefing enrichment (read) | Backend / main process (`src/main/ipc/briefing.ts`) | — | Attached at `BRIEFING_TODAY` IPC handler; renderer-opaque |
| Discriminated-union rendering | Renderer (`BriefingScreen.tsx`) | — | Pure switch over `payload.whatsApp`; stateless relative to main |
| Generate-now retry affordance | Renderer → main IPC | — | Renderer triggers; main executes digest on demand |
| `BriefingPayload.whatsApp` contract | Shared (`src/shared/ipc-contract.ts`) | — | Both tiers read the same type definition |

---

## Codebase Verification Report

This section provides ground-truth verification of every CONTEXT.md cite. Confidence for all items: **HIGH** (VERIFIED against live source).

### 1. `src/main/ipc/briefing.ts` — `BRIEFING_TODAY` handler

**VERIFIED.** File exists.

- Handler: `ipcMain.handle(CHANNELS.BRIEFING_TODAY, async (_e, payload?) => {...})` at **line 215**
- `thisWeekInsights` enrichment block: **lines 223–244** (matches CONTEXT cite exactly)
- Pattern to mirror:
  ```ts
  // lines 223-244 — copy this outer try/catch shape for row.whatsApp
  try {
    const weekYmd = weekStartYmdFor(new Date(), tz);
    const ins = readLatestInsights(db, weekYmd);
    if (ins.state === 'unlocked') {
      row.thisWeekInsights = { state: 'unlocked', rows: ins.rows.map(...) };
    } else if (ins.state === 'locked') {
      row.thisWeekInsights = { state: 'locked', ... };
    } // 'empty-unlocked' → leave undefined
  } catch (err) {
    logger.warn({ scope: 'briefing-today-insights', err: (err as Error).message }, '...');
  }
  return row;
  ```
- `readLatestInsights` is imported from `'./insights'` (line 41). The equivalent `readWhatsAppDigests(db, date)` helper should follow the same module-local pattern.
- CONTEXT claim verified: attach `row.whatsApp` exactly here, after the insights block, before `return row`.

### 2. `src/main/whatsapp/retention.ts` — cron skeleton template

**VERIFIED.** File exists. The exact shape is:

```
CRON_KEY const (line 90): 'whatsapp-retention-sweep'
WhatsAppRetentionDeps interface (lines 92-105): db, logger, cron?, scheduler, dbHolder
WhatsAppRetentionHandle interface (lines 107-111): stop(), runNow()
runSweep(db, logger) function (lines 117-130): the unit of work
startWhatsAppRetention(deps) factory (lines 140-170): schedules cron, seal-guard, cronRegistry
```

The seal-guard block is at **lines 144–153** (CONTEXT cite accurate):
```ts
const task: ScheduledTask = nodeCron.schedule(cronExpr, () => {
  const dbRef = deps.dbHolder?.db;
  if (deps.dbHolder && !dbRef) {
    pendingCatchup.add(CRON_KEY);  // ← line 148
    trayBus.setBadge();            // ← line 149
    return;
  }
  runSweep(db, logger);
});
```

Digest cron mirrors this exactly, replacing `CRON_KEY = 'whatsapp-retention-sweep'` with `'whatsapp-digest'` and replacing `runSweep` with the per-group digest loop.

Cron time: `'30 3 * * *'` is taken by retention. Session recycle is `'0 3 * * *'`. Entitlement refresh is `'0 3 * * *'` (same slot as recycle — both 03:00). Knowledge sweep is `'0 3 * * *'`. Insights is `'0 2 * * *'`. Briefing default is `'0 7 * * *'`. Research service is `'0 6 * * *'`. **The 05:00 slot (`'0 5 * * *'`) is free.** [VERIFIED: grep of all `DEFAULT_EXPR` / cron literal patterns across `src/main/`]

### 3. `src/main/lifecycle/pendingCatchup.ts` — `CatchupChannel` union

**VERIFIED.** File exists. Current union (lines 12–21):
```ts
export type CatchupChannel =
  | 'briefing'
  | 'insights'
  | 'recap'
  | 'learning'
  | 'entitlement'
  | 'gmail-sync'
  | 'calendar-sync'
  | 'knowledge-folder-sweep'
  | 'whatsapp-retention-sweep';  // ← added in Phase 20
```

**Phase 21 adds:** `'whatsapp-digest'` to this union. `whatsapp-retention-sweep` is already present (Phase 20 shipped it).

`runChannelOnce` in `src/main/index.ts` (lines 869–882) is currently a **no-op stub** for all channels:
```ts
async function runChannelOnce(chan, _db, logger): Promise<void> {
  logger.info({ scope: 'catchup', channel: chan }, 'catchup run starting');
  await Promise.resolve();
  logger.info({ scope: 'catchup', channel: chan }, 'catchup run complete');
}
```

Phase 21 must add a real `case 'whatsapp-digest':` branch here that calls the digest cron's `runNow()`-equivalent. Without this, the unlock drain logs "catchup run starting/complete" but does nothing.

`fireOnUnlock` / drain is registered at `src/main/index.ts` lines 741–766 via `registerOnUnlock(async (db) => { const channels = pendingCatchup.drain(); ... })`. The `onUnlock.ts` module uses a callbacks array — no switch, no channel awareness. The `runChannelOnce` function IS the per-channel dispatch.

### 4. `src/main/llm/providers.ts` — `getLocalModel()` signature

**VERIFIED.** File exists.

```ts
export const DEFAULT_LOCAL_MODEL = 'llama3.1:8b-instruct-q4_K_M';

export interface LocalModelOptions {
  modelId?: string;
  baseURL?: string;
}

export function getLocalModel(opts: LocalModelOptions = {}): ModelLike {
  // ... createOllama({ baseURL }) → ollama(modelId) → cached model
  // throws OllamaUnavailableError if createOllama/cache fails
}
```

**CRITICAL behavior:** `getLocalModel()` does NOT verify Ollama is running. It only constructs the provider client and model object. The `OllamaUnavailableError` fires during construction only if `createOllama` itself throws. The actual "Ollama is down" failure happens at call time in `generateText(...)` when the HTTP request to `http://127.0.0.1:11434/api` fails. The catch block in `digest-cron.ts` must catch the `generateText` error, not just `getLocalModel()`.

`getFrontierModel` is an `async` function requiring a `ProviderId`. `getLocalModel` is **synchronous**. The digest cron calls `getLocalModel()` synchronously then `await generateText(...)`.

Package: `ollama-ai-provider-v2` (NOT `ollama-ai-provider` — the legacy package is incompatible with AI SDK 6). [VERIFIED: line 19 of providers.ts]

### 5. `src/main/db/migrations/138_whatsapp.sql` — shipped schema

**VERIFIED.** File exists. Shipped shape confirmed:

**`whatsapp_group_digest`:**
```sql
CREATE TABLE whatsapp_group_digest (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  jid          TEXT NOT NULL,
  date         TEXT NOT NULL,
  summary_text TEXT,           -- nullable (NULL when generation failed)
  generated_at INTEGER,        -- nullable (unixepoch, written on success)
  model_id     TEXT,           -- nullable (model that generated)
  UNIQUE (jid, date),
  FOREIGN KEY (jid) REFERENCES whatsapp_group(jid) ON DELETE CASCADE
);
```

**`whatsapp_message`:**
```sql
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  jid         TEXT NOT NULL,
  sender_jid  TEXT NOT NULL,
  wa_id       TEXT NOT NULL,
  sent_at     INTEGER NOT NULL,   -- declared INTEGER (SQLite type affinity)
  body_text   TEXT NOT NULL,
  ingested_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (jid, wa_id),
```

**IMPORTANT DISCREPANCY TO KNOW:** The migration declares `sent_at INTEGER NOT NULL`, but `ingest.ts` writes ISO 8601 strings (`new Date(secs * 1000).toISOString()`) and `retention.ts` compares against ISO 8601 strings (`new Date(...).toISOString()`). SQLite type affinity stores the ISO string as TEXT in an INTEGER-affinity column without error; comparisons work correctly because ISO 8601 strings sort lexicographically. The digest window query must also use ISO 8601 strings (or `unixepoch()` conversions) consistently — mixing unix integers with ISO strings in the same comparison would silently fail.

**`whatsapp_group`:**
```sql
  jid           TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL DEFAULT '',
  tracked       INTEGER NOT NULL DEFAULT 0 CHECK (tracked IN (0, 1)),
```

`provider_account.status` CHECK: `('ok','degraded','needs-auth','disconnected')`. No new migration needed. [VERIFIED]

### 6. `src/main/whatsapp/ingest.ts` — `sender_jid` write behavior

**VERIFIED.** File exists. Confirmed D-03 behavior at line 166:
```ts
const senderJid = (msg.key.fromMe ? 'self' : jid) || jid;
```

- `fromMe === true` → `sender_jid = 'self'`
- `fromMe === false/null` → `sender_jid = jid` (the **group** JID, e.g. `120363...@g.us`, NOT the participant's individual JID)

No `mentionedJid` column exists anywhere in the ingest pipeline. The D-03 heuristic-mentions constraint is fully confirmed. There is no way to recover individual sender attribution from existing rows.

### 7. `src/shared/ipc-contract.ts` — `BriefingPayload` and WhatsApp status enum

**VERIFIED.** File exists.

`BriefingPayload` type (lines ~530–557): `thisWeekInsights?` is at **lines 555–557** (CONTEXT cite accurate). The `whatsApp?` field is added immediately after the `thisWeekInsights?` block.

WhatsApp `provider_account` status enum: confirmed at **lines 1743–1747** in `WhatsAppStatusDto`:
```ts
export const WhatsAppStatusDto = _z_wa.object({
  status: _z_wa.enum(['ok', 'degraded', 'needs-auth', 'disconnected']),
  ...
});
```

This is the `WhatsAppStatusDto` for the WHATSAPP_STATUS IPC channel. The `provider_account.status` column in the database uses the same enum values (confirmed in migration 138 CHECK constraint). The enrichment reads `provider_account.status` directly from the DB, not via IPC.

### 8. `src/renderer/features/briefing/BriefingScreen.tsx` — render switch

**VERIFIED.** File exists. `thisWeekInsights` render is at **lines 661–683** (matches CONTEXT cite). The pattern:
```tsx
{payload.thisWeekInsights?.state === 'locked' && (...)}
{payload.thisWeekInsights?.state === 'unlocked' && payload.thisWeekInsights.rows.length > 0 && (...)}
```

`InsightsSection.spec.tsx` does NOT exist as a separate file. The relevant pattern is the **`BriefingScreen.spec.tsx`** in `tests/unit/renderer/features/briefing/` (confirmed exists). It uses `makePayload(over: Partial<BriefingPayload> = {})` to stub payloads and passes them to `installAria(initial)`. This is the exact pattern to copy for WhatsApp section tests.

`GenerateNowAffordance.tsx` exists at `src/renderer/features/briefing/GenerateNowAffordance.tsx`. It uses `window.aria.briefingGenerateNow()`. The WhatsApp retry affordance wraps a different IPC call (a new `WHATSAPP_GENERATE_DIGEST_NOW` or equivalent) — it must NOT call `briefingGenerateNow` (that regenerates the entire briefing).

### 9. `src/main/briefing/generate.ts` — frontier `generateObject` engine

**VERIFIED.** File exists.

- Uses `generateObject` from `'ai'` (AI SDK 6), line 37.
- `BriefingSchema` is a Zod schema (lines 80–115).
- `runBriefing` function (line 351) accepts `RunBriefingDeps` — no WhatsApp gatherer anywhere in the file. [VERIFIED: no `whatsapp` or `WA` references in generate.ts]
- Degraded-payload pattern (lines 544–574): try/catch around model factory → `degradedPayload({...})` → always returns a `BriefingPayload`, never throws.
- **Confirmed:** DO NOT add a WhatsApp gatherer here. WhatsApp content must NOT touch the `BriefingSchema` Zod structure or the `generateObject` call.

### 10. `src/main/insights/aggregate.ts` — cautionary precedent

**VERIFIED.** File exists at `src/main/insights/aggregate.ts`.

- Imports `getFrontierModel` indirectly via `LLMRouter` (uses `router.classify()` + model factory in `insightProse`).
- Lives **outside** `src/main/whatsapp/` → outside the no-frontier ratchet scope.
- Uses `generateObject` from `'ai'` in `prose.ts` (its sub-module).
- Uses `p-queue` with `concurrency: 1` (line 57 of aggregate.ts).

**Confirmed:** The digest cron must NOT mirror `aggregate.ts` directory placement. `src/main/whatsapp/digest-cron.ts` is the required location. [VERIFIED]

### 11. `src/main/index.ts` — bootstrap and `runChannelOnce` switch

**VERIFIED.** File exists.

`startWhatsAppRetention` is imported at line 82 and called at lines 618–623 inside the `bootPoll` setTimeout post-unlock block. The digest cron bootstrap goes in the same block, after the retention call:

```ts
// Existing (lines 618-623):
startWhatsAppRetention({ db: waDb, logger, scheduler, dbHolder });

// Phase 21 adds immediately after:
startWhatsAppDigest({ db: waDb, logger, scheduler, dbHolder });
```

`runChannelOnce` switch (lines 869–882): currently a **no-op for all channels**. Phase 21 adds:
```ts
case 'whatsapp-digest':
  await digestCronHandle.runNow();
  break;
```

This requires `digestCronHandle` to be accessible in the `runChannelOnce` closure. The handle is returned by `startWhatsAppDigest()` — it must be stored in a module-scoped variable (same pattern as `whatsAppManager`).

**powerMonitor-resume missed-tick:** `registerLifecycleCallbacks` exists at `src/main/lifecycle/powerMonitor.ts`. It accepts `{ onSuspend?, onResume? }`. The resume handler checks `MAX(date) < today` against `whatsapp_group_digest` and calls `digestCronHandle.runNow()` if stale. Protected by the same per-day guard as `UNIQUE(jid,date)`.

---

## Standard Stack

### Core (all VERIFIED against live codebase)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ai` (Vercel AI SDK 6) | 5.x (project uses AI SDK 6 internally despite package name) | `generateText` for digest | Already used in `ask.ts`, `answer-service.ts`; `generateText` is the exact function for free-text generation |
| `ollama-ai-provider-v2` | latest (pinned in project) | Ollama provider for `getLocalModel()` | MUST use this, NOT `ollama-ai-provider` — confirmed in providers.ts line 19 |
| `better-sqlite3-multiple-ciphers` | 11.x | All DB reads/writes | Project standard for SQLCipher encrypted DB |
| `node-cron` | 3.x | Cron scheduling | Used by all existing cron files (`retention.ts`, `schedule.ts`) |
| `p-queue` | 8.x | Serialize per-group LLM calls | Project standard for LLM call serialization; prevents concurrent Ollama requests |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pino` | 9.x | Structured logging | Logger typed as `Pick<Logger, 'info' \| 'warn' \| 'debug' \| 'error'>` in all deps interfaces |

### No New Dependencies

This phase introduces zero new npm packages. Every required library is already in `package.json`. [VERIFIED: all imports trace to already-used packages]

---

## Architecture Patterns

### System Architecture Diagram

```
05:00 cron tick
       │
       ▼
digest-cron.ts::startWhatsAppDigest
       │ DB sealed? ──► pendingCatchup.add('whatsapp-digest') + setBadge
       │
       ▼
Per tracked group (p-queue concurrency:1):
  SELECT messages WHERE jid=? AND sent_at >= windowStart ORDER BY sent_at
  │ count < MIN_ACTIVITY? ──► skip (write no row — omit sub-section)
  │
  ▼
generateText(getLocalModel(), { system, prompt, temperature:0 })
  │ Ollama down? ──► catch error, write digest row with summary_text=NULL
  │
  ▼
INSERT OR REPLACE INTO whatsapp_group_digest (jid, date, summary_text, generated_at, model_id)
[UNIQUE(jid,date) ensures idempotency]

                                    powerMonitor 'resume' event
                                           │ MAX(digest.date) < today? ──► runNow()
                                           └───────────────────────────────┘
07:00 BRIEFING_TODAY IPC
       │
       ▼
readWhatsAppDigests(db, date)  // pure SELECT, no model — annotated "// read-only, no model"
       │
       ├─ no provider_account row (provider_key='whatsapp') ──► undefined (omit)
       ├─ zero tracked groups ──────────────────────────────► undefined (omit)
       ├─ all groups sub-threshold / skipped ────────────────► undefined (omit)
       ├─ some rows NULL summary_text / no rows today ────────► { state:'unavailable', reason:'model-offline', connection? }
       └─ good rows ────────────────────────────────────────► { state:'ready', groups:[...], connection? }
             │
             ▼
  row.whatsApp = result  (inside BRIEFING_TODAY try/catch, after thisWeekInsights block)
             │
             ▼
BriefingScreen.tsx: switch over payload.whatsApp
  │ undefined ──────────────────────────────────────────────► (section not rendered)
  │ state:'unavailable' ────────────────────────────────────► header + italic note + DigestGenerateNow button
  └─ state:'ready' ────────────────────────────────────────► per-group sub-sections (summarized/no-activity/failed)

Briefing-read fallback (D-07.3):
  If no digest rows exist for today when BRIEFING_TODAY fires, trigger digest async
  (fire-and-forget, never await, never propagate errors into briefing response)
```

### Recommended Project Structure (additions only)

```
src/
├── main/
│   └── whatsapp/
│       ├── digest-cron.ts     # NEW — 05:00 cron; getLocalModel(); under ratchet
│       ├── retention.ts       # existing — template to mirror
│       ├── ingest.ts          # existing — D-03 confirmed here
│       └── session-manager.ts # existing
│   └── ipc/
│       └── briefing.ts        # existing — add readWhatsAppDigests helper + row.whatsApp enrichment
└── shared/
    └── ipc-contract.ts        # existing — add BriefingPayload.whatsApp + WhatsAppGroupSummaryDto
src/renderer/features/briefing/
    └── BriefingScreen.tsx      # existing — add whatsApp section render switch
tests/unit/
    ├── main/whatsapp/
    │   ├── no-frontier.ratchet.spec.ts  # existing — stays GREEN by construction
    │   └── digest-cron.spec.ts          # NEW
    ├── main/ipc/
    │   └── briefing-whatsapp-enrichment.spec.ts  # NEW (or extend briefing-regenerate.spec.ts)
    └── renderer/features/briefing/
        └── BriefingScreen.spec.tsx      # existing — add whatsApp state matrix cases
```

### Pattern 1: Cron File Shape (mirror `retention.ts`)

```ts
// Source: src/main/whatsapp/retention.ts (VERIFIED)
import { pendingCatchup } from '../lifecycle/pendingCatchup';
import { trayBus } from '../tray/index';

const CRON_KEY = 'whatsapp-digest';  // must match CatchupChannel union value

export interface WhatsAppDigestDeps {
  db: Db;
  logger: Pick<Logger, 'info' | 'warn' | 'debug' | 'error'>;
  cron?: string;           // default: '0 5 * * *'
  scheduler: SchedulerHandle | null;
  dbHolder: Pick<DbHolder, 'db'> | null;
  // Test seam for LLM
  generateTextFn?: typeof generateText;
  getLocalModelFn?: typeof getLocalModel;
}

export interface WhatsAppDigestHandle {
  stop(): void;
  runNow(): Promise<void>;  // async (unlike retention's sync runNow)
}

export function startWhatsAppDigest(deps: WhatsAppDigestDeps): WhatsAppDigestHandle {
  const cronExpr = deps.cron ?? '0 5 * * *';
  const task = nodeCron.schedule(cronExpr, () => {
    const dbRef = deps.dbHolder?.db;
    if (deps.dbHolder && !dbRef) {
      pendingCatchup.add(CRON_KEY);
      trayBus.setBadge();
      return;
    }
    // Fire-and-forget; errors logged inside runDigest
    void runDigest(deps);
  });
  if (deps.scheduler) deps.scheduler.cronRegistry.set(CRON_KEY, task);
  return {
    stop() {
      task.stop();
      if (deps.scheduler) deps.scheduler.cronRegistry.delete(CRON_KEY);
    },
    runNow() { return runDigest(deps); },
  };
}
```

### Pattern 2: `thisWeekInsights` enrichment seam to mirror (in `briefing.ts`)

```ts
// Source: src/main/ipc/briefing.ts lines 223-244 (VERIFIED)
// Add AFTER the thisWeekInsights try/catch block, BEFORE `return row`:
try {
  const wa = readWhatsAppDigests(db, date, logger);
  if (wa !== undefined) row.whatsApp = wa;
} catch (err) {
  logger.warn(
    { scope: 'briefing-today-whatsapp', err: (err as Error).message },
    'failed to enrich briefing with whatsapp digests',
  );
}
return row;
```

### Pattern 3: `generateText` call with injectable test seam (mirror `ask.ts`)

```ts
// Source: src/main/ipc/ask.ts lines 64-66, 95 (VERIFIED)
// The digest uses generateText (not generateObject) with temperature:0
const gen = deps.generateTextFn ?? generateText;
const localModel = (deps.getLocalModelFn ?? getLocalModel)();
try {
  const { text } = await gen({
    model: localModel as Parameters<typeof gen>[0]['model'],
    system: DIGEST_SYSTEM_PROMPT,
    prompt: buildGroupPrompt(messages, userDisplayName, meJidLocalPart),
    temperature: 0,
  });
  // text is the delimited markdown
} catch (err) {
  // Ollama down → write row with summary_text = NULL
}
```

### Pattern 4: `readWhatsAppDigests` helper (pure SELECT, no model)

```ts
// // read-only, no model
function readWhatsAppDigests(
  db: Db,
  date: string,
  logger: Pick<Logger, 'warn'>,
): BriefingPayload['whatsApp'] {
  // 1. Check provider_account exists for whatsapp
  const account = db.prepare(
    `SELECT status FROM provider_account WHERE provider_key = 'whatsapp' LIMIT 1`
  ).get() as { status: string } | undefined;
  if (!account) return undefined;  // D-10: not linked → omit

  // 2. Get tracked groups
  const tracked = db.prepare(
    `SELECT jid, display_name FROM whatsapp_group WHERE tracked = 1`
  ).all() as Array<{ jid: string; display_name: string }>;
  if (tracked.length === 0) return undefined;  // D-10: zero tracked → omit

  // 3. Get digest rows for date
  const digests = db.prepare(
    `SELECT jid, summary_text FROM whatsapp_group_digest WHERE date = ?`
  ).all(date) as Array<{ jid: string; summary_text: string | null }>;
  const digestMap = new Map(digests.map(r => [r.jid, r.summary_text]));

  // 4. Build per-group sub-state
  const groups: WhatsAppGroupSummaryDto[] = tracked.map(g => {
    if (!digestMap.has(g.jid)) {
      return { jid: g.jid, displayName: g.display_name, state: 'no-activity' };
    }
    const text = digestMap.get(g.jid);
    if (text == null) {
      return { jid: g.jid, displayName: g.display_name, state: 'failed' };
    }
    return { jid: g.jid, displayName: g.display_name, state: 'summarized', summaryText: text };
  });

  // 5. Check if all failed/no-activity
  const hasAnyContent = groups.some(g => g.state === 'summarized');
  const hasAnyFailed = groups.some(g => g.state === 'failed');
  const connection = (account.status === 'degraded' || account.status === 'needs-auth')
    ? account.status as 'degraded' | 'needs-auth'
    : undefined;

  if (!hasAnyContent && !hasAnyFailed) return undefined;  // all no-activity → omit

  if (!hasAnyContent && hasAnyFailed) {
    return { state: 'unavailable', reason: 'model-offline', ...(connection ? { connection } : {}) };
  }

  return { state: 'ready', groups, ...(connection ? { connection } : {}) };
}
```

### Anti-Patterns to Avoid

- **Adding `gatherWhatsApp` inside `runBriefing`:** WhatsApp content would enter the frontier LLM prompt. D-11 explicitly prohibits this; the no-frontier invariant would break silently.
- **Calling `await digestCronHandle.runNow()` inside the briefing IPC handler:** The D-07.3 fallback must be `void runNow()` (fire-and-forget). Awaiting it would block the briefing response and expose Ollama errors to the renderer.
- **Placing `digest-cron.ts` outside `src/main/whatsapp/`:** The SC3 ratchet only scans `src/main/whatsapp/**`. Moving the file to `src/main/ipc/` or `src/main/briefing/` would take it outside ratchet scope.
- **Using `INSERT OR IGNORE` for digest rows without checking window:** If a row already exists for `(jid, date)` but has `summary_text = NULL` (prior failed run), `INSERT OR IGNORE` would silently skip the retry. Use `INSERT OR REPLACE` or `ON CONFLICT(jid, date) DO UPDATE SET ...` for the re-run path.
- **Comparing `sent_at` (ISO string in DB) against Unix integer:** Migration 138 declares `sent_at INTEGER` but ingest writes ISO strings. The window query must use ISO string comparisons throughout.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LLM free-text generation | Custom HTTP to Ollama API | `generateText` from `ai` + `getLocalModel()` | Already wired; injectable test seam; handles streaming/error abstraction |
| Cron scheduling | `setInterval` / OS scheduler | `node-cron` via existing pattern in `retention.ts` | Integrates with `cronRegistry` (no-bare-cron ratchet); powerMonitor suspend/resume hooks |
| LLM call serialization | Custom semaphore | `p-queue` (already in `aggregate.ts`) | Prevents concurrent Ollama requests; rate-limit safety; already imported |
| Seal-guard / catchup drain | Custom lock check | `pendingCatchup.add` + `registerOnUnlock` drain | These are the project's established patterns; rolling your own creates two systems |
| Text parsing of delimited sections | Regex-heavy custom parser | Simple `split`-based splitter on `### ` prefix | The delimiter format is chosen precisely because it's trivial to split; see Code Examples below |

---

## Digest Prompt Design (Claude's Discretion — Recommended)

### System Prompt (fixed)

```
You are Aria, an executive chief-of-staff AI.
Summarize the following WhatsApp group messages for your executive's morning briefing.
Be terse, factual, and executive-focused. Use exactly the section headers shown.
If a section has nothing to report, write only the header followed by "(nothing to report)".
```

### Per-Group User Prompt

```
GROUP: {displayName}
DATE: {date}
EXECUTIVE'S DISPLAY NAME: {userDisplayName}
EXECUTIVE'S PHONE PART: {meJidLocalPart}

MESSAGES ({count} messages, {windowStart} to {windowEnd}):
{messages}

Produce a structured summary using ONLY these headers in this order:
### KEY POINTS
(2-4 bullet points of the most important topics discussed)

### DECISIONS
(Explicit decisions made, or "(nothing to report)")

### OPEN QUESTIONS
(Unresolved questions or action items needing the executive's input, or "(nothing to report)")

### MENTIONS
(Any references to the executive by name or phone number, or "(nothing to report)")
```

**Rationale:** Fixed section order at temperature 0 is reliable on 8B/7B Llama-class models. The `(nothing to report)` fallback prevents empty-section hallucination. Passing both `userDisplayName` and `meJidLocalPart` covers both text-name references and phone-number references in group messages.

### Per-Group Message Cap

Recommended: **≤ 150 messages** per group per window (roughly 3–5 days of moderate group activity). At ~40 tokens/message average, 150 messages = ~6,000 tokens context, well within Llama 3.1 8B's 8,192 context window, leaving room for system prompt + output.

If a group has > 150 messages in the window, take the most recent 150 (ORDER BY sent_at DESC LIMIT 150, then reverse for chronological presentation).

### Window Math (D-04/D-05)

```sql
-- Recommended window computation for a single group:
WITH last_digest AS (
  SELECT MAX(m.sent_at) AS watermark
  FROM whatsapp_message m
  INNER JOIN whatsapp_group_digest d ON d.jid = m.jid
  WHERE d.jid = :jid
    AND d.summary_text IS NOT NULL
    AND d.date < :today
)
SELECT m.jid, m.body_text, m.sent_at, m.sender_jid
FROM whatsapp_message m
WHERE m.jid = :jid
  AND m.sent_at >= COALESCE(
    (SELECT watermark FROM last_digest),
    datetime('now', '-3 days')   -- N=3 days for first run
  )
  AND m.sent_at >= datetime('now', '-3 days')  -- cap at N days regardless
ORDER BY m.sent_at ASC
LIMIT 150
```

Note: `sent_at` is stored as ISO 8601 string despite `INTEGER` declared type. Use ISO string comparisons (`datetime('now', '-3 days')` returns an ISO string in SQLite). [VERIFIED against ingest.ts and retention.ts behavior]

N recommendation: **3 days** — covers weekend/holiday skip without accumulating excessive backlog. The 30-day retention floor makes N ≤ 30 trivially satisfied. [ASSUMED — no domain-specific data; tune in UAT]

### Delimiter Splitter Helper

```ts
// Parse summary_text back into labeled blocks.
// Partial-parse tolerant: unknown/missing sections return empty string.
export function parseDigestSections(text: string): {
  keyPoints: string;
  decisions: string;
  openQuestions: string;
  mentions: string;
} {
  const HEADERS = ['### KEY POINTS', '### DECISIONS', '### OPEN QUESTIONS', '### MENTIONS'];
  const result: Record<string, string> = {};
  let current: string | null = null;
  for (const line of text.split('\n')) {
    const header = HEADERS.find(h => line.trim().startsWith(h));
    if (header) { current = header; result[header] = ''; continue; }
    if (current) result[current] = (result[current] ?? '') + line + '\n';
  }
  return {
    keyPoints: (result['### KEY POINTS'] ?? '').trim(),
    decisions: (result['### DECISIONS'] ?? '').trim(),
    openQuestions: (result['### OPEN QUESTIONS'] ?? '').trim(),
    mentions: (result['### MENTIONS'] ?? '').trim(),
  };
}
```

This helper can live in `src/main/whatsapp/digest-cron.ts` (used during generation to log section presence) or in `src/shared/` if the renderer needs to render individual sections rather than the raw `summaryText` string. Given D-01 stores verbatim text, the renderer likely renders the raw string and the splitter is optional at render time.

---

## Common Pitfalls

### Pitfall 1: `runChannelOnce` is a no-op stub

**What goes wrong:** `pendingCatchup.add('whatsapp-digest')` is called correctly when the cron fires while the DB is sealed. At unlock, the drain calls `runChannelOnce('whatsapp-digest', db, logger)` — which logs "starting/complete" and does nothing. The digest never actually runs.

**Why it happens:** `runChannelOnce` at lines 869–882 is a documented placeholder stub with `await Promise.resolve()`. It has never been given real per-channel implementations. [VERIFIED]

**How to avoid:** Phase 21 must add a real `case 'whatsapp-digest':` branch to `runChannelOnce`. The `digestHandle` variable must be accessible in the closure — store it module-scope alongside `whatsAppManager`.

**Warning signs:** Test: `pendingCatchup.add('whatsapp-digest')` + `fireOnUnlock(db)` → assert that at least one `whatsapp_group_digest` row was written.

### Pitfall 2: `getLocalModel()` does not fail at call time; `generateText` does

**What goes wrong:** Wrapping only `getLocalModel()` in a try/catch as "Ollama unavailable" guard. `getLocalModel()` constructs a provider object and succeeds even when Ollama is not running. The actual network error fires inside `await generateText(...)`.

**Why it happens:** `getLocalModel()` is synchronous and only creates the client object. [VERIFIED: providers.ts lines 80–96]

**How to avoid:** The try/catch must wrap the `await generateText(...)` call, not just `getLocalModel()`. On catch: log warn, write `INSERT OR REPLACE INTO whatsapp_group_digest ... (summary_text=NULL, generated_at=NULL)` to record the attempt with a failed state.

**Warning signs:** Test with a mock `generateTextFn` that throws — assert the digest row has `summary_text = NULL`.

### Pitfall 3: `INSERT OR IGNORE` silently skips retry on NULL summary

**What goes wrong:** First run at 05:00 fails (Ollama down), writing a row with `summary_text = NULL`. User clicks "Generate now". The `INSERT OR IGNORE` sees `UNIQUE(jid,date)` conflict and skips the re-run. The row stays NULL.

**Why it happens:** `UNIQUE(jid,date)` prevents duplicate rows — correct for idempotent re-runs. But for retry-on-failure, we want to overwrite the NULL row.

**How to avoid:** Use `INSERT OR REPLACE` or `INSERT ... ON CONFLICT(jid, date) DO UPDATE SET summary_text=excluded.summary_text, generated_at=excluded.generated_at, model_id=excluded.model_id` so retries overwrite failed rows.

**Warning signs:** Write a test that inserts a NULL-summary row, then calls `runDigest`, and asserts the row now has non-NULL `summary_text`.

### Pitfall 4: `sent_at` INTEGER type vs ISO string data

**What goes wrong:** Writing Unix integer timestamps into `sent_at` (matching the column's declared `INTEGER` type) while existing rows and retention queries all use ISO strings. Mixed formats break the window query's `>=` comparison.

**Why it happens:** Migration 138 declares `INTEGER` but ingest.ts writes ISO strings and retention.ts compares ISO strings. SQLite stores the ISO string without error.

**How to avoid:** Use ISO string format consistently throughout Phase 21. The window query uses `datetime('now', '-3 days')` (which returns an ISO string) and `m.sent_at >= ...` comparisons work correctly. [VERIFIED via ingest.ts and retention.ts source]

### Pitfall 5: Blocking the briefing on the async fallback

**What goes wrong:** D-07.3 says trigger generation async/best-effort. If the code writes `await triggerDigestGeneration(...)` inside the `BRIEFING_TODAY` handler (even inside a try/catch), a slow Ollama response (10–30s) would freeze the 07:00 briefing render.

**Why it happens:** The `BRIEFING_TODAY` handler is an `async` IPC handler; any `await` inside it blocks the response.

**How to avoid:** Use `void triggerDigestAsync(deps)` (fire-and-forget) inside the try/catch. The `void` keyword ensures no `await` on the promise.

### Pitfall 6: Digest file placement outside `src/main/whatsapp/`

**What goes wrong:** Placing `digest-cron.ts` under `src/main/ipc/` or `src/main/briefing/` takes it outside the no-frontier ratchet's scan scope. Even if the file never imports frontier modules today, a future edit could silently violate the invariant.

**Why it happens:** "Briefing enrichment" association pulls the file toward `src/main/ipc/` or `src/main/briefing/`.

**How to avoid:** The ratchet scans `src/main/whatsapp/**`. `digest-cron.ts` must live under that directory. The read-only helper `readWhatsAppDigests` in `briefing.ts` is exempt because it calls no model. [VERIFIED: ratchet source at tests/unit/main/whatsapp/no-frontier.ratchet.spec.ts]

### Pitfall 7: `CatchupChannel` union not extended before `pendingCatchup.add`

**What goes wrong:** TypeScript compile error: `Argument of type '"whatsapp-digest"' is not assignable to parameter of type 'CatchupChannel'`. This blocks the build if the string literal is added to `digest-cron.ts` before the union is extended.

**How to avoid:** Wave 0 task: extend `CatchupChannel` in `pendingCatchup.ts` before writing the cron file.

---

## Runtime State Inventory

> This section is included as a systematic check, even though Phase 21 is NOT a rename/refactor phase. Confirming no runtime state migration is needed.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `whatsapp_group_digest` rows: none yet (table shipped in migration 138; Phase 21 is first writer) | None — no migration |
| Live service config | None — no external service configuration for digest | None |
| OS-registered state | None | None |
| Secrets/env vars | None — digest uses `getLocalModel()` which reads `getOllamaModelId()` from safeStorage; no new secrets | None |
| Build artifacts | None | None |

No runtime state migration required. Zero schema changes. [VERIFIED]

---

## Validation Architecture

`workflow.nyquist_validation: true` in `.planning/config.json`. [VERIFIED]

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.x |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `npx vitest run tests/unit/main/whatsapp/digest-cron.spec.ts -x` |
| Full suite command | `npx vitest run tests/unit/main/whatsapp/ tests/unit/main/ipc/ tests/unit/renderer/features/briefing/` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WA-08 | Digest row for today appears in briefing payload as `whatsApp.state='ready'` with `groups[].state='summarized'` | Unit | `npx vitest run tests/unit/main/ipc/briefing-whatsapp-enrichment.spec.ts -x` | ❌ Wave 0 |
| WA-08 | D-10 state matrix: not-linked → undefined, zero-groups → undefined, sub-threshold → undefined, failed → `unavailable`, ready → `ready` | Unit | `npx vitest run tests/unit/main/ipc/briefing-whatsapp-enrichment.spec.ts -x` | ❌ Wave 0 |
| WA-08 | Renderer renders WhatsApp section when `payload.whatsApp.state='ready'` | Unit (renderer) | `npx vitest run tests/unit/renderer/features/briefing/BriefingScreen.spec.tsx -x` | ✅ (extend existing) |
| WA-08 | Renderer renders "unavailable" note + retry button when `payload.whatsApp.state='unavailable'` | Unit (renderer) | `npx vitest run tests/unit/renderer/features/briefing/BriefingScreen.spec.tsx -x` | ✅ (extend existing) |
| WA-09 | SC3 no-frontier ratchet stays GREEN with `digest-cron.ts` added | Static | `npx vitest run tests/unit/main/whatsapp/no-frontier.ratchet.spec.ts` | ✅ (SHIPPED, already GREEN) |
| WA-10 | Briefing payload returned even when `generateText` throws (Ollama down simulation) | Unit | `npx vitest run tests/unit/main/whatsapp/digest-cron.spec.ts -x` | ❌ Wave 0 |
| WA-10 | `readWhatsAppDigests` returns `unavailable` when rows have `summary_text=NULL` | Unit | `npx vitest run tests/unit/main/ipc/briefing-whatsapp-enrichment.spec.ts -x` | ❌ Wave 0 |
| D-06 | UNIQUE(jid,date): re-running digest does not create duplicate rows | Unit | `npx vitest run tests/unit/main/whatsapp/digest-cron.spec.ts -x` | ❌ Wave 0 |
| D-07.1 | pendingCatchup drain: `'whatsapp-digest'` added when DB sealed, runs on unlock | Unit | `npx vitest run tests/unit/main/whatsapp/digest-cron.spec.ts -x` | ❌ Wave 0 |
| D-07.2 | powerMonitor resume: missed-tick triggers `runNow()` when `MAX(date) < today` | Unit | `npx vitest run tests/unit/main/whatsapp/digest-cron.spec.ts -x` | ❌ Wave 0 |
| D-07.3 | Briefing-read fallback: BRIEFING_TODAY never awaits digest generation; briefing response never throws | Unit | `npx vitest run tests/unit/main/ipc/briefing-whatsapp-enrichment.spec.ts -x` | ❌ Wave 0 |
| D-09 | Partial p-queue failure: some groups summarized, later group fails → ready arm with mixed sub-states | Unit | `npx vitest run tests/unit/main/whatsapp/digest-cron.spec.ts -x` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run tests/unit/main/whatsapp/ -x`
- **Per wave merge:** `npx vitest run tests/unit/main/whatsapp/ tests/unit/main/ipc/ tests/unit/renderer/features/briefing/`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/unit/main/whatsapp/digest-cron.spec.ts` — covers WA-10, D-06, D-07.1, D-07.2, D-09
- [ ] `tests/unit/main/ipc/briefing-whatsapp-enrichment.spec.ts` — covers WA-08, WA-10, D-07.3, D-10 state matrix
- [ ] `tests/unit/renderer/features/briefing/BriefingScreen.spec.tsx` — extend with WhatsApp union state cases (WA-08 renderer, WA-10 renderer); file EXISTS, add cases

None — existing test infrastructure (Vitest, `@testing-library/react`, `better-sqlite3` in-memory DB, `vi.fn()` mock seams) covers all phase requirements. No new framework installation needed.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | n/a — no new auth surface |
| V3 Session Management | No | n/a |
| V4 Access Control | No | n/a — digest is local-only |
| V5 Input Validation | Yes (low risk) | WhatsApp message body text passed to local model only; never echoed to frontier; no user input |
| V6 Cryptography | No | n/a — database encryption handled by SQLCipher (existing) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt injection via message body | Tampering | Local model only (WA-09/SC3); frontier never sees group content; no code execution from LLM output |
| Sensitive group content leaking to frontier | Information Disclosure | SC3 ratchet (static, already GREEN); read-path enrichment is post-frontier-call by construction (D-11) |
| Ollama offline causes briefing failure | Denial of Service | D-07.3 async fallback + D-10 degraded state; briefing never throws on Ollama unavailability |

---

## Open Questions

1. **User display name availability at digest time**
   - What we know: `profile.json` (from onboarding) stores the user's display name (`good morning, <name>` feature, committed 74af0e8)
   - What's unclear: Exact path and field name in `profile.json`; whether it's accessible from main process at 05:00 cron time without a DB query
   - Recommendation: Read `profile.json` in `digest-cron.ts` deps (pass as `userDisplayName?: string`); default to empty string if missing (makes `### MENTIONS` simply "any name-like references"). This is safer than requiring profile availability as a hard dependency.

2. **`creds.me.id` availability for heuristic mentions**
   - What we know: `creds.me.id` is stored in `whatsapp_auth_state` table (Baileys Signal creds). The session manager reads this from the DB.
   - What's unclear: Whether the local-part of `creds.me.id` is parseable from a DB-stored credential value without a full Baileys deserialization
   - Recommendation: Pass `meJidLocalPart` as an optional dep on `WhatsAppDigestDeps`. If unavailable, the prompt still runs without it (heuristic mentions will rely only on `userDisplayName`).

3. **`runChannelOnce` — module-scoped handle storage pattern**
   - What we know: `runChannelOnce` needs access to `digestHandle.runNow()`. `whatsAppManager` is stored module-scope in `index.ts` (see line 590 area).
   - What's unclear: Whether the planner will store `digestHandle` as a module-scope `let` variable (same as `whatsAppManager`) or use a different closure approach
   - Recommendation: Store as `let _digestHandle: WhatsAppDigestHandle | null = null` alongside `let whatsAppManager: WhatsAppSessionManager | null = null` at the top of `index.ts`. Assign in `bootPoll`. Reference in `runChannelOnce`.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Ollama (localhost:11434) | Digest generation | Conditional | — | Graceful degradation — `state:'unavailable'` |
| Llama 3.1 8B or Qwen 2.5 7B model | Digest content quality | Conditional | — | Fallback is failed digest row; `DEFAULT_LOCAL_MODEL` = `llama3.1:8b-instruct-q4_K_M` |
| Node.js 20 LTS | All | ✓ | Project-wide | — |
| better-sqlite3-multiple-ciphers | DB writes | ✓ | 11.x | — |
| `ai` (Vercel AI SDK) | `generateText` | ✓ | Project-wide | — |
| `ollama-ai-provider-v2` | `getLocalModel()` | ✓ | Project-wide | — |
| `node-cron` | Cron scheduling | ✓ | 3.x | — |
| `p-queue` | LLM serialization | ✓ | 8.x | — |

Ollama and the local model are the only non-guaranteed dependencies. Both have explicit degradation paths: the cron catches `generateText` errors and writes `summary_text = NULL`; the briefing enrichment renders `state: 'unavailable'` for NULL rows.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `ollama-ai-provider` | `ollama-ai-provider-v2` | AI SDK 6 migration | MUST use v2; v1 incompatible with AI SDK 6 |
| `generateObject` for LLM text output | `generateText` for free-form markdown | Phase 21 decision (D-01) | Avoids constrained-decoding flakiness on 8B models; delimited markdown is sufficient structure |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | N = 3 days recommended for window cap | Code Examples (Window Math) | Window too short (misses messages after multi-day outage) or too long (token budget pressure). Tunable in UAT; bounded by 30d retention floor. |
| A2 | Min-activity threshold of 3 messages is appropriate | Code Examples, D-10 | Too high: low-volume groups never get a digest. Too low: burns Ollama calls on trivial chatter. Tunable. |
| A3 | `profile.json` is readable from main process at cron time | Open Questions | If profile path or field name is wrong, `userDisplayName` defaults to empty string; `### MENTIONS` degrades gracefully |
| A4 | 150-message cap per group is sufficient for context window | Digest Prompt Design | Llama 3.1 8B has 8,192 token context; 150 messages at ~40 tokens = 6,000 tokens + system/output leaves headroom. Should be validated with actual group data in UAT. |

---

## Sources

### Primary (HIGH confidence — VERIFIED against live source)

- `src/main/ipc/briefing.ts` — `BRIEFING_TODAY` handler + `thisWeekInsights` enrichment (lines 215–248 verified)
- `src/main/whatsapp/retention.ts` — cron skeleton template (entire file verified, lines 144–153 seal-guard verified)
- `src/main/lifecycle/pendingCatchup.ts` — `CatchupChannel` union (lines 12–21 verified, `'whatsapp-digest'` not yet present)
- `src/main/lifecycle/onUnlock.ts` — `fireOnUnlock` / callbacks (full file verified)
- `src/main/index.ts` — `startWhatsAppRetention` bootstrap (lines 618–623), `runChannelOnce` stub (lines 869–882), unlock drain (lines 741–766)
- `src/main/llm/providers.ts` — `getLocalModel()` signature (full file verified)
- `src/main/db/migrations/138_whatsapp.sql` — shipped schema (full file verified)
- `src/main/whatsapp/ingest.ts` — `sender_jid` write behavior (line 166 verified)
- `src/shared/ipc-contract.ts` — `BriefingPayload.thisWeekInsights` (lines 555–557), `WhatsAppStatusDto` (lines 1743–1748)
- `src/renderer/features/briefing/BriefingScreen.tsx` — `thisWeekInsights` render switch (lines 661–683)
- `src/renderer/features/briefing/GenerateNowAffordance.tsx` — retry affordance pattern (full file verified)
- `src/main/briefing/generate.ts` — frontier `generateObject` engine, degraded-payload pattern (lines 330–574)
- `src/main/insights/aggregate.ts` — cautionary placement precedent (lines 1–40 verified)
- `tests/unit/main/whatsapp/no-frontier.ratchet.spec.ts` — SC3 ratchet (full file verified, SHIPPED + GREEN)
- `tests/unit/renderer/features/briefing/BriefingScreen.spec.tsx` — renderer test pattern (lines 1–220 verified)
- `src/main/ipc/ask.ts` — `generateText` usage pattern (lines 64–66 verified)
- `src/main/lifecycle/powerMonitor.ts` — `registerLifecycleCallbacks` (full file verified)
- `.planning/config.json` — `nyquist_validation: true` (verified)

### Secondary (MEDIUM confidence)

- CONTEXT.md line-number cites for `ipc-contract.ts ~line 555` and `BriefingScreen.tsx ~lines 661–683` — both verified accurate within ±2 lines

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified in live `package.json` and import statements
- Architecture: HIGH — all integration points verified against live source files
- Pitfalls: HIGH — all but one derived from verified code patterns; A1/A2 are tuning values
- Prompt design: MEDIUM — based on project's established Ollama usage patterns + training knowledge for 8B model behavior at temperature 0

**Research date:** 2026-06-10
**Valid until:** 2026-07-10 (stable codebase; primarily internal patterns)
