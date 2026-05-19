# Phase 8: Insights, Weekly Recap, Learning, Release Prep — Research

**Researched:** 2026-05-20
**Domain:** Final v1 phase — privacy-preserving analytics + retrospective generation + preference learning loop + packaging/signing/auto-update.
**Confidence:** HIGH on prior-art reuse (Phase 1/2/3/4/6/7 patterns); MEDIUM on cluster-library + Win SmartScreen behaviour (single-source, late-2025 references); HIGH on docx/@react-pdf/renderer/electron-updater patterns.

## Summary

Phase 8 is a wiring + integration phase more than a green-field one. Almost every cross-cutting primitive it needs already exists in Aria's main process: a scheduler + cron registry with suspend/resume coalescing (Phase 2), three independent audit-log tables that need *unification not invention* (`routing_log`, `send_log`, `calendar_action_log`, plus `meeting_action_task_link` + `todoist_task` rows), a generic `approval` chokepoint shape across email/calendar/task batch (Phases 3/4/6), `redactAllPii` + `redactObject` log redaction (Phases 1/2), `generateObject + Zod` LLM call pattern (Phase 2), `VACUUM INTO`-based DB backup primitive (Phase 1), and an `AnswerService` factory whose IPC consumer ships a `getAnswerService?: () => AnswerService | null` injection seam that is currently always returning `null` from the IPC dependency graph (Phase 7 acknowledged this as deferred to Phase 8).

The four streams have very different risk profiles:

- **Stream 1 (Insights):** medium-novel — needs a new `insights` table, four computation modules, and a hard 14-day-per-corpus gate. The clustering choice is the only real research call; everything else is SQL aggregation.
- **Stream 2 (Recap):** depends critically on a new unified `action_audit_log` table (or view) that the recap reads as the trust anchor. This is the highest-value architectural decision of the phase: a *view* across the three existing tables avoids backfill but locks Phase 8 to those tables' shapes; a *materialized table* with insert-side fan-out from the existing chokepoints is more flexible but adds a new write path in Phase 3/4/6 code. **Recommended:** ship a SQL `VIEW action_audit_log` for v1 (zero-migration cost, deterministic) and migrate to materialized only if/when a real performance need surfaces.
- **Stream 3 (Learning):** mostly schema + nightly aggregator + Settings UI. The hard part is **never letting signals leak to frontier** — that invariant is testable and grep-enforceable identical to Phase 3's `assertApproved` and Phase 6's static-grep ratchet.
- **Stream 4 (Release):** electron-updater + electron-builder are already pinned in `package.json` (`^26.0.0`). The work is config + secrets + notarisation + a pre-migration backup hook in the migration runner. Windows-signing is **staged** per amended XCUT-05 — testers get unsigned; OV-cert + SmartScreen-warm-up happens later. Plan must update REQUIREMENTS.md as part of Stream 4 wave.

**Primary recommendation:** Four sequential plans matching CONTEXT.md's structure: `08-01 insights+briefing`, `08-02 unified-audit + recap`, `08-03 learning loop + settings tab`, `08-04 release prep + AnswerService wiring closure + REQUIREMENTS amendment + final E2E`. Stream 4 should pull the AnswerService↔IPC factory closure (see §Phase 7 Wiring Closure below) because it is the only remaining boot-wiring gap and belongs alongside the release-readiness checklist.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| Nightly insight aggregation (SQL over calendar/email/meeting tables) | Main process (Node) | DB | All source tables live in SQLCipher; needs cron + p-queue serialization |
| Insight prose generation (numeric→sentence) | Main process LLM router | Frontier API | Aggregates-only payload; routed via existing `router.classify` then `generateObject` |
| Insights surface in briefing | Main process (briefing payload) → Renderer | — | Read-from-cache pattern identical to Phase 2 briefing |
| Action audit log (unified) | DB (VIEW or table) | — | Trust anchor; recap reads it; renderer can also paginate it directly |
| Weekly recap generation | Main process (Monday cron + p-queue) | LLM router | Same shape as Phase 2 briefing engine |
| Recap rich-text editor | Renderer (React) | — | Local-only edit; commits back via IPC |
| Recap DOCX/PDF export | Main process | — | `docx` + `@react-pdf/renderer` run server-side (in main); avoids bundling fonts in renderer |
| Signal capture | Wherever the user action originates | DB | Chokepoint pattern — same as Phase 3/4 audit log emits |
| Nightly preference aggregator | Main process cron | DB | Reads signal log; upserts typed prefs row |
| Settings → Learned Prefs tab | Renderer | Main IPC | Read-only inspection + reset buttons |
| Auto-updater | Electron main process | GitHub Releases | electron-updater built-in `github` provider |
| Pre-migration backup hook | Main process (migration runner extension) | filesystem | Wrap existing `runMigrations` with backup+verify |
| macOS notarisation | Build pipeline (CI/local) | Apple notary service | electron-builder's `notarize` field; @electron/notarize under the hood |
| Windows signing (deferred, GA) | Build pipeline | OV cert vendor | electron-builder `win.certificateFile`/`certificateSubjectName` |
| Final E2E (happy path) | CI test runner | Playwright `_electron` against packaged app | Same harness used in Phase 1/2/6 smoke specs |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard / Source |
|---|---|---|---|
| `electron-updater` | `^6.x` (per CLAUDE.md target; verify `npm view electron-updater version`) | Auto-update with GitHub Releases | Built-in `github` provider; pairs with electron-builder. **[CITED: CLAUDE.md]** |
| `electron-builder` | `^26.0.0` (already in package.json) | App packaging + signing + notarisation + update-feed publish | electron-builder.publish=`github` flows feed-file (`latest.yml`/`latest-mac.yml`) into the release on `electron-builder --publish always`. **[VERIFIED: package.json]** |
| `@electron/notarize` | (transitive via electron-builder) | macOS notarytool wrapper | electron-builder calls it when `notarize` block is present. **[CITED: electron-builder docs]** |
| `docx` (dolanmiu) | `^9.x` (per CLAUDE.md) | DOCX export for recap | Declarative Document/Section/Paragraph tree; Node-runnable. **[CITED: CLAUDE.md]** |
| `@react-pdf/renderer` | `^4.x` (per CLAUDE.md) | PDF export for recap | JSX-declarative React-Native-style layout; runs in main process via `pdf().toBuffer()`. **[CITED: CLAUDE.md]** |
| `node-cron` | `^4.0.0` (already in deps) | Monday-recap + nightly insights + nightly aggregator | Same scheduler.cronRegistry used by `briefing` + `gmail-sync` + `calendar-sync`. **[VERIFIED: package.json + src/main/lifecycle/scheduler.ts]** |
| `p-queue` | `^9.0.0` (already in deps) | Serialize insight/recap LLM calls | Concurrency-1 invariant from Phase 1 RESEARCH. **[VERIFIED: package.json]** |
| `zod` | `^4.0.0` (already in deps) | Schemas for insight aggregates + recap sections + prefs | Same `generateObject` shape Phase 2 uses. **[VERIFIED: package.json]** |
| `ai` (Vercel AI SDK) | `^6.0.0` (already in deps) | `generateObject` for insight-prose, recap-narrative | Phase 2 prior art `src/main/briefing/generate.ts`. **[VERIFIED: package.json]** |
| `better-sqlite3-multiple-ciphers` | `^12.0.0` (already in deps) | Storage backing for `insights`, `learning_signals`, `learned_preferences`, `action_audit_log` view | Existing DB; one new migration (`128_phase8.sql`). **[VERIFIED: package.json]** |

### Supporting

