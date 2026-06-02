# Phase 11: Research - Research

**Researched:** 2026-05-21
**Domain:** Web-backed research jobs, search provider APIs, versioned report rendering, transcript auto-detect
**Confidence:** HIGH (all key questions resolved from codebase inspection)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Standalone service — `src/main/ipc/research.ts` + `src/main/services/ResearchService.ts` + `src/main/services/SearchProviderService.ts`. NOT piggybacking RAG/Ask.
- 4 new DB tables: `research_job`, `research_report`, `research_report_section`, `research_feedback`
- Route `/research` added to `AppRoutes` + `READ_ONLY_ALLOW_LIST`; job creation + re-run gated by `assertEntitled` at IPC layer
- Search providers: **Brave Search API** (primary) + **Exa** (semantic/research-grade); both used per run; results merged and deduplicated by URL
- Jina Reader (`r.jina.ai/<url>`) fetches full page content; 10s timeout per URL, skip on fail
- Settings keys in safeStorage: `aria.research.braveApiKey` / `aria.research.exaApiKey`
- Settings → Integrations: two new rows "Research — Brave Search" + "Research — Exa"
- `research_job.status`: draft | running | done | failed
- `researchJobRun` is the single entry point that sets `job.status = 'running'` (static-grep ratchet)
- Post-ingest hook fires after `transcriptIngest` completes for auto-detect
- Auto-detect LLM failure is silent (no notification, no draft, logged locally)
- Two switchable views: **Document** and **Dashboard**
- Per-section feedback: thumbs up/down + "Add note" inline expander
- All report versions preserved
- IPC channels prefixed `aria:research:`
- `/research`: two-column (left rail 240px + right panel)
- Error handling: Brave/Exa rate limit → retry once after 2s; Jina timeout > 10s → skip URL; LLM synthesis fails → `report.status='failed'`

### Claude's Discretion
- Migration number (next after current highest — check existing migrations before assigning)
- Exact node-cron schedule string for daily/weekly refresh
- IPC push event mechanism for renderer notification (follow existing pattern in briefing/insights IPC)
- Exact Zod schema shape for `generateObject` synthesis call
- Brave Search API endpoint and Exa API endpoint (standard REST — follow existing provider pattern)
- Chart rendering library for coverage chart (follow existing UI patterns; recharts is likely already in use)

### Deferred Ideas (OUT OF SCOPE)
- SearXNG self-hosted search
- Research piggybacking RAG/Ask pipeline
- Real-time streaming report generation (SSE/websocket)
- Multi-user / shared research jobs
- PDF/DOCX export of research reports
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RES-01 | User can create a research job with title, goals, and domain tags | NewResearchJobModal + `researchJobCreate` IPC + `research_job` table |
| RES-02 | Research job runs via Brave Search API + Exa (either alone is sufficient); Jina Reader fetches full page content | SearchProviderService with graceful degradation; Jina fetch via Node fetch |
| RES-03 | Research job can be scheduled for daily or weekly automatic refresh | node-cron pattern from insights/briefing schedule.ts; `schedule_interval` + `next_run_at` on job |
| RES-04 | Aria auto-detects research topics from ingested transcripts and surfaces them as draft suggestions | Post-ingest hook in transcripts.ts after `ingestTranscriptNote`; briefing push notification via `emitToRenderer` |
| RES-05 | Research report renders in two switchable views: Document (sections + citations) and Dashboard (stat cards + coverage chart + findings grid) | ReportDocumentView + ReportDashboardView; coverage chart needs a chart library |
| RES-06 | User can leave per-section feedback (thumbs up/down + free-text note) | FeedbackBar + `researchFeedbackSave` IPC + `research_feedback` table |
| RES-07 | User can trigger a re-run incorporating consolidated feedback; all report versions preserved and navigable | `researchJobRun` with `feedbackContext`; version nav footer strip |
| RES-08 | If no API key is configured, research job creation is blocked with a clear prompt to add keys in Settings | UI-level key check before enabling "Start Research"; settings rows for both keys |
</phase_requirements>

---

## Summary

Phase 11 adds a standalone Research feature to Aria. The work is self-contained: 4 new DB tables, 2 new main-process services, 1 new IPC handler file, and a new renderer feature directory. It touches the transcript ingest path (one hook addition), the Settings Integrations section (two new key rows), the safeStorage layer (two new generic string keys), the route registry, and the sidebar nav.

