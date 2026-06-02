# Phase 11: Research - Pattern Map

**Mapped:** 2026-05-21
**Files analyzed:** 13 new/modified files
**Analogs found:** 13 / 13

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/main/db/migrations/132_research.sql` | migration | batch | `src/main/db/migrations/129_phase8_recap.sql` | exact |
| `src/main/ipc/research.ts` | IPC handler | request-response + event-driven | `src/main/ipc/insights.ts` | exact |
| `src/main/services/ResearchService.ts` | service | batch + event-driven | `src/main/insights/aggregate.ts` (pattern) + `src/main/briefing/schedule.ts` (cron) | role-match |
| `src/main/services/SearchProviderService.ts` | service | request-response | `src/main/integrations/todoist/client.ts` (external API client) | role-match |
| `src/main/entitlement/gate.ts` (modify) | config/type | — | self | exact |
| `src/main/ipc/index.ts` (modify) | config | — | self | exact |
| `src/main/ipc/transcripts.ts` (modify) | IPC handler | request-response | self | exact |
| `src/shared/ipc-contract.ts` (modify) | config | — | self | exact |
| `src/renderer/app/routes.tsx` (modify) | route | — | self | exact |
| `src/renderer/features/research/ResearchScreen.tsx` | component | request-response | `src/renderer/features/recap/RecapScreen.tsx` | role-match |
| `src/renderer/features/research/NewResearchJobModal.tsx` | component | request-response | `src/renderer/features/scheduling/SchedulingChat.tsx` | role-match |
| `src/renderer/features/research/ReportDocumentView.tsx` | component | request-response | `src/renderer/features/briefing/BriefingScreen.tsx` | role-match |
| `src/renderer/features/research/ReportDashboardView.tsx` | component | request-response | `src/renderer/features/recap/RecapScreen.tsx` | role-match |
| `src/renderer/features/research/FeedbackBar.tsx` | component | request-response | `src/renderer/features/briefing/BriefingFeedbackChips.tsx` | exact |
| `src/renderer/features/research/RerunModal.tsx` | component | request-response | `src/renderer/components/DisconnectConfirmDialog.tsx` | role-match |
| `src/renderer/features/settings/IntegrationsSection.tsx` (modify) | component | request-response | self | exact |

---

## Pattern Assignments

### `src/main/db/migrations/132_research.sql` (migration)

**Analog:** `src/main/db/migrations/129_phase8_recap.sql`

**DDL structure pattern** (lines 104–127):
```sql
-- One table per concern; all tables in a single migration file per phase stream.
CREATE TABLE weekly_recap (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  iso_week        TEXT    NOT NULL UNIQUE,
  week_start_ymd  TEXT    NOT NULL,
  generated_at    TEXT    NOT NULL,
  finalized_at    TEXT,
  canonical_json  TEXT    NOT NULL
);

CREATE INDEX idx_weekly_recap_week_start ON weekly_recap(week_start_ymd DESC);