| Library | Version | Purpose | When to Use |
|---|---|---|---|
| `node:crypto` (`createHash`) | stdlib | Backup file checksumming + signal-payload hash for dedupe | Reuse Phase 1 `hashPrompt` pattern |
| `electron` `dialog.showOpenDialog`/`showSaveDialog` | built-in | Recap export "Save as..." dialog | Same shape as `BACKUP_CREATE` IPC in `src/main/ipc/backup.ts` |
| `@tiptap/core` + `@tiptap/react` + `@tiptap/starter-kit` | `^2.x` (verify with `npm view @tiptap/react version`) | Recap editor in renderer | Industry default for React rich-text in 2025; smaller surface than Slate. **[ASSUMED]** — see Assumptions A1. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|---|---|---|
| TipTap (recap editor) | Slate / ProseMirror raw / Lexical | TipTap is ProseMirror wrapped; Slate has lighter dep tree but worse docs in 2024–25; Lexical is Meta-shipped but extension model less mature for collaborative editing (out of scope anyway). TipTap wins for solo-dev velocity. |
| Materialized `action_audit_log` table | SQL `VIEW` across `send_log` + `calendar_action_log` + `meeting_action_task_link` | View avoids backfill + double-write but locks recap to upstream column shapes; table costs new write-side code in Phase 3/4/6 chokepoints. **Recommend VIEW for v1.** |
| HDBSCAN (theme clustering) | Naive k-means with k swept 3..8 + silhouette tuning | HDBSCAN no-k tuning is appealing but no first-class JS port; calling Python via subprocess is out-of-process complexity. k-means in pure TS over nomic embeddings is ~50 LOC. **Recommend k-means.** |
| `electron-store` for prefs cache | Already-existing SQLCipher DB | Aria already encrypts the DB; storing prefs anywhere else fragments the trust surface and breaks the "all data local + encrypted" guarantee. **Use SQLite.** |
| Custom installer (NSIS scripted) | electron-builder NSIS default | Builder's NSIS target supports the differential-update protocol electron-updater expects; rolling our own breaks that pipeline. **Use builder defaults.** |

**Version verification:** Run `npm view electron-updater version`, `npm view docx version`, `npm view @react-pdf/renderer version`, `npm view @tiptap/react version` at plan time. CLAUDE.md targets are 6.x / 9.x / 4.x — none look stale but training-data freshness is 2026-01 cutoff. Confirm at the start of each plan.

## Architecture Patterns

### System Architecture Diagram

```
                      ┌──────────────────────────────────────────────────────┐
 Source data ──→      │  CALENDAR | EMAIL | MEETING_ACTION | SEND_LOG |      │
 (Phase 2/3/4/6)      │  CALENDAR_ACTION_LOG | TODOIST_TASK | ROUTING_LOG    │   ← SQLCipher
                      └──────────────────────────────────────────────────────┘
                                          │
                                          ▼
                       ┌─────────────────────────────────────┐
                       │  VIEW action_audit_log (Stream 2)   │  ← read-only union
                       └─────────────────────────────────────┘
                                          │
   ┌──────────────────────┬───────────────┴────────────────┬────────────────────┐
   ▼                      ▼                                ▼                    ▼
┌──────────┐         ┌──────────────┐                ┌──────────────┐    ┌──────────────┐
│ Nightly  │         │ Monday-cron  │                │ Settings UI  │    │ /ask + Cmd-K │
│ insights │         │ recap        │                │ Inspect+Reset│    │ (Phase 7)    │
│ aggreg.  │  cache  │ generator    │ rich-text edit │ + Signals    │    │ AnswerSvc    │
│ → INSIGHT│ ──────→ │ → RECAP table│ ──→ DOCX/PDF   │ tab          │    │ NOW WIRED ✓  │
│ table    │         │              │                │              │    │ (Stream 4)   │
└──────────┘         └──────────────┘                └──────────────┘    └──────────────┘
     │                      │                              │
     │                      ▼                              ▼
     │              ┌──────────────────────────────────────────────┐
     │              │  learning_signals (raw, append-only)         │
     │              │  • approval edits/rejects (Phase 3 chokepts) │
     │              │  • briefing thumbs (BRIEF-05)                │
     │              │  • recap section edits                       │
     │              │  • Q&A thumbs (Phase 7)                      │
     │              └──────────────────────────────────────────────┘
     │                              │
     │                              ▼ nightly aggregator
     │              ┌──────────────────────────────────────────────┐
     ▼              │  learned_preferences (single row, JSON)      │
   briefing.tsx ←   │  read at draft-time + recap-time + briefing  │
                    └──────────────────────────────────────────────┘

  ────────────── Release pipeline ──────────────
   git tag v1.x  →  electron-builder --publish always
                       ├─ macOS: codesign + notarize via @electron/notarize
                       ├─ Win:   v1 unsigned → testers; OV-sign for GA
                       └─ writes latest.yml / latest-mac.yml to GitHub Release

   App start  ──→ autoUpdater.checkForUpdatesAndNotify()
                       │
                       ▼ download
   On install:  PRE-MIGRATION BACKUP HOOK  →  runMigrations()
                       │                          │
                       │                          ├─ success: keep
                       │                          └─ failure: row-count drift / throw
                       │                                          → restore .ariabackup → re-launch
                       ▼
                  app/quit/relaunch
```

### Recommended File Layout (relative to `src/main/`)

```
insights/
  ├─ compute.ts            # 4 pure functions, one per insight type
  ├─ aggregate.ts          # nightly orchestrator; writes `insights` rows
  ├─ prose.ts              # numeric-aggregates → sentence via generateObject
  ├─ gate.ts               # 14-day-per-corpus hard gate
  └─ schedule.ts           # nightly cron registration (mirrors briefing/schedule.ts)

recap/
  ├─ audit-view.ts         # read VIEW action_audit_log; pagination + filter
  ├─ generate.ts           # weekly cron; gathers + builds recap payload
  ├─ schedule.ts           # Monday 8am cron (user-configurable)
  ├─ schema.ts             # RecapSchema (zod) for generateObject
  ├─ persist.ts            # `weekly_recap` table CRUD
  └─ export/
       ├─ docx.ts          # canonical → Buffer via `docx`
       └─ pdf.ts           # canonical → Buffer via `@react-pdf/renderer`

learning/
  ├─ signal-log.ts         # append-only writer; redaction at write
  ├─ aggregate.ts          # nightly: signals → typed prefs
  ├─ prefs.ts              # read/write learned_preferences row; per-field reset
  └─ sources/
       ├─ approval.ts      # hook into Phase 3 approvals.persist on edit/reject/accept
       ├─ briefing.ts      # hook into BRIEFING_DISMISS_NEWS_ITEM + new BRIEFING_FEEDBACK
       ├─ recap.ts         # diff per recap section on finalize
       └─ qa.ts            # hook into rag/answer-service thumb up/down (new turn metadata)

release/
  ├─ updater.ts            # autoUpdater wiring + UI events
  ├─ backup-hook.ts        # runMigrationsWithBackup() wrapper
  ├─ verify-migration.ts   # row-count comparator
  └─ av-runbook.md         # docs only (referenced by SUMMARY.md)

ipc/
  ├─ insights.ts           # INSIGHTS_LATEST, INSIGHTS_RECOMPUTE
  ├─ recap.ts              # RECAP_LIST, RECAP_GET, RECAP_REGENERATE, RECAP_EXPORT_DOCX, RECAP_EXPORT_PDF, RECAP_SAVE_EDITS, RECAP_FINALIZE
  ├─ learning.ts           # LEARN_GET_PREFS, LEARN_RESET_FIELD, LEARN_RESET_ALL, LEARN_LIST_SIGNALS
  └─ updater.ts            # UPDATER_CHECK, UPDATER_DOWNLOAD_PROGRESS (push), UPDATER_RESTART
```

### Pattern 1: Reuse `scheduleBriefing` shape verbatim for nightly insights + Monday recap