The codebase inspection resolved all nine open questions from the phase brief. The highest-confidence findings are: the next migration number is **132**, the renderer push pattern is `webContents.send` via an `emitToRenderer` closure (identical to the entitlement and updater patterns), safeStorage stores research keys as entries in `providerTokens` record keyed by `aria.research.braveApiKey` / `aria.research.exaApiKey`, and the scheduler pattern is a direct copy of `insights/schedule.ts`. No chart library is currently installed — the planner must choose one or use a CSS-only bar.

**Primary recommendation:** Use the `insights/schedule.ts` pattern verbatim for research cron jobs, the `makeRendererEmitter` pattern for push events, the `providerTokens` subtree of `secrets.json` for the two API keys (no schema change to safeStorage required), and migration number 132 for all 4 new tables in one file.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| DB schema (4 tables) | Main process | — | SQLite writes are main-process only in Aria |
| Search provider calls (Brave, Exa, Jina) | Main process service | — | Network calls with secrets must never reach renderer |
| LLM synthesis via generateObject | Main process service | — | Frontier key lives in main-process safeStorage |
| IPC channels (research:*) | Main process | — | All IPC handlers in `src/main/ipc/` |
| Scheduled refresh (daily/weekly) | Main process (node-cron) | — | Follows existing cron pattern |
| Transcript post-ingest hook | Main process (transcripts.ts) | — | `ingestTranscriptNote` is synchronous; hook fires after it |
| Push notification to renderer | Main process → Renderer | — | `emitToRenderer` / `webContents.send` pattern |
| Report views (Document + Dashboard) | Renderer | — | React components reading IPC DTOs |
| Coverage chart | Renderer | — | Visualization component; no chart lib currently installed |
| Settings key input rows | Renderer (IntegrationsSection) | — | Follows existing integration row pattern |
| Route + nav entry | Renderer | — | AppRoutes + SideNav |
| API key storage | Main process (safeStorage) | — | providerTokens subtree, no schema change needed |

---

## Standard Stack

### Core (all already installed)
| Library | Version | Purpose | Source |
|---------|---------|---------|--------|
| better-sqlite3-multiple-ciphers | 12.x | DB reads/writes for 4 new tables | [VERIFIED: package.json] |
| ai (Vercel AI SDK) | 6.x | `generateObject` + Zod for synthesis and auto-detect | [VERIFIED: package.json] |
| node-cron | 4.x | daily/weekly refresh scheduling | [VERIFIED: package.json] |
| p-queue | 9.x | serialize LLM + search calls | [VERIFIED: package.json] |
| node-fetch / native fetch | Node 20 built-in | Brave, Exa, Jina HTTP calls | [VERIFIED: Node 20 includes fetch] |
| zod | bundled with ai | Schema for generateObject output | [ASSUMED: zod is a peer of `ai` package] |
| electron safeStorage | built-in | Store Brave + Exa keys encrypted | [VERIFIED: safeStorage.ts] |
| react / tailwind / editorial primitives | existing | ResearchScreen, modals, views | [VERIFIED: package.json + Phase 9] |

### New Dependency: Coverage Chart

No chart library is currently installed. [VERIFIED: package.json — no recharts, chart.js, or d3]

Options for the planner:

| Option | Package | Bundle impact | Recommendation |
|--------|---------|--------------|----------------|
| recharts | recharts | ~200KB gzip | Standard React chart library; good for horizontal bar |
| CSS-only bar | none | 0 | Simple `<div>` width-percentage bars; sufficient for horizontal bar |
| victory | victory | ~250KB | More complex |

**Recommendation:** Use CSS-only percentage bars for the coverage chart unless the spec explicitly requires animated/interactive charts. The coverage chart is a simple horizontal bar per domain — a styled `<div>` with `width: ${pct}%` is fully sufficient and avoids a new dependency. If the planner wants a real library, add `recharts` (`pnpm add recharts`). [ASSUMED: CSS-only is sufficient given the simple chart type]

### Installation (if recharts chosen)
```bash
pnpm add recharts
```

---

## Architecture Patterns

### System Architecture Diagram