-- Always end with user_version pragma:
PRAGMA user_version = 129;
```

**Apply to `132_research.sql`:**
- Four tables: `research_job`, `research_report`, `research_report_section`, `research_feedback`
- Indexes on `research_job(status)`, `research_report(job_id, version DESC)`, `research_report_section(report_id)`, `research_feedback(section_id)`
- End with `PRAGMA user_version = 132;`
- Use `TEXT NOT NULL` for status fields; `INTEGER` for version; `TEXT` (ISO8601) for timestamps; nullable `TEXT` for optional fields

---

### `src/main/ipc/research.ts` (IPC handler, request-response + event-driven)

**Analog:** `src/main/ipc/insights.ts`

**Imports pattern** (lines 13–30):
```typescript
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import type Database from 'better-sqlite3-multiple-ciphers';
import { CHANNELS, type ResearchJobDto, type ResearchReportDto } from '../../shared/ipc-contract';
import type { DbHolder } from './onboarding';
import type { SchedulerHandle } from '../lifecycle/scheduler';
import { assertEntitled } from '../entitlement/gate';
import { ResearchService } from '../services/ResearchService';
```

**Deps interface pattern** (lines 34–43):
```typescript
export interface ResearchHandlerDeps {
  logger: Logger;
  dbHolder: DbHolder;
  scheduler?: SchedulerHandle;
  emitToRenderer?: (channel: string, payload?: unknown) => void;
  /** Override service instance (tests). */
  researchService?: ResearchService;
}
```

**Handler registration shell** (lines 127–198 of insights.ts — adapted):
```typescript
export function registerResearchHandlers(
  ipcMain: IpcMain,
  deps: ResearchHandlerDeps,
): void {
  const { logger, dbHolder } = deps;

  // ── Bootstrap cron for any already-scheduled jobs ─────────────────────────
  if (deps.scheduler) {
    // hydrate per-job crons from DB at startup
  }

  // ── researchJobCreate ──────────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.RESEARCH_JOB_CREATE, async (_e, req: unknown) => {
    const db = dbHolder.db;
    if (!db) return { error: 'db-locked' } as const;
    try {
      await assertEntitled(db, 'research_create');
      // ... validate + insert
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ scope: 'research', err: msg }, 'researchJobCreate failed');
      return { error: msg } as const;
    }
  });
}
```

**assertEntitled gate pattern** — always at the IPC layer, never inside ResearchService (see gate.ts line 135):
```typescript
await assertEntitled(db, 'research_run');  // throws EntitlementError on locked
```

**emitToRenderer push pattern** (entitlement.ts lines 56, 103):
```typescript
deps.emitToRenderer?.(CHANNELS.RESEARCH_REPORT_DONE, { jobId, reportId });
```

**Error response pattern** (insights.ts lines 174–179):
```typescript
const msg = err instanceof Error ? err.message : String(err);
logger.warn({ scope: 'research', err: msg }, 'operation failed');
return { error: msg } as const;
```

---

### `src/main/services/ResearchService.ts` (service, batch + event-driven)

**Analog:** `src/main/insights/schedule.ts` (cron pattern) + `src/main/ipc/insights.ts` (LLM generate pattern)

**Constructor/deps pattern** — use function with deps injection, not class:
```typescript
// From insights/aggregate.ts pattern — accepts db, deps object
export async function runResearchJob(
  db: Database.Database,
  jobId: number,
  deps: {
    logger: Logger;
    emitToRenderer?: (channel: string, payload?: unknown) => void;
    scheduler?: SchedulerHandle;
  },
  opts?: { trigger?: 'manual' | 'schedule' | 'feedback_rerun'; feedbackContext?: string },
): Promise<void> {
  // 1. Set job.status = 'running'  ← ONLY place allowed by static-grep ratchet
  // 2. Insert research_report row
  // 3. Call SearchProviderService
  // 4. Call Jina Reader with AbortSignal.timeout(10_000)
  // 5. generateObject + Zod synthesis
  // 6. Write research_report_section rows
  // 7. Set report.status='done', job.status='done'
  // 8. emitToRenderer(CHANNELS.RESEARCH_REPORT_DONE, { jobId, reportId })
}
```

**generateObject pattern** (from RESEARCH.md code examples):
```typescript
import { generateObject } from 'ai';
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
  metrics: z.array(z.object({ label: z.string(), value: z.string() })),
  confidenceScore: z.number().min(0).max(100),
});
```

**Error handling for LLM failure** — wrap entire synthesis, set report.status='failed' on catch:
```typescript
try {
  const { object } = await generateObject({ model, schema: ResearchSynthesisSchema, prompt });
  // write sections
  db.prepare(`UPDATE research_report SET status='done' WHERE id=?`).run(reportId);
  db.prepare(`UPDATE research_job SET status='done' WHERE id=?`).run(jobId);
} catch (err) {
  db.prepare(`UPDATE research_report SET status='failed', error_message=? WHERE id=?`)
    .run(String(err), reportId);
  db.prepare(`UPDATE research_job SET status='failed' WHERE id=?`).run(jobId);
  logger.warn({ scope: 'research', err: String(err) }, 'synthesis failed');
}
```

---

### `src/main/services/SearchProviderService.ts` (service, request-response)

**Analog:** `src/main/integrations/todoist/client.ts` (external API client pattern)

**Pattern — plain fetch with headers, retry once on rate-limit:**
```typescript
// Brave Search
export async function searchBrave(query: string, apiKey: string, count = 5): Promise<BraveResult[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`,
      { headers: { 'X-Subscription-Token': apiKey, 'Accept': 'application/json' } },
    );
    if (res.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    if (!res.ok) return [];
    const data = await res.json() as { web?: { results?: BraveResult[] } };
    return data.web?.results ?? [];
  }
  return [];
}

// Exa Search
export async function searchExa(query: string, apiKey: string, numResults = 5): Promise<ExaResult[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, type: 'neural', numResults }),
    });
    if (res.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    if (!res.ok) return [];
    const data = await res.json() as { results?: ExaResult[] };
    return data.results ?? [];
  }
  return [];
}

// Jina Reader
export async function fetchWithJina(url: string): Promise<string | null> {
  try {
    const res = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'Accept': 'text/markdown' },
    });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null; // timeout or network — skip URL, continue run
  }
}

// URL deduplication
export function deduplicateByUrl<T extends { url: string }>(results: T[]): T[] {
  return [...new Map(results.map((r) => [r.url, r])).values()];
}
```

---

### `src/main/entitlement/gate.ts` (modify — add new action types)

**Analog:** self (lines 29–34)

**Existing union** (lines 29–34):
```typescript
export type EntitlementAction =
  | 'email_send'
  | 'calendar_change'
  | 'task_push'
  | 'briefing_generate'
  | 'rag_ask';
```

**Add:**
```typescript
export type EntitlementAction =
  | 'email_send'
  | 'calendar_change'
  | 'task_push'
  | 'briefing_generate'
  | 'rag_ask'
  | 'research_create'
  | 'research_run';
```

Also check `tests/static/single-entitlement-gate-site.test.ts` and add `src/main/ipc/research.ts` to the call-site whitelist if it uses filename-based matching.

---

### `src/main/ipc/index.ts` (modify — register research handlers)

**Analog:** self (lines 384–387 for insights block)

**Pattern for adding a new handler block** (lines 379–387):
```typescript
// Plan 08-01 Insights channels (Phase 8 Stream 1).
const insightsChannels = [
  CHANNELS.INSIGHTS_LATEST,
  CHANNELS.INSIGHTS_RECOMPUTE,
];
if (!insightsChannels.every((c) => skip.has(c))) {
  registerInsightsHandlers(ipcMain, { logger, dbHolder, scheduler: deps.scheduler });
  insightsChannels.forEach((c) => skip.add(c));
}
```

**Apply — add research block** (after updater block, lines 455–465):
```typescript
import { registerResearchHandlers } from './research';

const researchChannels = [
  CHANNELS.RESEARCH_JOB_CREATE,
  CHANNELS.RESEARCH_JOB_LIST,
  CHANNELS.RESEARCH_JOB_GET,
  CHANNELS.RESEARCH_JOB_UPDATE,
  CHANNELS.RESEARCH_JOB_DELETE,
  CHANNELS.RESEARCH_JOB_RUN,
  CHANNELS.RESEARCH_REPORT_GET,
  CHANNELS.RESEARCH_REPORT_LIST,
  CHANNELS.RESEARCH_FEEDBACK_SAVE,
  CHANNELS.RESEARCH_SUGGESTIONS_GET,
  CHANNELS.RESEARCH_SUGGESTION_APPROVE,
  CHANNELS.RESEARCH_SUGGESTION_DISMISS,
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

---

### `src/main/ipc/transcripts.ts` (modify — add post-ingest hook)

**Analog:** self (lines 13–16, 29–31)

**Existing deps interface** (lines 13–16):
```typescript
export interface TranscriptHandlerDeps {
  logger: Logger;
  dbHolder: DbHolder;
}
```

**Modified deps** — make emitToRenderer optional to avoid breaking tests:
```typescript
export interface TranscriptHandlerDeps {
  logger: Logger;
  dbHolder: DbHolder;
  emitToRenderer?: (channel: string, payload?: unknown) => void;
}
```

**Existing ingest handler** (lines 28–35):
```typescript
const result = ingestTranscriptNote(db, req);
const approval = createTaskBatchApprovalForNote(db, result.noteId);
return { ...result, taskBatchApprovalId: approval.approvalId, actionCount: approval.actionCount };
```

**Modified — fire-and-forget hook after return value is assembled:**
```typescript
const result = ingestTranscriptNote(db, req);
const approval = createTaskBatchApprovalForNote(db, result.noteId);

// NEW — fire-and-forget research topic auto-detect:
void detectResearchTopics(db, result.noteId, result.title ?? '', deps.emitToRenderer).catch(
  (err) => logger.warn({ scope: 'research', err: String(err) }, 'auto-detect failed silently'),
);

return { ...result, taskBatchApprovalId: approval.approvalId, actionCount: approval.actionCount };
```

---

### `src/shared/ipc-contract.ts` (modify — add CHANNELS + DTOs)

**Analog:** self (lines 9–80)

**Existing CHANNELS pattern** (lines 9–13):
```typescript
export const CHANNELS = {
  ASK_ARIA: 'aria:ask',
  // ...
```

**Add research channels** (after existing channels):
```typescript
// Phase 11 Research
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
// Push event (ipcRenderer.on):
RESEARCH_REPORT_DONE: 'aria:research:report-done',
```

**DTO pattern** — follow existing interface style (e.g. `InsightRowDto` at lines 200+):
```typescript
export interface ResearchJobDto {
  id: number;
  title: string;
  goals: string;
  domains: string[];        // parsed from JSON column
  status: 'draft' | 'running' | 'done' | 'failed';
  scheduleInterval: 'none' | 'daily' | 'weekly';
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchReportDto {
  id: number;
  jobId: number;
  version: number;
  status: 'generating' | 'done' | 'failed';
  trigger: 'manual' | 'schedule' | 'feedback_rerun';
  summary: string | null;
  confidenceScore: number | null;
  errorMessage: string | null;
  generatedAt: string | null;
  sections: ResearchReportSectionDto[];
}

export interface ResearchReportSectionDto {
  id: number;
  reportId: number;
  sectionType: string;       // 'findings' | 'sources' | 'metrics'
  ordinal: number;
  contentJson: string;       // raw JSON, parsed in renderer
  feedback?: ResearchFeedbackDto | null;
}

export interface ResearchFeedbackDto {
  id: number;
  reportId: number;
  sectionId: number | null;  // null = whole-report
  thumb: 1 | -1 | null;
  note: string | null;
  createdAt: string;
}
```

---

### `src/renderer/app/routes.tsx` (modify — add /research route)

**Analog:** self (lines 26–82)

**READ_ONLY_ALLOW_LIST addition** (line 39 area):
```typescript
'/research',  // read-only listing; job create + re-run gated by assertEntitled at IPC layer
```

**Route addition** (after `/ask` route, line 76):
```typescript
import { ResearchScreen } from '../features/research/ResearchScreen';

// inside AppRoutes():
<Route path="/research" element={<LockedGuard><ResearchScreen /></LockedGuard>} />
```

---

### `src/renderer/features/research/ResearchScreen.tsx` (component, request-response)

**Analog:** `src/renderer/features/recap/RecapScreen.tsx`

**State + load pattern** (RecapScreen.tsx lines 55–73):
```typescript
export function ResearchScreen(): JSX.Element {
  const [jobs, setJobs] = useState<ResearchJobDto[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [report, setReport] = useState<ResearchReportDto | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'document' | 'dashboard'>('document');

  async function refresh(): Promise<void> {
    const res = await window.aria.researchJobList({});
    if ('error' in res) { setError(res.error); return; }
    setJobs(res.jobs);
  }

  useEffect(() => { void refresh(); }, []);
```

**Push event subscription pattern** (follow BriefingScreen pattern for ipcRenderer.on):
```typescript
useEffect(() => {
  const off = window.aria.onResearchReportDone?.(({ jobId, reportId }) => {
    // refresh if current job matches
    if (jobId === selectedJobId) void loadReport(reportId);
  });
  return () => off?.();
}, [selectedJobId]);
```

**Animation constants** (used in every screen):
```typescript
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
```

**Layout:** two-column shell — 240px left rail + flex-1 right panel:
```typescript
<div style={{ display: 'flex', height: '100%' }}>
  <aside style={{ width: 240, borderRight: '1px solid var(--rule)', overflowY: 'auto' }}>
    {/* Suggested section + job list */}
  </aside>
  <main style={{ flex: 1, overflowY: 'auto' }}>
    {/* Report view or empty state */}
  </main>
</div>
```

---

### `src/renderer/features/research/NewResearchJobModal.tsx` (component, request-response)

**Analog:** `src/renderer/features/scheduling/SchedulingChat.tsx`

**State pattern** (SchedulingChat.tsx lines 62–68):
```typescript
export function NewResearchJobModal({ onClose, onCreated }: Props): JSX.Element {
  const [title, setTitle] = useState('');
  const [goals, setGoals] = useState('');
  const [domains, setDomains] = useState<string[]>([]);
  const [scheduleInterval, setScheduleInterval] = useState<'none' | 'daily' | 'weekly'>('none');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
```

**Submit pattern** (SchedulingChat.tsx lines 70–80):
```typescript
async function submit(): Promise<void> {
  if (!title.trim() || pending) return;
  setPending(true);
  setError(null);
  try {
    const res = await window.aria.researchJobCreate({ title, goals, domains, scheduleInterval });
    if ('error' in res) { setError(res.error); return; }
    onCreated(res.job);
    onClose();
  } catch (err) {
    setError((err as Error).message);
  } finally {
    setPending(false);
  }
}
```

**Disabled state when both API keys missing:**
```typescript
// Check key presence via IPC before rendering the button:
const [hasKeys, setHasKeys] = useState<boolean | null>(null);
useEffect(() => {
  void window.aria.researchSecretsHas({}).then((r) => setHasKeys(!('error' in r) && r.hasBrave || r.hasExa));
}, []);
// Button with tooltip:
<button disabled={!hasKeys} title={!hasKeys ? 'Add Brave or Exa API key in Settings → Integrations' : undefined}>
  Start Research
</button>
```

**Slide-over style** (pattern from existing modals):
```typescript
// Overlay + slide-in panel from right
<div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100 }}
     onClick={onClose}>
  <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 440,
                background: 'var(--bg)', padding: 32, overflowY: 'auto',
                animation: `slideIn 220ms ${EASE_OUT}` }}
       onClick={(e) => e.stopPropagation()}>
    {/* form content */}
  </div>
</div>
```

---

### `src/renderer/features/research/ReportDocumentView.tsx` (component, request-response)

**Analog:** `src/renderer/features/briefing/BriefingScreen.tsx`

**Section cascade animation pattern** (BriefingScreen.tsx — EASE_OUT + stagger):
```typescript
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
// Each section card:
<div style={{
  animation: `fadeUp 320ms ${EASE_OUT} both`,
  animationDelay: `${index * 50}ms`,
}}>
```

**Summary card — gold left-border** (from CONTEXT.md + editorial pattern):
```typescript
<div style={{
  borderLeft: '3px solid var(--gold)',
  paddingLeft: 16,
  marginBottom: 24,
  background: 'rgba(184,134,11,0.04)',
}}>
  <p style={{ fontFamily: 'var(--f-serif)', fontStyle: 'italic' }}>{report.summary}</p>
</div>
```

**Version nav footer strip:**
```typescript
<div style={{ borderTop: '1px solid var(--rule)', padding: '12px 0', display: 'flex',
              alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
  <button onClick={onOlderVersion} disabled={!hasPriorVersion}>← Older</button>
  <span style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--gray-soft)' }}>
    Generated · {formatTs(report.generatedAt)} · Version {report.version} of {totalVersions}
  </span>
  <button onClick={onNewerVersion} disabled={!hasNewerVersion}>Newer →</button>
</div>
```

---

### `src/renderer/features/research/ReportDashboardView.tsx` (component, request-response)

**Analog:** `src/renderer/features/recap/RecapScreen.tsx` (stat card layout)

**Stat cards row pattern** — use editorial card pattern with mono labels:
```typescript
// Four stat cards: Sources found / Domains covered / Key findings / Confidence score
<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
  {stats.map(({ label, value }) => (
    <div key={label} style={{ border: '1px solid var(--rule)', borderRadius: 6, padding: '12px 16px' }}>
      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--gray-soft)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ fontFamily: 'var(--f-serif)', fontSize: 28, marginTop: 4 }}>{value}</div>
    </div>
  ))}