The existing `src/main/briefing/schedule.ts` is the canonical Aria cron-with-suspend/resume pattern. **Copy it line-for-line** (don't generalize prematurely) — invariants the planner must preserve in every new cron:

- Singleton key in `scheduler.cronRegistry` (e.g. `'insights-nightly'`, `'recap-monday'`).
- `_lastFiredYmd` module-scoped guard so OS clock jumps post-suspend don't fire twice on the same local date.
- `registerLifecycleCallbacks({ onSuspend, onResume })` that calls `task.stop()` and `task.start()` respectively — **never `.delete()` the registry entry on suspend** (the size invariant in Phase 2 success criterion 4 generalizes: registry size monotonically grows as features ship, and must stay stable across suspend/resume).
- Resume does **not** back-fire missed runs. Insights and recap missed during a multi-day suspend are recovered via the user-facing "Generate now" affordance — same UX path as briefing.

**Example skeleton (Stream 1 nightly insights):**

```typescript
// Source: derived from src/main/briefing/schedule.ts (Phase 2 prior art)
import cron from 'node-cron';
import { registerLifecycleCallbacks } from '../lifecycle/powerMonitor';
import type { SchedulerHandle } from '../lifecycle/scheduler';

const CRON_KEY = 'insights-nightly';
let _lastFiredYmd: string | null = null;

export function scheduleInsights(
  expr: string,                           // e.g. '0 2 * * *'  (2am local)
  tz: string,
  run: (ymd: string) => Promise<void>,
  deps: { scheduler: SchedulerHandle; logger: Logger },
) {
  const prior = deps.scheduler.cronRegistry.get(CRON_KEY);
  prior?.stop();
  const task = cron.schedule(expr, async () => {
    const today = computeLocalYmd(tz, new Date());
    if (_lastFiredYmd === today) return;
    _lastFiredYmd = today;
    await run(today);
  }, { timezone: tz });
  deps.scheduler.cronRegistry.set(CRON_KEY, task);
  registerLifecycleCallbacks({
    onSuspend: () => deps.scheduler.cronRegistry.get(CRON_KEY)?.stop(),
    onResume:  () => deps.scheduler.cronRegistry.get(CRON_KEY)?.start(),
  });
  return task;
}
```

### Pattern 2: Unified `action_audit_log` as a SQL VIEW (Stream 2)

**Recommended shape** (writes nothing new; recap reads the VIEW):

```sql
-- Migration 128 (Phase 8)
CREATE VIEW action_audit_log AS

  -- Email sends (Phase 3 send_log)
  SELECT
    'email_send'                    AS kind,
    sl.ts                           AS occurred_at,
    sl.provider                     AS provider_key,
    'gmail'                         AS resource,   -- todo: outlook once Phase 5 send lands
    sl.approval_id                  AS approval_id,
    json_object(
      'recipients',  json(sl.recipients_json),
      'subject',     sl.subject,
      'ok',          sl.ok,
      'error',       sl.error,
      'providerMsgId', sl.provider_msg_id
    )                               AS payload_json,
    CASE WHEN sl.ok = 1 THEN 'sent' ELSE 'failed' END AS outcome
  FROM send_log sl

  UNION ALL

  -- Calendar changes (Phase 4 calendar_action_log; phase IN ('post_write','failed','override'))
  SELECT
    'calendar_change'               AS kind,
    cal.created_at                  AS occurred_at,
    'google'                        AS provider_key, -- Phase 5 microsoft TBD; planner add Outlook union arm
    'calendar'                      AS resource,
    cal.approval_id                 AS approval_id,
    json_object(
      'phase',         cal.phase,
      'eventId',       cal.event_id,
      'recurringScope',cal.recurring_scope,
      'before',        json(cal.before_json),
      'after',         json(cal.after_json),
      'googleEtag',    cal.google_etag,
      'error',         cal.google_error
    )                               AS payload_json,
    CASE WHEN cal.phase = 'post_write' THEN 'applied'
         WHEN cal.phase = 'override'   THEN 'override'
         ELSE 'failed' END          AS outcome
  FROM calendar_action_log cal
  WHERE cal.phase IN ('post_write','failed','override')

  UNION ALL

  -- Todoist pushes (Phase 6 meeting_action_task_link + todoist_task)
  SELECT
    'task_pushed'                   AS kind,
    mal.created_at                  AS occurred_at,
    'todoist'                       AS provider_key,
    'tasks'                         AS resource,
    NULL                            AS approval_id, -- batch-approval id lives in meeting_action
    json_object(
      'taskId',     mal.task_id,
      'remoteId',   mal.remote_id,
      'content',    tt.content,
      'projectName',tt.project_name
    )                               AS payload_json,
    CASE WHEN tt.is_completed = 1 THEN 'completed' ELSE 'pushed' END AS outcome
  FROM meeting_action_task_link mal
  JOIN todoist_task tt ON tt.id = mal.task_id

  UNION ALL

  -- Approvals declined (rejected/expired) across all kinds (Phase 3/4/6)
  SELECT
    'approval_declined'             AS kind,
    a.updated_at                    AS occurred_at,
    NULL                            AS provider_key,
    a.kind                          AS resource,
    a.id                            AS approval_id,
    json_object(
      'rejectionReason', a.rejection_reason,
      'subject',         a.subject
    )                               AS payload_json,
    'declined'                      AS outcome
  FROM approval a
  WHERE a.state = 'rejected'
;

-- Pagination index on the **base tables** (views can't have their own indexes).
-- These already exist (idx_send_log_ts, idx_calendar_action_log_approval),
-- verify they cover ORDER BY occurred_at DESC LIMIT N use case for recap.
```

**Why a VIEW:**
1. Zero migration risk — no new writes from existing chokepoint code in Phase 3/4/6.
2. Recap reads the trust-anchor list directly from canonical sources, so there's no "fan-out write failed silently" failure mode that Phase 6 already burned us on (`pushApprovedMeetingActions` silent-bypass — see MEMORY: `project_aria_phase6_7_discovered`).
3. The recap renderer treats the VIEW as the source-of-truth list; the LLM-written paragraph above it is the readability layer per CONTEXT decision.

**Failure mode to call out in the plan:** if Phase 5 (Outlook send) ever ships, the `'gmail'` resource hardcoded in arm 1 must change to `sl.provider`. Add a planner TODO + a `verify-action-audit-log` assertion: every send/calendar/task action that exists in a base table appears in the view. This is testable.

### Pattern 3: Insight prose generation — aggregates-only payload

INSIGHT-03 invariant: **no raw user content reaches frontier.** Pattern:

```typescript
// src/main/insights/prose.ts
import { generateObject } from 'ai';
import { z } from 'zod';
import { hashPrompt, writeRoutingLog } from '../llm/routingLog';

const ProseOut = z.object({
  sentences: z.array(z.string().max(220)).min(1).max(3),
});

export async function insightProse(
  aggregates: {                     // ONLY numeric/structural facts allowed
    calendarLoadDeltaPct?: number;
    medianReplyTimeShiftHours?: number;
    topThemes?: string[];           // theme LABELS only — not sources
    editedDraftSharePct?: number;
  },
  deps: { router: LLMRouter; logger: Logger },
) {
  // ASSERT: payload contains no email body, subject, calendar title, etc.
  // (compile-time via schema; runtime via grep in tests).
  const promptBody = JSON.stringify(aggregates);
  const decision = await deps.router.classify({ prompt: promptBody, source: 'insight-prose' });
  // Since payload is by construction PII-free, classify will route per
  // user setting (typically FRONTIER). Local fallback when frontier disabled.
  const model = decision.route === 'FRONTIER'
    ? getFrontierModel(decision.modelId)
    : getLocalModel(DEFAULT_LOCAL_MODEL);
  const { object } = await generateObject({
    model, schema: ProseOut,
    prompt: `Convert these weekly aggregates into 1–3 short sentences for an exec briefing:\n${promptBody}`,
  });
  writeRoutingLog({ promptHash: hashPrompt(promptBody), route: decision.route, /* ... */ });
  return object.sentences;
}
```

The 14-day-per-corpus gate runs **before** `insightProse` even computes (no LLM call) — `insights/gate.ts` reads the min(occurred_at) per source (e.g. `MIN(date_ts) FROM calendar_event`, `MIN(internal_date) FROM gmail_message`) and refuses if `< 14d ago`.

### Pattern 4: AnswerService↔IPC factory (Stream 4 / Phase 7 closure)

`src/main/ipc/rag.ts` already has the seam:

```typescript
export interface RagIpcDeps {
  // ...
  getAnswerService?: () => AnswerService | null;
  getAccountStatus?: (...) => ...;
}
```

And the answer-service exports `createAnswerService(deps: AnswerServiceDeps): AnswerService`. The wiring gap is in `src/main/ipc/index.ts` where `registerRagHandlers(ipcMain, { logger, dbHolder })` does **not** pass `getAnswerService`. Plan-08-04 closes this:

```typescript
// In src/main/ipc/index.ts -- inside registerHandlers, BEFORE the ragChannels block:
let _answerService: AnswerService | null = null;
function getOrCreateAnswerService(): AnswerService | null {
  if (_answerService) return _answerService;
  const db = dbHolder.db;
  if (!db) return null;                  // DB still locked / pre-unlock
  const embedClient = makeOllamaEmbedClient({ /* same shape as IndexWorker */ });
  const vectorStore = openVectorStore(db, logger);   // Phase 7 prior art
  const llm = makeAnswerLlmInvocation({ router: getRouter() });
  _answerService = createAnswerService({
    db, logger, embedClient, vectorStore,
    llm,
    getActiveEmbedModelId: () => readActiveModelId(db),
    accountStatus: makeAccountStatusLookup(db),
  });
  return _answerService;
}

// And:
registerRagHandlers(ipcMain, {
  logger, dbHolder,
  getAnswerService: getOrCreateAnswerService,
  getAccountStatus: makeAccountStatusLookup(dbHolder.db ?? null),
});
```

**Verification:** the existing `return { kind: 'error', text: 'Q&A service not ready' }` branch in `src/main/ipc/rag.ts:192` is the canary. After wiring, `RAG_ASK` against a real Ollama returns `{ kind: 'answer' | 'refusal' | 'disambiguation' }` instead. The Phase 7 `/ask` Playwright spec that was previously skipped (per MEMORY: `project_aria_phase3_executed`) becomes runnable.

### Anti-Patterns to Avoid

- **Don't add a second cron registry.** All Phase 8 jobs go into the existing `scheduler.cronRegistry`. Two registries means two suspend-handler chains and the registry-size invariant becomes meaningless.
- **Don't write signals from the renderer.** Renderer fires an IPC; the main process writes after redaction. Signals MUST pass through `redactAllPii` before insertion. LEARN-02 (local-only) is enforced at the network boundary, not at write time, but redacting at write time is defence-in-depth for any future opt-in telemetry.
- **Don't ship "differential updates" custom logic.** electron-updater's default delta path is sufficient for v1. CONTEXT explicitly defers anything beyond defaults.
- **Don't ship a separate "audit-log materialized table" without sunset criteria.** If you do go materialized, you commit to a 4-way write fan-out (send / calendar / todoist / approval-reject) that's a future Phase-4-Test-6-silent-write-failure waiting to happen.
- **Don't compute insights from frontier-routed prompts.** Aggregation is pure SQL; only prose generation invokes LLM. Mixing aggregation+prose into one LLM call is the failure mode INSIGHT-03 forbids.
- **Don't bundle electron-updater + electron-builder dev-only.** electron-updater is a *runtime* dependency, electron-builder is dev-only. Verify package.json before plan-04 ships.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Auto-update channel + signature verification | Custom HTTPS feed + checksum | `electron-updater` `github` provider | Handles `latest.yml`, signature verify against publisher cert, differential blockmaps |
| macOS notarisation submission + staple | `xcrun notarytool` shell scripts | electron-builder's `notarize: true` (delegates to `@electron/notarize`) | Builder retries on transient Apple notary 503s; staples for you |
| DOCX layout engine | Manual zip-up of OOXML parts | `docx` (dolanmiu) | Already standard per CLAUDE.md |
| PDF layout engine | `pdfkit` imperative draw calls | `@react-pdf/renderer` declarative | Same recap React tree renders to both DOCX (manual mapper) and PDF |
| Rich-text editor | Hand-rolled contentEditable | TipTap | contentEditable cross-browser inconsistencies are notorious; TipTap's ProseMirror foundation is battle-tested |
| Email response-time pairing (sent↔received) | Subject string heuristics | RFC 5322 `In-Reply-To` + `References` headers first; subject-match as fallback | Already populated in gmail_message rows per Phase 2 sync; check schema |
| Migration backup file format | Custom container | Existing `VACUUM INTO '<path>'` (Phase 1 `src/main/db/backup.ts`) | Same SQLCipher key, same cipher; on-disk round-trip already proven |
| OS-keychain access | Direct keytar/libsecret call | Electron `safeStorage` (Phase 1 prior art) | Already wired for frontier API keys; no new code |
| Cron schedule serialization | Custom CronJob class | `node-cron` `ScheduledTask` + `scheduler.cronRegistry` Map | Phase 2 invariant; new keys join the same registry |

**Key insight:** Phase 8 is 70% wiring across surfaces that already exist. The strongest pitfall is the temptation to re-architect (e.g. "unified scheduler service", "unified telemetry layer"). Resist it. Copy proven patterns line-by-line.

## Common Pitfalls

### Pitfall 1: Cron storm on multi-day wake (XCUT-01 generalised)
**What goes wrong:** Laptop sleeps Friday 6pm, wakes Monday 9am. Both insights-nightly (3 missed) AND recap-monday (1 missed) want to fire instantly. node-cron does NOT back-fire by default, but logic that says "if lastFiredYmd < today, run" *does* back-fire.
**How to avoid:** Same `_lastFiredYmd` dedupe as Phase 2 briefing. Resume callback calls `task.start()` only; no manual catch-up. User-facing "Run now" affordance in Settings for both insights and recap (mirrors briefing GenerateNowAffordance from Phase 2).
**Warning sign:** `scheduler.cronRegistry.size` changes during suspend/resume — invariant in tests.

### Pitfall 2: Insight prose payload leaking PII (INSIGHT-03 violation)
**What goes wrong:** Developer adds `topThemeExample: 'Q3 hiring plan for marketing'` (which contains a project name that could be sensitive) to the aggregates payload. Goes straight to frontier.
**How to avoid:** Static-grep ratchet identical to Phase 3 `assertApproved` / Phase 6 `pushApprovedMeetingActions`. Test that `insights/prose.ts` never imports from `gmail_message`, `calendar_event.summary`, `meeting_note_segment`, etc. — only from `insights` aggregate rows. Numeric-only `ProseOut` schema means schema-violation tests catch the structural leak.
**Warning sign:** `topThemes` field with values longer than ~30 chars (theme labels should be concise — clustering output, not source content).

### Pitfall 3: Migration rollback that doesn't actually roll back (XCUT-04)
**What goes wrong:** Backup is taken; migration runs; row-count check fails; restore copies `.ariabackup` over the live `.db` BUT the better-sqlite3 handle is still open against the old fd. Subsequent writes go to the orphaned-but-still-mapped old file. Next launch sees the restored file as if migration succeeded.
**How to avoid:** Migration backup wrapper must (a) take the backup BEFORE opening any other handle, (b) on rollback: `db.close()` FIRST, then `fs.renameSync` the backup over the live file, then re-`openDb`. Never `fs.copyFile` over an open SQLite handle.
**Warning sign:** integration tests pass but a manual "kill app between migration and verify" shows post-mortem data corruption.
**Reference:** Phase 1 onboarding seal-not-atomic post-mortem in MEMORY (`project_aria_seal_not_atomic`) is the exact failure shape generalized.

### Pitfall 4: macOS notarisation staple failure (XCUT-05 / SC-5)
**What goes wrong:** electron-builder uploads to notarytool, polls, receives success, but `xcrun stapler` fails because the build is asar-packed and the inner Mach-O hasn't been signed-then-zipped in the right order. Notarized but unstapled apps still launch on networked Macs but display the "verify with Apple" Gatekeeper dialog on first launch — exactly the SC-5 fail mode.
**How to avoid:** Always run `spctl --assess --verbose=4 build/mac-arm64/Aria.app` in the release smoke test. If it doesn't print "accepted, source=Notarized Developer ID", the staple is missing.
**Warning sign:** notary log says success but Gatekeeper still warns first launch.

### Pitfall 5: SmartScreen reputation regression on every release (Windows GA)
**What goes wrong:** First OV-signed build: SmartScreen warns. After ~3000 cumulative installs across all clients with the same OV publisher, warnings clear. THEN you rotate to EV cert (or get a new OV cert), and the reputation counter resets — every build warns again.
**How to avoid (when Windows OV is acquired post-tester period):**
- Use **OV with publisher-name stability** — don't change `O=` in the cert subject across renewals.
- Submit each new release to Microsoft's [Defender file analysis](https://www.microsoft.com/en-us/wdsi/filesubmission) preemptively (queue ~24h before public release).
- Treat the first 1–2 GA releases as "expected to warn for new users" in the release notes; subsequent releases benefit from cumulative reputation.
**Source:** **[CITED: Microsoft Learn — SmartScreen for developers]** and electron-builder issue trackers; cross-verify before plan-04 commits any "no warning" promise.

### Pitfall 6: Recap LLM hallucinating audit-log entries
**What goes wrong:** LLM is given the raw audit log + asked to write a paragraph. It invents an action ("you also rescheduled the all-hands"). User reads the paragraph, trusts it, doesn't cross-check the list below.
**How to avoid:** Two-pass with cross-validation. Pass 1 generates paragraph from STRUCTURED action list only (not prose). Pass 2 validates every named action in the paragraph exists in the structured list (`every action mentioned in narrative.actionRefs[] must appear in audit_log[]`). Hallucinations get the narrative truncated. The list-below-narrative pattern is the trust anchor — CONTEXT explicitly says "List is the trust anchor; narrative is the readability layer."
**Warning sign:** LLM mentions actions whose `kind` doesn't match any row in the structured list.

### Pitfall 7: TipTap content not round-tripping to DOCX/PDF
**What goes wrong:** Recap is edited in TipTap (TipTap JSON output). DOCX export reads HTML output via `editor.getHTML()`. PDF reads the same. Inline annotations (mention nodes, marks) drop on conversion.
**How to avoid:** Define a single `RecapCanonical` JSON shape (zod schema) that both the editor saves into AND both exporters read from. `editor.getJSON()` → mapper → canonical; canonical → DOCX/PDF. Never let HTML be the intermediate format.
**Warning sign:** "format X looks good but format Y is missing the highlight" bug reports.

### Pitfall 8: Signal log unbounded growth
**What goes wrong:** Every approval edit, every briefing thumb, every recap section edit, every Q&A thumb is one row. After a year of active use → 100k–500k rows.
**How to avoid:** Default 90-day retention with explicit "Keep all signals forever" toggle in Settings → Learned Preferences (since CONTEXT says "signal log retained" and users may want it for replay). Nightly aggregator runs over the last 30 days only; older signals only consulted on explicit "Re-derive from full history".
**Open question to confirm with user:** is 90d a sane default? See Open Questions.

### Pitfall 9: electron-updater + EV cert on Windows (deferred but documenting)
**What goes wrong:** EV cert + electron-updater = the famous "yubikey unplug between sign passes" bug — every update build needs hardware token presence at sign time, killing CI automation.
**How to avoid:** CONTEXT picks OV not EV. Keep it that way for v1.x. If EV is ever required, plan for an out-of-CI manual signing step.

## Code Examples

### Pre-migration backup hook (Stream 4)

```typescript
// src/main/release/backup-hook.ts
// Source: extends src/main/db/migrations/runner.ts + src/main/db/backup.ts
import * as path from 'node:path';
import * as fs from 'node:fs';
import { runMigrations } from '../db/migrations/runner';
import { createBackup } from '../db/backup';

const CRITICAL_TABLES = [
  'gmail_message', 'calendar_event', 'meeting_note', 'meeting_action',
  'approval', 'send_log', 'calendar_action_log', 'rag_chunk',
];

export interface MigrationBackupOpts {
  dataDir: string;
  retainCount: number;     // CONTEXT says 5
}

export function runMigrationsWithBackup(
  db: Database.Database,
  liveDbPath: string,
  opts: MigrationBackupOpts,
): { applied: number[]; backupPath: string | null } {
  const prevVersion = db.pragma('user_version', { simple: true }) as number;
  // 1. Snapshot
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(
    opts.dataDir, 'backups', `${stamp}-v${prevVersion}.ariabackup`,
  );
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  createBackup(db, { outPath: backupPath });
  pruneOldBackups(path.dirname(backupPath), opts.retainCount);

  // 2. Record critical-table counts (allowing intentional drops via opt-in flag)
  const preCounts = new Map<string, number>();
  for (const t of CRITICAL_TABLES) {
    try {
      preCounts.set(t, (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as any).n);
    } catch { /* table may not exist pre-migration; record 0 */ preCounts.set(t, 0); }
  }

  // 3. Apply
  let applied: number[] = [];
  try {
    applied = runMigrations(db);
  } catch (err) {
    // Pure throw path — let the caller decide to restore.
    throw new MigrationFailedError(err, backupPath);
  }

  // 4. Verify counts (each critical table: post >= pre, allowing schema-intentional row drops via DROP_OK env)
  for (const t of CRITICAL_TABLES) {
    let postCount = 0;
    try { postCount = (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as any).n; }
    catch { /* table dropped intentionally — allowed via a per-migration `expects_drop:<table>` directive */ }
    const preCount = preCounts.get(t) ?? 0;
    if (postCount < preCount && !migrationExpectsDrop(t, applied)) {
      throw new RowCountDriftError(t, preCount, postCount, backupPath);
    }
  }
  return { applied, backupPath };
}
```

### Monday recap cron registration (Stream 2)

```typescript
// src/main/recap/schedule.ts
// Source: derived from src/main/briefing/schedule.ts
const CRON_KEY = 'recap-monday';
let _lastFiredIsoWeek: string | null = null;

export function scheduleWeeklyRecap(
  tz: string,
  runForWeek: (isoWeek: string, weekStartYmd: string) => Promise<void>,
  deps: { scheduler: SchedulerHandle; logger: Logger },
) {
  // Monday 08:00 local — `0 8 * * 1`
  const expr = '0 8 * * 1';
  const task = cron.schedule(expr, async () => {
    const now = new Date();
    const isoWeek = computeIsoWeek(tz, now);     // e.g. "2026-W20"
    if (_lastFiredIsoWeek === isoWeek) return;
    _lastFiredIsoWeek = isoWeek;
    const weekStart = computeMondayYmd(tz, now);
    await runForWeek(isoWeek, weekStart);
  }, { timezone: tz });
  deps.scheduler.cronRegistry.set(CRON_KEY, task);
  registerLifecycleCallbacks({
    onSuspend: () => deps.scheduler.cronRegistry.get(CRON_KEY)?.stop(),
    onResume:  () => deps.scheduler.cronRegistry.get(CRON_KEY)?.start(),
  });
  return task;
}
```

### electron-updater wiring (Stream 4)

```typescript
// src/main/release/updater.ts
// Source: electron-updater docs (electron.build/auto-update) + Phase 1 pino patterns
import { autoUpdater } from 'electron-updater';
import { dialog, BrowserWindow } from 'electron';
import type { Logger } from 'pino';

export function startAutoUpdater(deps: { logger: Logger; window: () => BrowserWindow | null }) {
  autoUpdater.logger = {
    info:  (m) => deps.logger.info({ scope: 'updater' }, String(m)),
    warn:  (m) => deps.logger.warn({ scope: 'updater' }, String(m)),
    error: (m) => deps.logger.error({ scope: 'updater' }, String(m)),
    debug: () => {},
  };
  autoUpdater.autoDownload = false;             // user-prompted download
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (info) => {
    deps.window()?.webContents.send('updater:available', info);
  });
  autoUpdater.on('download-progress', (p) => {
    deps.window()?.webContents.send('updater:progress', p);
  });
  autoUpdater.on('update-downloaded', () => {
    deps.window()?.webContents.send('updater:downloaded', null);
  });
  // Channel naming — see Open Questions: stable / beta / tester.
  // For v1 tester window, ship channel='tester' so testers' app pulls from
  // a separate GitHub Release stream; switch to 'stable' at GA.
  autoUpdater.channel = process.env['ARIA_UPDATE_CHANNEL'] ?? 'tester';
  autoUpdater.checkForUpdates().catch((e) => deps.logger.warn({ scope: 'updater', err: e.message }, 'check failed'));
}
```

### electron-builder config skeleton (Stream 4)

```jsonc
// package.json "build" — extended (current shape only has asarUnpack; Phase 8 adds the rest)
{
  "build": {
    "appId": "com.aria.desktop",
    "productName": "Aria",
    "publish": [{ "provider": "github", "owner": "<repo-owner>", "repo": "Aria" }],
    "mac": {
      "category": "public.app-category.productivity",
      "hardenedRuntime": true,
      "gatekeeperAssess": false,
      "entitlements": "build/entitlements.mac.plist",
      "notarize": { "teamId": "<APPLE_TEAM_ID>" }
    },
    "win": {
      // Stream 4 staged: v1 tester build OMITS sign block entirely.
      // GA build re-adds:
      //   "certificateFile": "build/codesign.pfx",
      //   "certificateSubjectName": "<OV publisher CN>",
      //   "signingHashAlgorithms": ["sha256"]
      "target": ["nsis"]
    },
    "nsis": { "oneClick": false, "perMachine": false, "allowToChangeInstallationDirectory": true },
    "asarUnpack": [
      "**/node_modules/sqlite-vec/dist/native/**",
      "**/node_modules/sqlite-vec-darwin-x64/**",
      "**/node_modules/sqlite-vec-darwin-arm64/**",
      "**/node_modules/sqlite-vec-linux-x64/**",
      "**/node_modules/sqlite-vec-windows-x64/**"
    ]
  }
}
```

## Runtime State Inventory

> Phase 8 is primarily additive (new tables/views/cron jobs) — but the release stream touches OS-registered + installed state.

| Category | Items Found | Action Required |
|---|---|---|
| Stored data | New tables: `insights`, `weekly_recap`, `weekly_recap_section`, `learning_signals`, `learned_preferences`. New VIEW: `action_audit_log`. All in single migration 128. | Migration applied via existing runner; pre-migration backup wraps it (Stream 4). |
| Live service config | **GitHub repo Release settings** — token scope for `electron-builder --publish` (`GH_TOKEN` env), repository visibility (must be public OR token has repo scope). | Plan must document GH PAT scope requirements in OPS.md / release runbook. |
| OS-registered state | After install: macOS LaunchServices registers `Aria.app`; Windows registers an Uninstaller key under `HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\` and a Start Menu shortcut; Linux drops a `.desktop` file. All handled by electron-builder defaults. | None during dev. Test: clean uninstall + reinstall on each platform; verify no orphan registry keys. |
| Secrets / env vars | New: `GH_TOKEN` (publish), `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` (macOS notarize), `ARIA_UPDATE_CHANNEL` (runtime). | Document in `.env.example`; never log values; planner: add to release runbook. |
| Build artifacts | `out/` (dev build), `build/` (release output — already present per gitStatus showing `?? build/`). On version bump, `latest.yml`/`latest-mac.yml`/`blockmap` files are produced + uploaded to GH Release. | Add `build/` to `.gitignore` if not already; verify CI doesn't commit it. |

## Phase 7 Boot-Wiring Closure (Stream 4 sub-task)

This is its own callout because the verifier can flag it independently as a Phase 7 success-criterion regression risk.

**Current state (verified 2026-05-20 by grep):**
- `src/main/rag/answer-service.ts:218` exports `createAnswerService(deps: AnswerServiceDeps): AnswerService`.
- `src/main/ipc/rag.ts:48` declares `getAnswerService?: () => AnswerService | null` as an optional dep.
- `src/main/ipc/rag.ts:191–192` returns `{ kind: 'error', text: 'Q&A service not ready' }` when the factory is absent.
- `src/main/ipc/index.ts:342` calls `registerRagHandlers(ipcMain, { logger, dbHolder })` — `getAnswerService` is **not** passed.
- `RAG_ASK` is therefore dark in production.

**Closure (in plan 08-04, before final E2E):**
1. Construct factory inside `registerHandlers` (see Pattern 4 code sketch above).
2. Factory must be lazy + memoised — `dbHolder.db` may be null until unlock; first call after unlock builds the service.
3. `getAccountStatus` injection: lift the existing per-provider account lookup (used by `provider-accounts` IPC) so citation chips get `disconnected: true` correctly.
4. Verify the final-E2E item 6 ("Run a RAG query and verify citations open the source") now succeeds against a real Ollama, not a `Q&A service not ready` mock.
5. Add a smoke test (Playwright `_electron`) that opens `/ask`, types a question with at least one chunk in the index, and asserts the answer is NOT `Q&A service not ready`.

**Cross-reference:** MEMORY `project_aria_phase3_executed` documents Phase 3's CR-01 gate fail-OPEN as an unresolved BLOCKER. **Do NOT confuse it with this RAG_ASK gap** — different chokepoints. The Phase 3 CR-01 hardening is tracked separately in `03-05-gate-and-classifier-hardening` (still open per STATE.md). Plan 08-04 must NOT subsume it; document the dependency and proceed.

## State of the Art (release engineering specifically)

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| `electron-osx-sign` + `electron-notarize` separate steps | electron-builder built-in `notarize: { teamId }` field | builder 24+ (2023) | Plan must use the unified `notarize` field — not the legacy plugins (older Stack Overflow answers point to the deprecated path). |
| `xcrun altool` for notary | `xcrun notarytool` (App Store Connect API) | Apple deprecated altool late 2023 | electron-builder >=24 already calls notarytool — but ensure CI Xcode is >= 13. |
| keytar for code-sign cert storage | OS keychain access via OS-native cert store (`certificateSubjectName`) | keytar archived 2023 | Already aligned with CLAUDE.md. |
| Stripe `electron-builder-publisher-s3` plugin | Built-in S3 / generic / github provider | n/a (always built-in) | CONTEXT picks `github`; swap to S3/R2 is `publish.provider` change only. |

**Deprecated:**
- `xcrun altool` (notarisation) — replaced by `notarytool`.
- `electron-builder-publisher-s3` external plugin — built-in `s3` provider exists.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | TipTap is the right recap editor for solo-dev velocity in 2026 | Standard Stack, Pitfall 7 | If TipTap has churned (it's been stable years), swap to Lexical. Cost: pick + plan; no architectural impact since canonical JSON shape sits between editor and exporter. |
| A2 | k-means over nomic embeddings produces semantically useful theme clusters on Aria-scale corpora (~hundreds of items/week) | Architecture Patterns | If clustering is noisy, swap to LLM-summarized "top themes" via a single generateObject call — same routing posture as INSIGHT-03 (themes are aggregate labels, not source content). Cost: one task slip. |
| A3 | SmartScreen reputation accrues per-publisher-CN, not per-binary-hash | Pitfall 5 | If accrual is per-hash, every release re-warns — affects Stream 4 GA timing but does NOT block v1 tester ship. |
| A4 | electron-updater `channel = 'tester'` segregation lets tester and stable streams coexist on the same GH Release | Code Examples / Open Q | If channels need separate releases, plan-04 spawns two release pipelines (more CI work). |
| A5 | 90-day default retention for `learning_signals` is acceptable to user | Pitfall 8 | If user wants longer default, change one constant — no architectural impact. Confirm at discuss step or accept as Claude's discretion. |
| A6 | The `approval` table's `state='rejected'` is the only "declined" pathway worth surfacing in the audit log (no separate "snoozed-then-expired" terminal state) | Pattern 2 SQL VIEW | If expired-snoozed approvals exist, add a 5th UNION ALL arm. Cheap. |
| A7 | Phase 5 Outlook send chokepoint, when it lands, will write to `send_log` with `provider='microsoft'` (i.e. the existing `send_log` row shape is provider-generic) | Pattern 2 SQL VIEW | Verify by reading current send_log usage in `src/main/integrations/google/sendLog.ts` and `src/main/integrations/send.ts`. If Outlook writes to a different table, the VIEW needs an extra UNION arm before Phase 5 ships. |

## Open Questions

1. **Materialized table vs VIEW for `action_audit_log`**
   - What we know: Three independent tables exist (`send_log`, `calendar_action_log`, `meeting_action_task_link`+`todoist_task`) plus `approval.state='rejected'`. A VIEW UNION can express the unified shape with zero migration cost.
   - What's unclear: Recap-render performance at scale (12-week recap reading ~hundreds of rows is trivial; a year of usage is still trivial).
   - Recommendation: **Ship VIEW.** Add a perf assertion in tests (recap-week query < 200ms). Materialize only if it ever fails.

2. **Signal log retention default (default-90d vs default-forever)**
   - What we know: CONTEXT says "signal log retained" — does not say how long.
   - Recommendation: Default 90 days with explicit "Keep forever" toggle. Confirm with user at plan-checker. Easy to change.

3. **Auto-update channel naming**
   - Tester window: `channel = 'tester'`, GA: `channel = 'stable'`. Plan must decide whether each push creates one GH Release (with `prerelease=true` flipping at GA) or two parallel release streams.
   - Recommendation: **Single repo + GitHub Release `prerelease=true` for tester builds, flip at GA.** electron-updater honours `prerelease` via channel; simpler.

4. **AnswerService eager vs lazy construction**
   - Eager (at unlock): boot delay (~Ollama probe), but first RAG_ASK is instant.
   - Lazy (first ask): cold-start latency on first question (~1–2s).
   - Recommendation: **Lazy + memoised** (Pattern 4). Mirrors how IndexWorker initialises.

5. **Pre-migration backup retention count**
   - CONTEXT says "Keep last 5". Confirm folder bound by disk usage in worst case (5 × max DB size).
   - Recommendation: **5 stands**, but add a soft warning in Settings → Backups if folder > 1GB.

6. **Insight 14-day gate enforcement point (query-time vs write-time)**
   - Query-time: `insights/gate.ts` short-circuits before any compute.
   - Write-time: nightly aggregator simply doesn't insert rows < 14d.
   - Recommendation: **Both.** Query-time gate is the user-visible "Insights unlock in X days" copy; write-time is the safety net so a misconfigured cron can't produce premature rows.

7. **Recap export font embedding**
   - `@react-pdf/renderer` needs explicit `Font.register` for non-default fonts; `docx` needs the font available on the rendering machine for layout. v1 ship with default fonts (Helvetica/Calibri equivalents) and no custom embedding.
   - Recommendation: defer custom fonts to Phase 9 (product UI rollout).

8. **AV runbook scope**
   - CONTEXT says "Documented in PROJECT.md / OPS.md". OPS.md doesn't exist yet.
   - Recommendation: Create `docs/RELEASE-RUNBOOK.md` in plan 08-04 — covers GH token scope, notarytool creds, AV submission portals, SmartScreen seeding strategy, channel flip from `tester`→`stable`.

9. **Where does the briefing thumbs-up/down (BRIEF-05) actually live?**
   - The CONTEXT decision says briefing per-section chips feed signals. The Phase 2 briefing today has a `briefing_item_dismissed` table but no thumbs.
   - Recommendation: Plan 08-03 adds `BRIEFING_FEEDBACK` IPC + new column on the dismiss table (or a parallel `briefing_feedback` table). Researcher hasn't found evidence of existing thumbs scaffold — confirm by reading `BriefingScreen.tsx`.

10. **Where does Q&A thumbs-up/down (Stream 3) attach?**
    - `rag_turn` table already exists per Phase 7 (`src/main/db/migrations/embedded.ts:1033`). Add a nullable `thumb` column (`-1 | 0 | 1`) or a separate `rag_turn_feedback` table.
    - Recommendation: column on `rag_turn` keeps it cheap; signal-log writer reads on update.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| `electron-builder` | Stream 4 packaging | ✓ (devDep) | `^26.0.0` | — |
| `electron-updater` | Stream 4 auto-update | **MISSING from package.json** | — | Add as runtime dep in plan 08-04 wave 1 |
| `docx` (dolanmiu) | Stream 2 export | **MISSING from package.json** | — | Add as runtime dep |
| `@react-pdf/renderer` | Stream 2 export | **MISSING from package.json** | — | Add as runtime dep |
| `@tiptap/core` + `@tiptap/react` + `@tiptap/starter-kit` | Stream 2 editor | **MISSING from package.json** | — | Add as deps; if discuss/plan-check rejects TipTap, swap to Lexical |
| `node-cron` | Streams 1+2 schedules | ✓ | `^4.0.0` | — |
| `p-queue` | LLM-call serialization | ✓ | `^9.0.0` | — |
| `zod` | Schemas | ✓ | `^4.0.0` | — |
| `ai` (AI SDK) | `generateObject` for prose | ✓ | `^6.0.0` | — |
| `@electron/notarize` | macOS notarize | (transitive via electron-builder) | — | electron-builder pulls it; no direct dep needed |
| Apple Developer ID cert + notary credentials | macOS signing/notarize | ✗ (user must acquire) | — | Block at plan-08-04; CONTEXT says cert acquired at v1 release |
| OV cert (Windows) | Windows signing (GA only) | ✗ (deferred per amended XCUT-05) | — | Tester ship is unsigned; document acquisition in runbook |

**Missing dependencies with no fallback:** Apple Developer ID cert (must be acquired before macOS GA).
**Missing dependencies with fallback:** TipTap (swap to Lexical if needed).

## Validation Architecture

### Test Framework
| Property | Value |
|---|---|
| Framework | Vitest 4 (unit) + Playwright 1.60 (`_electron`, E2E) |
| Config file | `vitest.config.ts` (verify), `playwright.config.ts` |
| Quick run | `pnpm test:unit` (or `vitest run --passWithNoTests`) |
| Full suite | `pnpm test` (unit then E2E) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| INSIGHT-01 | 14-day gate enforced before any insight surfaces | unit | `vitest run src/main/insights/gate.test.ts` | ❌ Wave 0 |
| INSIGHT-02 | Insights appear in briefing payload + recap | integration | `vitest run src/main/insights/aggregate.integration.test.ts` | ❌ Wave 0 |
| INSIGHT-03 | Prose payload contains numerics + labels only; no raw content | static-grep + unit | `pnpm grep:insight-prose-no-raw && vitest run src/main/insights/prose.test.ts` | ❌ Wave 0 |
| RECAP-01 | All 5 sections present in recap payload | unit | `vitest run src/main/recap/generate.test.ts` | ❌ Wave 0 |
| RECAP-02 | "What Aria did" populated from `action_audit_log` view | integration | `vitest run src/main/recap/audit-view.integration.test.ts` | ❌ Wave 0 |
| RECAP-03 | Edit feedback writes signal | unit | `vitest run src/main/learning/sources/recap.test.ts` | ❌ Wave 0 |
| RECAP-04 | DOCX + PDF export non-empty, parseable | unit | `vitest run src/main/recap/export/docx.test.ts src/main/recap/export/pdf.test.ts` | ❌ Wave 0 |
| LEARN-01 | Signals captured from all four sources | integration | `vitest run src/main/learning/aggregate.integration.test.ts` | ❌ Wave 0 |
| LEARN-02 | No signal write reaches network (grep + Sentry beforeSend allowlist) | static-grep | `pnpm grep:no-network-from-signals` | ❌ Wave 0 |
| LEARN-03 | Per-field reset zeroes the field but retains signals | unit | `vitest run src/main/learning/prefs.test.ts` | ❌ Wave 0 |
| BRIEF-02 / BRIEF-04 / BRIEF-05 | Briefing prefs/news topics/feedback wired | integration | `vitest run src/renderer/features/briefing/feedback.test.tsx` | ❌ Wave 0 |
| XCUT-02 | Drafts persist across simulated crash, never auto-`sent` | E2E (existing harness) | `playwright test e2e/xcut-02-draft-crash.spec.ts` | ❌ Wave 0 |
| XCUT-04 | Pre-migration backup + restore on row-count drift | unit + integration | `vitest run src/main/release/backup-hook.test.ts && vitest run src/main/release/verify-migration.integration.test.ts` | ❌ Wave 0 |
| XCUT-05 (amended) | macOS notarized; Windows tester-unsigned (smoke documents the gap) | release smoke (manual + automated `spctl --assess`) | shell: `spctl --assess --verbose=4 build/mac-arm64/Aria.app` | ❌ Wave 0 |
| SC-1..5 | Full happy-path E2E (7 steps from CONTEXT integration tests) | E2E | `playwright test e2e/phase8-happy-path.spec.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test:unit` (targeted file)
- **Per wave merge:** `pnpm test:unit` (full suite)
- **Phase gate:** `pnpm test` (unit + E2E) green; plus `spctl --assess` on macOS build artefact; plus manual smoke of installer on Win + macOS.

### Wave 0 Gaps
- [ ] `vitest.config.ts` — verify it picks up `src/main/{insights,recap,learning,release}/**/*.test.ts`
- [ ] `playwright.config.ts` — ensure `phase8-happy-path.spec.ts` runs against packaged build, not dev
- [ ] `scripts/grep-insight-prose-no-raw.mjs` — static-grep ratchet
- [ ] `scripts/grep-no-network-from-signals.mjs` — static-grep ratchet
- [ ] Test scaffolding for all 14 file gaps above

## Security Domain (security_enforcement default = enabled)

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | no (no new auth surfaces in Phase 8) | — |
| V3 Session Management | no | — |
| V4 Access Control | yes | OS user owns the userData dir; new `learned_preferences`/`learning_signals` tables inherit SQLCipher whole-DB encryption (no per-row ACL needed — single-user app per CONTEXT). |
| V5 Input Validation | yes | All IPC inputs validated by zod schemas (recap edits, prefs reset payloads, updater channel toggles). Same `generateObject` pattern as Phase 2/7. |
| V6 Cryptography | yes | SQLCipher key still in OS keychain via `safeStorage` (Phase 1). Backup files share same key (VACUUM INTO preserves key). **Never hand-roll any crypto in Phase 8** — including the manifest signature for updates (electron-updater handles it). |
| V7 Logging & Error Handling | yes | `redactObject` + pino redaction allowlist for all new log lines (insights, recap, signals). Sentry `beforeSend` allowlist enforces LEARN-02. |
| V11 Business Logic | yes | Approval-chokepoint pattern from Phase 3/4/6 generalises: signal capture happens AFTER user action commits, never speculatively. |

### Known Threat Patterns for {Electron 41 desktop + SQLCipher + LLM router}

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Local PII leaking to frontier via insight payload | Information Disclosure | INSIGHT-03 grep ratchet on `insights/prose.ts` imports |
| Recap LLM hallucinating audit-log rows | Tampering (of perceived truth) | Two-pass narrative validation against structured list (Pitfall 6) |
| Signal log exfiltration via opt-in Sentry | Information Disclosure | `beforeSend` allowlist; default-off; document in release runbook |
| Auto-update MITM (rogue `latest.yml`) | Tampering | electron-updater verifies signed update against the publisher cert chain — only works when builds are signed; aligns with macOS notarize at v1 and Windows OV at GA. **Windows unsigned-tester window has elevated MITM risk; document explicitly to testers in tester onboarding.** |
| Migration backup readable by other OS users | Information Disclosure | Backup file inherits userData dir permissions (single-user OS dir on macOS/Win); chmod 600 enforced on Linux best-effort. |
| Frontier API key exposed in updater logs | Information Disclosure | Updater log scope `'updater'` already redacted; no token in updater URLs |

## Sources

### Primary (HIGH confidence)
- `CLAUDE.md` — Aria tech stack constraints, locked versions, signing recommendations
- `.planning/phases/08-insights-weekly-recap-learning-release-prep/08-CONTEXT.md` — Locked decisions for Phase 8
- `.planning/REQUIREMENTS.md` — INSIGHT/RECAP/LEARN/BRIEF/XCUT requirement texts
- `.planning/ROADMAP.md` — Phase 8 goal, success criteria, plan estimates
- `src/main/lifecycle/scheduler.ts`, `src/main/lifecycle/powerMonitor.ts`, `src/main/briefing/schedule.ts` — Phase 1/2 cron + suspend/resume invariants (CRITICAL prior art)
- `src/main/db/migrations/runner.ts`, `src/main/db/backup.ts` — migration runner shape + VACUUM INTO backup primitive (Stream 4 backup hook builds on these)
- `src/main/db/migrations/embedded.ts` — current table inventory (`send_log`, `calendar_action_log`, `meeting_action_task_link`, `todoist_task`, `approval`) feeding the unified VIEW
- `src/main/rag/answer-service.ts`, `src/main/ipc/rag.ts` — AnswerService factory shape; closure path for Stream 4
- `src/main/briefing/generate.ts` — Phase 2 `generateObject + Zod + router` pattern (Stream 1 prose copies this shape)
- `package.json` — current deps incl. `electron-builder ^26`, `node-cron ^4`, `p-queue ^9`, `ai ^6`, `zod ^4`

### Secondary (MEDIUM confidence)
- electron-builder docs (`electron.build/auto-update`, `electron.build/configuration/mac`, `electron.build/configuration/win`) — verified WebFetch not required (CLAUDE.md is authoritative for Aria's target versions; defer fetch to plan-checker if Versions change)
- electron-updater docs (`github` provider, channel + prerelease semantics)
- `@electron/notarize` README — staple + notarytool flow

### Tertiary (LOW confidence — explicit flags)
- SmartScreen reputation accrual mechanics (Pitfall 5) — Microsoft's own docs are vague; the practical guidance is community wisdom. **Confirm before promising SC-5 timing in plan 08-04.** [ASSUMED A3]
- TipTap as the right editor in 2026 — based on 2024–25 ecosystem snapshot. [ASSUMED A1]
- k-means quality on nomic embeddings for theme clustering at Aria scale. [ASSUMED A2]

## Metadata

**Confidence breakdown:**
- Stream 1 (Insights): HIGH on data + cron pattern reuse; MEDIUM on clustering choice (A2).
- Stream 2 (Recap): HIGH on VIEW shape (verified against existing migrations); MEDIUM on TipTap (A1).
- Stream 3 (Learning): HIGH on schema + cron pattern; HIGH on local-only invariant via existing redaction stack.
- Stream 4 (Release): HIGH on electron-builder/updater patterns (CLAUDE.md + existing package.json); MEDIUM on SmartScreen behaviour (A3); HIGH on AnswerService factory closure (verified by grep against current source).

**Research date:** 2026-05-20
**Valid until:** ~2026-06-20 (release-engineering ecosystem moves slowly; CLAUDE.md targets stable for foreseeable future). Re-verify Apple notarytool flow if Xcode major-version changes.