```
Renderer: ResearchScreen
  ├── Left rail: job list (suggestions + jobs)
  └── Right panel: report view (Document | Dashboard | loading | error)
        └── FeedbackBar (per section)

IPC Bridge (aria:research:*)
  ├── researchJobCreate / List / Get / Update / Delete
  ├── researchJobRun → ResearchService.run()
  ├── researchReportGet / List
  ├── researchFeedbackSave
  └── researchSuggestions Get / Approve / Dismiss

Main Process: ResearchService
  ├── Calls SearchProviderService (Brave + Exa)
  ├── Calls Jina Reader per URL (10s timeout)
  ├── Calls LLM generateObject (synthesis)
  ├── Writes research_report + research_report_section
  └── Calls emitToRenderer(RESEARCH_REPORT_DONE, { jobId, reportId })

Main Process: SearchProviderService
  ├── Brave: fetch https://api.search.brave.com/res/v1/web/search
  ├── Exa: fetch https://api.exa.ai/search { type: 'neural' }
  └── Deduplicates by URL, returns top-N per provider

Main Process: transcripts.ts (hook addition)
  └── After ingestTranscriptNote → researchDetectTopics(db, noteId, emitToRenderer)

node-cron (per job with schedule_interval)
  └── CRON_KEY: 'research-refresh-{jobId}'
  └── At next_run_at interval: enqueue ResearchService.run() via scheduler.queue.add
```

### Recommended Project Structure
```
src/main/
├── ipc/research.ts                  # IPC handler registration
├── services/ResearchService.ts      # Core pipeline + auto-detect
├── services/SearchProviderService.ts # Brave + Exa abstraction
└── db/migrations/132_research.sql   # All 4 tables

src/renderer/features/research/
├── ResearchScreen.tsx               # Two-column shell
├── NewResearchJobModal.tsx          # Slide-over form
├── ReportDocumentView.tsx           # Document view
├── ReportDashboardView.tsx          # Dashboard view + coverage chart
├── FeedbackBar.tsx                  # Per-section feedback
└── RerunModal.tsx                   # Re-run with feedback
```

### Pattern 1: IPC Handler Registration (follow `src/main/ipc/index.ts`)

```typescript
// Source: verified from src/main/ipc/index.ts
const researchChannels = [
  CHANNELS.RESEARCH_JOB_CREATE,
  CHANNELS.RESEARCH_JOB_LIST,
  // ... all 11 channels
];
if (!researchChannels.every((c) => skip.has(c))) {
  registerResearchHandlers(ipcMain, {
    logger,
    dbHolder,
    scheduler: getScheduler(),
    emitToRenderer: makeRendererEmitter(deps.mainWindow ?? null),
  });
  researchChannels.forEach((c) => skip.add(c));
}
```

### Pattern 2: Renderer Push Events (follow `src/main/ipc/entitlement.ts`)

```typescript
// Source: verified from src/main/ipc/entitlement.ts makeRendererEmitter
export function makeRendererEmitter(win: BrowserWindow | null) {
  return (channel: string, payload?: unknown) => {
    try { win?.webContents?.send(channel, payload); } catch { /* torn down */ }
  };
}
// ResearchService receives emitToRenderer as a dep and calls:
emitToRenderer(CHANNELS.RESEARCH_REPORT_DONE, { jobId, reportId });
```

### Pattern 3: Cron Scheduling (follow `src/main/insights/schedule.ts` verbatim)

```typescript
// Source: verified from src/main/insights/schedule.ts
// CRON_KEY per job: `research-refresh-${jobId}`
// Daily: '0 6 * * *' (6am local); Weekly: '0 6 * * 1' (Monday 6am local)
// Same dedupe + suspend/resume lifecycle pattern
scheduler.cronRegistry.set(CRON_KEY, task);
```

Note: the insights schedule uses a SINGLE key for a global job. Research has one cron task PER job with a schedule. The key must encode the jobId: `research-refresh-${jobId}`. The planner should decide whether to use a Map keyed by jobId within a single registration or individual cronRegistry entries. [ASSUMED: individual cronRegistry entries per jobId is cleanest given existing pattern]

### Pattern 4: safeStorage for Research API Keys

The existing `providerTokens` subtree in `secrets.json` is a generic `Record<string, encrypted_string>` keyed by any string. [VERIFIED: safeStorage.ts `setProviderTokens` / `getProviderTokens`]

Research keys fit cleanly into this namespace:
```typescript
// Store:
setProviderTokens('aria.research.braveApiKey', rawKey);
// Read:
const key = getProviderTokens('aria.research.braveApiKey');
```