</div>
```

**CSS-only coverage chart** (no chart library — see RESEARCH.md Standard Stack):
```typescript
// Horizontal bar per domain: label + % bar
{coverageData.map(({ domain, pct }) => (
  <div key={domain} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
    <span style={{ width: 120, fontFamily: 'var(--f-mono)', fontSize: 11, flexShrink: 0 }}>{domain}</span>
    <div style={{ flex: 1, height: 8, background: 'var(--rule)', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: 'var(--gold)', borderRadius: 4,
                    transition: `width 400ms ${EASE_OUT}` }} />
    </div>
    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--gray-soft)', width: 36, textAlign: 'right' }}>{pct}%</span>
  </div>
))}
```

---

### `src/renderer/features/research/FeedbackBar.tsx` (component, request-response)

**Analog:** `src/renderer/features/briefing/BriefingFeedbackChips.tsx` (exact match)

**Full pattern** (BriefingFeedbackChips.tsx lines 14–83):
```typescript
export interface FeedbackBarProps {
  reportId: number;
  sectionId: number | null;  // null = whole-report feedback
}

export function FeedbackBar({ reportId, sectionId }: FeedbackBarProps): JSX.Element {
  const [picked, setPicked] = useState<-1 | 0 | 1>(0);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');

  async function fire(thumb: -1 | 1): Promise<void> {
    const prev = picked;
    setPicked(thumb);
    try {
      const r = await window.aria.researchFeedbackSave({ reportId, sectionId, thumb, note: null });
      if (r && typeof r === 'object' && 'error' in r) setPicked(prev);
    } catch {
      setPicked(prev);
    }
  }
```

**Chip style function** — copy verbatim from BriefingFeedbackChips.tsx lines 67–83:
```typescript
function chipStyle(active: boolean): React.CSSProperties {
  return {
    width: 26, height: 22,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 4, fontSize: 12,
    background: active ? 'rgba(184,134,11,0.10)' : 'transparent',
    color: active ? 'var(--gold-deep)' : 'var(--gray-soft)',
    border: `1px solid ${active ? 'var(--gold)' : 'var(--rule)'}`,
    cursor: 'pointer', padding: 0,
    fontFamily: 'var(--f-mono)',
  };
}
```

**Add note expander:** inline `<details>`/`<summary>` or controlled `noteOpen` state + `<textarea>`.

---

### `src/renderer/features/research/RerunModal.tsx` (component, request-response)

**Analog:** `src/renderer/components/DisconnectConfirmDialog.tsx` (confirm dialog pattern)

**Modal shell pattern** (entry animation from CONTEXT.md + briefing confirm dialog):
```typescript
export function RerunModal({ report, feedbackItems, onClose, onRerun }: Props): JSX.Element {
  const [guidance, setGuidance] = useState('');
  const [pending, setPending] = useState(false);

  async function confirm(): Promise<void> {
    if (pending) return;
    setPending(true);
    try {
      await onRerun({ feedbackContext: guidance });
    } finally {
      setPending(false);
      onClose();
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', background: 'rgba(0,0,0,0.4)', zIndex: 200 }}
         onClick={onClose}>
      <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 32, width: 480,
                    maxWidth: '90vw', animation: `dialogEntry 200ms ${EASE_OUT}` }}
           onClick={(e) => e.stopPropagation()}>
        {/* read-only feedback summary + guidance textarea + Re-run Research button */}
        <button onClick={() => void confirm()} disabled={pending}>
          {pending ? 'Running…' : 'Re-run Research'}
        </button>
      </div>
    </div>
  );
}
```

---

### `src/renderer/features/settings/IntegrationsSection.tsx` (modify — add API key rows)

**Analog:** self (existing integration row pattern, lines 78–80 area)

**Existing key input pattern for safeStorage keys** — follow FrontierKeySection.tsx pattern:
```typescript
// Two new rows in the TASKS/INTEGRATIONS area:
// "Research — Brave Search" row: input type="password" + save button
// "Research — Exa" row: same pattern
// On save: window.aria.secretsSetResearchKey({ provider: 'brave', key })
// Key presence check: window.aria.researchSecretsHas({})
```

Both rows follow the same shape as the existing frontier key input: password input, save button, "Key saved" confirmation, no raw key ever shown after save.

---

### Research cron scheduling (within `ResearchService.ts`)

**Analog:** `src/main/insights/schedule.ts` (lines 21–99)

**Per-job cron registration pattern:**
```typescript
// Key per job — differs from single-key insights pattern
const CRON_KEY = (jobId: number) => `research-refresh-${jobId}`;