No schema change to `SecretsFile` is needed — `providerTokens` already accepts arbitrary keys. The legacy Google mirror logic only fires for keys starting with `google:`, so research keys are unaffected.

### Pattern 5: assertEntitled Gate

```typescript
// Source: verified from src/main/entitlement/gate.ts + briefing/generate.ts
import { assertEntitled } from '../entitlement/gate';

// In researchJobRun handler:
await assertEntitled(db, 'research_run');  // NEW action type to add to EntitlementAction union
// In researchJobCreate handler:
await assertEntitled(db, 'research_create'); // or reuse a single 'research_run' action
```

**Important:** `EntitlementAction` type in `gate.ts` is a closed union. Adding `'research_run'` and/or `'research_create'` requires editing `gate.ts`. The static-grep ratchet (`tests/static/single-entitlement-gate-site.test.ts`) checks call sites, not the union — adding new action strings is safe without touching the ratchet. [VERIFIED: gate.ts lines 29-35 show closed union]

### Pattern 6: Transcript Post-Ingest Hook

The hook must be added inside `registerTranscriptHandlers` in `src/main/ipc/transcripts.ts` after the `ingestTranscriptNote` call. The handler currently calls `createTaskBatchApprovalForNote` synchronously. The research hook should fire asynchronously (fire-and-forget) to avoid blocking the IPC response.

```typescript
// Source: verified from src/main/ipc/transcripts.ts
const result = ingestTranscriptNote(db, req);
const approval = createTaskBatchApprovalForNote(db, result.noteId);

// NEW — fire-and-forget research topic detection:
void detectResearchTopics(db, result.noteId, result.title, emitToRenderer).catch(
  (err) => logger.warn({ scope: 'research', err: String(err) }, 'auto-detect failed silently'),
);

return { ...result, taskBatchApprovalId: approval.approvalId, actionCount: approval.actionCount };
```

This requires `registerTranscriptHandlers` to accept `emitToRenderer` as a new dep. The `transcripts.ts` handler currently has no `emitToRenderer` dep — adding it is a minor signature change.

### Anti-Patterns to Avoid

- **Do not call `assertEntitled` from within ResearchService** — it must be called at the IPC layer (gate.ts comment + static-grep ratchet enforces gate at the boundary).
- **Do not set `job.status = 'running'` anywhere except `researchJobRun`** — static-grep ratchet will verify this.
- **Do not store raw API keys in SQLite** — keys go in safeStorage `providerTokens` only.
- **Do not import from `src/main/rag/`** — research pipeline is standalone per CONTEXT.md.
- **Do not fire the transcript hook synchronously** — it involves LLM calls and must be fire-and-forget.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP with timeout | Custom AbortController wrapper | `fetch` with `AbortSignal.timeout(10000)` | Node 20 built-in; 1 line |
| URL deduplication | Custom set logic | `new Map(results.map(r => [r.url, r]))` | 3 lines, no library |
| JSON synthesis schema | Manual parse | `generateObject` + Zod schema | AI SDK handles retry + parse |
| Cron scheduling | Custom timer | node-cron (already installed) | Suspend/resume lifecycle already solved |
| Secrets encryption | Custom crypto | `setProviderTokens` / `getProviderTokens` | Already in safeStorage.ts |
| IPC push events | WebSocket or polling | `webContents.send` via `emitToRenderer` | Already in entitlement/updater pattern |

---

## Key Findings: All Nine Open Questions Resolved

### Q1: Migration Number
**Answer: 132** [VERIFIED: codebase inspection]

Highest existing migration: `131_entitlement.sql`. Next is `132`. All 4 research tables should go in a single file `132_research.sql` (consistent with Phase 8 pattern of one file per phase stream).

### Q2: transcriptIngest Hook Point
**Answer: Inside `registerTranscriptHandlers` in `src/main/ipc/transcripts.ts`, after line 30** [VERIFIED: transcripts.ts]

The handler currently: calls `ingestTranscriptNote` → calls `createTaskBatchApprovalForNote` → returns. The hook fires after both, as a `void` fire-and-forget. `registerTranscriptHandlers` needs a new `emitToRenderer` dep added to `TranscriptHandlerDeps`.

### Q3: IPC Push Event Pattern
**Answer: `webContents.send` via `makeRendererEmitter` closure** [VERIFIED: entitlement.ts + updater.ts]

Pattern: `emitToRenderer(CHANNELS.RESEARCH_REPORT_DONE, { jobId, reportId })`. The `makeRendererEmitter` factory is already exported from `src/main/ipc/entitlement.ts`. ResearchService receives `emitToRenderer` as a constructor/function dep. The new channel constant `RESEARCH_REPORT_DONE` goes in `ipc-contract.ts` CHANNELS.

### Q4: Chart Library
**Answer: No chart library is currently installed** [VERIFIED: package.json]

The planner must choose: CSS-only bars (zero deps, recommended) or add `recharts`. See Standard Stack section above.

### Q5: safeStorage — Adding New Keys
**Answer: Use existing `setProviderTokens` / `getProviderTokens` with keys `aria.research.braveApiKey` and `aria.research.exaApiKey`** [VERIFIED: safeStorage.ts]

No schema change needed. The `providerTokens` record in `secrets.json` accepts any string key. The legacy Google mirror logic only fires for `google:*` prefix keys.

### Q6: node-cron Pattern for Scheduled Refresh
**Answer: Copy `src/main/insights/schedule.ts` structure** [VERIFIED: insights/schedule.ts]

Key difference: insights uses a single global CRON_KEY; research needs one per job. Use `research-refresh-${jobId}` as the cronRegistry key. Current `cronRegistry.size` invariant after Phase 8 is 6 (gmail-sync + calendar-sync + briefing + insights-nightly + learning-nightly + entitlement-check). Each scheduled research job adds one more entry. The planner should decide whether to document an updated invariant or remove the invariant check — removing is safer given dynamic per-job crons.

Cron expressions: daily = `'0 6 * * *'` (6am local), weekly = `'0 6 * * 1'` (Monday 6am local). [ASSUMED: 6am is a reasonable default for research refresh; can be hardcoded or made configurable]

### Q7: Existing Fetch Utilities
**Answer: No shared fetch utility exists in main process** [VERIFIED: codebase grep]

Each integration uses its own HTTP client (googleapis SDK, msal-node, etc.). For research, use Node 20's built-in `fetch` with `AbortSignal.timeout(10000)` for Jina calls. For Brave and Exa, plain `fetch` with API key headers.

### Q8: assertEntitled Call Points
**Answer: Call at IPC layer in `src/main/ipc/research.ts` for `researchJobRun` and `researchJobCreate`** [VERIFIED: gate.ts + briefing/generate.ts usage]

Must add `'research_run'` (and optionally `'research_create'`) to the `EntitlementAction` union in `gate.ts`. The static-grep ratchet at `tests/static/single-entitlement-gate-site.test.ts` checks that `assertEntitled` is only called from a whitelist of files — the planner must check whether `src/main/ipc/research.ts` needs to be added to that whitelist.

### Q9: shared/ipc-contract.ts Pattern for New DTOs
**Answer: Add new string constants to the `CHANNELS` object; add TypeScript interfaces for DTOs in the same file** [VERIFIED: ipc-contract.ts]

The file already has `CHANNELS` (object with string values), plus exported interfaces (`BriefingSettings`, `BriefingSummary`, etc.) and Zod schemas (`EntitlementActivateRequest`). Research DTOs follow the same pattern: add constants to CHANNELS, add `ResearchJobDto`, `ResearchReportDto`, `ResearchReportSectionDto` interfaces, and export `RESEARCH_REPORT_DONE` push-event channel.

---

## Common Pitfalls

### Pitfall 1: cronRegistry.size Invariant
**What goes wrong:** Phase 8 added a `cronRegistry.size === 6` invariant. Research adds dynamic per-job crons which break a fixed-size invariant.
**Why it happens:** Earlier phases hardcoded expected size as a correctness check.
**How to avoid:** Check whether the invariant exists in tests before adding research crons. If it does, remove or update it to `>= 6`. [VERIFIED: cronRegistry.size invariant mentioned in STATE.md Phase 8-03 notes]
**Warning signs:** `cronRegistry.size` assertion failures in test suite.

### Pitfall 2: TranscriptHandlerDeps Signature Change
**What goes wrong:** Adding `emitToRenderer` to `TranscriptHandlerDeps` breaks any test that constructs the deps object without it.
**Why it happens:** TypeScript will error on incomplete deps objects in tests.
**How to avoid:** Make `emitToRenderer` optional in `TranscriptHandlerDeps` with `?:` — then test callers need no changes, and the hook silently no-ops when emitToRenderer is absent.