export function scheduleResearchJob(
  jobId: number,
  interval: 'daily' | 'weekly',
  tz: string,
  run: () => Promise<void>,
  deps: { scheduler: SchedulerHandle; logger?: Pick<Logger, 'info' | 'warn'> },
): ScheduledTask {
  const key = CRON_KEY(jobId);
  const expr = interval === 'daily' ? '0 6 * * *' : '0 6 * * 1';
  const prior = deps.scheduler.cronRegistry.get(key);
  if (prior) { try { prior.stop(); } catch { /* best-effort */ } }

  const task = cron.schedule(expr, async () => {
    try { await run(); } catch (err) {
      deps.logger?.warn({ scope: 'research', jobId, err: String(err) }, 'research cron threw');
    }
  }, { timezone: tz } as Parameters<typeof cron.schedule>[2]);

  deps.scheduler.cronRegistry.set(key, task);
  // Register suspend/resume callbacks — copy from insights/schedule.ts lines 78–97
  return task;
}

export function cancelResearchJobSchedule(jobId: number, scheduler: SchedulerHandle): void {
  const key = CRON_KEY(jobId);
  const task = scheduler.cronRegistry.get(key);
  if (task) { try { task.stop(); } catch { /* best-effort */ } scheduler.cronRegistry.delete(key); }
}
```

**cronRegistry.size invariant:** grep `tests/` for `cronRegistry.size` and update any hardcoded assertion to `>= 6` before adding dynamic per-job entries.

---

## Shared Patterns

### makeRendererEmitter (push events to renderer)
**Source:** `src/main/ipc/entitlement.ts` lines 113–124
**Apply to:** `src/main/ipc/research.ts`, `src/main/ipc/index.ts`
```typescript
export function makeRendererEmitter(
  win: BrowserWindow | null,
): (channel: string, payload?: unknown) => void {
  return (channel, payload) => {
    try {
      win?.webContents?.send(channel, payload);
    } catch {
      /* renderer may be torn down */
    }
  };
}
```

### assertEntitled (entitlement gate)
**Source:** `src/main/entitlement/gate.ts` lines 135–197
**Apply to:** `src/main/ipc/research.ts` — call at IPC layer for `RESEARCH_JOB_CREATE` and `RESEARCH_JOB_RUN` handlers only. Never call inside ResearchService.

### IPC handler error response shape
**Source:** `src/main/ipc/insights.ts` lines 174–179
**Apply to:** All handlers in `src/main/ipc/research.ts`
```typescript
catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  logger.warn({ scope: 'research', err: msg }, 'operation failed');
  return { error: msg } as const;
}
```

### db-locked guard
**Source:** `src/main/ipc/insights.ts` line 169; `src/main/ipc/transcripts.ts` line 27
**Apply to:** Every handler in `src/main/ipc/research.ts`
```typescript
const db = dbHolder.db;
if (!db) return { error: 'db-locked' } as const;
```

### Editorial EASE_OUT animation constant
**Source:** `src/renderer/features/briefing/BriefingScreen.tsx` line 30; `src/renderer/features/scheduling/SchedulingChat.tsx` line 28
**Apply to:** All renderer components in `src/renderer/features/research/`
```typescript
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
```

### Editorial CSS token variables
**Apply to:** All research renderer components — use these exact CSS variables (never raw colors):
- `var(--gold)` / `var(--gold-deep)` — gold accent, active state
- `var(--rule)` — border color
- `var(--gray-soft)` — muted text
- `var(--bg)` — background
- `var(--f-serif)` — Playfair Display (headings, summary)
- `var(--f-mono)` — mono (labels, timestamps, status)

### safeStorage key read/write
**Source:** `src/main/secrets/safeStorage.ts` — `setProviderTokens` / `getProviderTokens`
**Apply to:** All research API key reads in `ResearchService.ts` and `SearchProviderService.ts`
```typescript
// Read key (never expose raw value to renderer):
const braveKey = getProviderTokens('aria.research.braveApiKey');
const exaKey = getProviderTokens('aria.research.exaApiKey');
// Write key (from IPC handler for settings row):
setProviderTokens('aria.research.braveApiKey', rawKey);
```

### isErr type guard
**Source:** `src/renderer/features/briefing/BriefingScreen.tsx` line 51; `src/renderer/features/settings/IntegrationsSection.tsx` line 37
**Apply to:** All renderer components calling `window.aria.research*`
```typescript
function isErr(v: unknown): v is { error: string } {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}
```

---

## No Analog Found

No files fall into this category — all new files have close analogs in the codebase.

---

## Metadata

**Analog search scope:** `src/main/ipc/`, `src/main/insights/`, `src/main/briefing/`, `src/main/entitlement/`, `src/renderer/features/briefing/`, `src/renderer/features/recap/`, `src/renderer/features/scheduling/`, `src/renderer/app/`, `src/shared/`, `src/main/db/migrations/`
**Files scanned:** 16 source files read directly; ~130 file paths inspected via Glob
**Pattern extraction date:** 2026-05-21