### Pitfall 3: Running `job.status = 'running'` Outside researchJobRun
**What goes wrong:** Static-grep ratchet fails.
**Why it happens:** The spec mandates `researchJobRun` is the single entry point for status transitions to 'running'. Cron-triggered runs must call `researchJobRun` internally, not set status directly.
**How to avoid:** The cron callback calls `ResearchService.run(jobId, { trigger: 'schedule' })` which internally calls the same code path as the IPC handler. The IPC handler sets `running` status; the cron uses the same function.

### Pitfall 4: Secrets Stored in SQLite Instead of safeStorage
**What goes wrong:** API keys written to the DB are encrypted by SQLCipher but violate the secrets layer contract and are accessible to DB inspection tools.
**How to avoid:** Keys go in `providerTokens` via `setProviderTokens`. The renderer reads key presence via a new IPC channel `researchSecretsHas` that calls `getProviderTokens` and returns a boolean (never the raw key).

### Pitfall 5: Research IPC Not Registered in index.ts
**What goes wrong:** All handlers defined in `research.ts` but never called from `registerHandlers`.
**How to avoid:** Add the research channel block to `src/main/ipc/index.ts` following the exact pattern of every other registration block. The planner's Wave 0 task must include this wiring.

### Pitfall 6: EntitlementAction Union Not Extended
**What goes wrong:** `assertEntitled(db, 'research_run')` causes a TypeScript error because `'research_run'` is not in the `EntitlementAction` union.
**How to avoid:** Edit `src/main/entitlement/gate.ts` to add `'research_run'` to the union type. Also check the static-grep ratchet test file to see if it whitelists call sites by filename.

### Pitfall 7: report.status Never Set to 'failed' on LLM Error
**What goes wrong:** If `generateObject` throws, the report row stays in `'generating'` forever. The UI shows an infinite skeleton.
**How to avoid:** Wrap the entire synthesis step in try/catch; on catch, update `report.status = 'failed'` and set `error_message`. This is the same shape as Phase 6's `pushApprovedMeetingActions` silent-write failure.

---

## Code Examples

### CHANNELS additions for ipc-contract.ts
```typescript
// Source: pattern verified from src/shared/ipc-contract.ts
RESEARCH_JOB_CREATE: 'aria:research:job-create',
RESEARCH_JOB_LIST: 'aria:research:job-list',
RESEARCH_JOB_GET: 'aria:research:job-get',
RESEARCH_JOB_UPDATE: 'aria:research:job-update',
RESEARCH_JOB_DELETE: 'aria:research:job-delete',
RESEARCH_JOB_RUN: 'aria:research:job-run',
RESEARCH_REPORT_GET: 'aria:research:report-get',
RESEARCH_REPORT_LIST: 'aria:research:report-list',
RESEARCH_FEEDBACK_SAVE: 'aria:research:feedback-save',
RESEARCH_SUGGESTIONS_GET: 'aria:research:suggestions-get',
RESEARCH_SUGGESTION_APPROVE: 'aria:research:suggestion-approve',
RESEARCH_SUGGESTION_DISMISS: 'aria:research:suggestion-dismiss',
// Push event (renderer subscribe via ipcRenderer.on):
RESEARCH_REPORT_DONE: 'aria:research:report-done',
```

### generateObject Zod schema for synthesis
```typescript
// ASSUMED shape — planner should adjust fields
import { z } from 'zod';

const ResearchSynthesisSchema = z.object({
  summary: z.string().describe('3-5 sentence executive summary'),
  findings: z.array(z.object({
    heading: z.string(),
    body: z.string(),
    sourceUrls: z.array(z.string()),
  })).max(10),
  sources: z.array(z.object({
    title: z.string(),
    url: z.string(),
    domain: z.string(),
    relevance: z.string(),
  })).max(20),
  metrics: z.array(z.object({
    label: z.string(),
    value: z.string(),
  })),
  confidenceScore: z.number().min(0).max(100).describe('LLM self-rated confidence 0-100'),
});
```

### Jina Reader fetch with timeout
```typescript
// Source: Node 20 built-in fetch pattern
const response = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
  signal: AbortSignal.timeout(10_000),
  headers: { 'Accept': 'text/markdown' },
});
if (!response.ok) return null;
return response.text();
```

### Brave Search call
```typescript
// Source: Brave Search API docs (api.search.brave.com)
const response = await fetch(
  `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
  { headers: { 'X-Subscription-Token': braveApiKey, 'Accept': 'application/json' } },
);
```

### Exa search call
```typescript
// Source: Exa API docs (api.exa.ai)
const response = await fetch('https://api.exa.ai/search', {
  method: 'POST',
  headers: { 'x-api-key': exaApiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query, type: 'neural', numResults: 5 }),
});
```

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2 |
| Config file | vitest.config.ts (existing) |
| Quick run command | `npx vitest run tests/unit/research --passWithNoTests` |
| Full suite command | `npx vitest run --passWithNoTests` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RES-01 | Job create validates input, inserts row | unit | `npx vitest run tests/unit/research-service.spec.ts` | ❌ Wave 0 |
| RES-02 | Brave + Exa called; graceful degradation when one key missing | unit (MSW) | `npx vitest run tests/unit/search-provider-service.spec.ts` | ❌ Wave 0 |
| RES-02 | Jina fetch: timeout skips URL, continues | unit (MSW) | same file | ❌ Wave 0 |
| RES-02 | URL deduplication across providers | unit | same file | ❌ Wave 0 |
| RES-03 | Scheduled refresh: cron fires, new report version written | unit (mocked cron) | `npx vitest run tests/unit/research-service.spec.ts` | ❌ Wave 0 |
| RES-04 | Auto-detect: LLM extracts topics, inserts draft jobs | unit (MSW LLM) | same file | ❌ Wave 0 |
| RES-05 | Report renders Document view + Dashboard view toggle | UI (render) | `npx vitest run tests/unit/research-screen.spec.tsx` | ❌ Wave 0 |
| RES-06 | Feedback save writes research_feedback row | integration (real SQLite) | `npx vitest run tests/integration/research-ipc.spec.ts` | ❌ Wave 0 |
| RES-07 | Re-run creates new version; all versions navigable | integration | same file | ❌ Wave 0 |
| RES-08 | Button disabled with tooltip when both keys missing | UI | `npx vitest run tests/unit/research-screen.spec.tsx` | ❌ Wave 0 |
| Static ratchet | Only `researchJobRun` sets `job.status = 'running'` | static | `npx vitest run tests/static/research-running-ratchet.spec.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/unit/research-service.spec.ts tests/unit/search-provider-service.spec.ts --passWithNoTests`
- **Per wave merge:** `npx vitest run --passWithNoTests`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/research-service.spec.ts` — covers RES-01, RES-03, RES-04, RES-07
- [ ] `tests/unit/search-provider-service.spec.ts` — covers RES-02 (MSW mocking Brave, Exa, Jina)
- [ ] `tests/unit/research-screen.spec.tsx` — covers RES-05, RES-08
- [ ] `tests/integration/research-ipc.spec.ts` — covers RES-06, RES-07 against real SQLite
- [ ] `tests/static/research-running-ratchet.spec.ts` — static grep assertion
- [ ] `132_research.sql` migration fixture for integration tests

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | yes | `assertEntitled` at IPC layer for job creation + re-run |
| V5 Input Validation | yes | Zod schema on IPC input; max URL count; goals/title length limits |
| V6 Cryptography | yes | safeStorage (`setProviderTokens`) for Brave + Exa keys — never plaintext on disk |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Raw API key stored in SQLite | Information Disclosure | Keys in `providerTokens` safeStorage only; never in DB |
| Prompt injection via research results | Tampering | Jina page content treated as data context, not instructions; existing `<document>` XML wrapping pattern from RAG |
| SSRF via user-supplied supplement URLs | Elevation | Supplement URLs passed to Jina Reader via `https://r.jina.ai/<url>` — Jina is the actual fetcher, not Aria directly |
| LLM synthesis hallucination | Spoofing | Confidence score surfaced to user; all source URLs preserved for verification |
| Missing entitlement gate on re-run | Elevation | `assertEntitled` must be called in BOTH `researchJobCreate` and `researchJobRun` handlers |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node fetch | Brave/Exa/Jina HTTP | ✓ | Node 20 built-in | — |
| Brave Search API | RES-02 | API key required | — | Graceful degradation (Exa only) |
| Exa API | RES-02 | API key required | — | Graceful degradation (Brave only) |
| Jina Reader | RES-02 | Public, no key | ✓ | Skip URL on timeout |
| Frontier LLM | Synthesis + auto-detect | ✓ (key in safeStorage) | any provider | n/a — same as briefing |

**Missing dependencies with no fallback:** If both Brave and Exa keys are absent, job creation is blocked at UI (RES-08). This is the intended behavior, not a gap.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | CSS-only bars are sufficient for coverage chart | Standard Stack | Low — can add recharts in Wave 0 if stakeholder wants animation |
| A2 | 6am local time is a reasonable default for scheduled refresh | Architecture Patterns | Low — easily changed; not user-visible until they enable scheduling |
| A3 | Individual cronRegistry entries per jobId (not a single manager) | Architecture Patterns | Medium — if planner prefers a single scheduler entry, the implementation changes |
| A4 | `'research_run'` and `'research_create'` as new EntitlementAction values (vs reusing existing action) | Key Findings Q8 | Low — correct action name is a rename-only change |
| A5 | zod is available as a peer dep of the `ai` package | Standard Stack | Very low — zod is a direct dep of Vercel AI SDK |

---

## Open Questions (RESOLVED)

1. **Entitlement static-grep ratchet whitelist** — RESOLVED
   - What we know: `tests/static/single-entitlement-gate-site.test.ts` checks that `assertEntitled` is only called from whitelisted files.
   - Resolution: Plan 01 Task 1 reads the ratchet test and adds `src/main/ipc/research.ts` to the `GATED_SITES` whitelist before research.ts exists (RED state). The test turns GREEN in Wave 2 when research.ts is created with both `assertEntitled` calls. This is the established ratchet pattern from Phases 3, 4, 6.

2. **cronRegistry.size invariant** — RESOLVED
   - What we know: STATE.md mentions a fixed-size invariant after Phase 8.
   - Resolution: PATTERNS.md confirmed that existing size assertions are scoped per-feature (briefing `=== 3`, insights `=== 2`) and do not assert global registry size. Research adds per-job dynamic entries with key `research-refresh-${jobId}` — no existing fixed-size test will break. Plan 01 Task 2 greps for `cronRegistry.size` to confirm before adding research crons.

---

## Sources

### Primary (HIGH confidence)
- `src/main/ipc/transcripts.ts` — verified hook point for post-ingest auto-detect
- `src/main/ipc/entitlement.ts` — verified `makeRendererEmitter` pattern and `emitToRenderer` dep shape
- `src/main/ipc/index.ts` — verified IPC registration pattern for new handler blocks
- `src/main/secrets/safeStorage.ts` — verified `setProviderTokens`/`getProviderTokens` for research API keys
- `src/main/insights/schedule.ts` — verified cron scheduling pattern to copy
- `src/main/entitlement/gate.ts` — verified `assertEntitled` signature and `EntitlementAction` union
- `src/shared/ipc-contract.ts` — verified CHANNELS pattern for new constants
- `src/renderer/app/routes.tsx` — verified `READ_ONLY_ALLOW_LIST` and route registration pattern
- `package.json` — verified: no chart library installed; confirmed all core deps present
- `src/main/db/migrations/` directory listing — verified highest migration is 131; next is 132

### Secondary (MEDIUM confidence)
- Brave Search API: `https://api.search.brave.com/res/v1/web/search` — standard endpoint from CONTEXT.md specifics
- Exa API: `https://api.exa.ai/search` with `type: 'neural'` — standard endpoint from CONTEXT.md specifics
- Jina Reader: `https://r.jina.ai/<url>` — from CONTEXT.md specifics

### Tertiary (LOW confidence / ASSUMED)
- 6am as default cron time for scheduled research refresh [ASSUMED]
- CSS-only bars sufficient for coverage chart [ASSUMED]

---

## Metadata

**Confidence breakdown:**
- Migration number: HIGH — verified by directory listing
- Hook point in transcripts.ts: HIGH — verified line by line
- Push event pattern: HIGH — verified from entitlement.ts and updater.ts
- safeStorage pattern: HIGH — verified providerTokens is a generic Record
- Cron pattern: HIGH — verified insights/schedule.ts
- assertEntitled gate: HIGH — verified gate.ts union and call sites
- Chart library: HIGH (confirmed absent) / LOW for recommendation
- IPC-contract pattern: HIGH — verified structure

**Research date:** 2026-05-21
**Valid until:** 2026-06-21 (stable codebase; no external dependency churn)
