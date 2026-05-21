# Research Feature — Design Spec

**Date:** 2026-05-21
**Status:** Approved

---

## Overview

A standalone Research feature that lets Aria users commission web-backed research jobs, auto-detects research topics from meeting transcripts, renders rich versioned reports, and refines results through a structured feedback loop.

---

## Requirements

| ID | Requirement |
|---|---|
| RES-01 | User can create a research job with title, goals, domains, and optional supplement URLs |
| RES-02 | Research jobs can run once or on a daily/weekly schedule |
| RES-03 | Aria auto-detects research topics from ingested transcripts and surfaces them as suggestions |
| RES-04 | Reports render in two switchable views: Document and Dashboard |
| RES-05 | Users can leave per-section feedback (thumbs up/down + note) |
| RES-06 | Users can trigger a re-run with consolidated feedback as prompt guidance |
| RES-07 | All report versions are preserved and navigable |
| RES-08 | Brave Search API and Exa are both used as search providers; either alone is sufficient |
| RES-09 | Jina Reader fetches full page content from search result URLs |
| RES-10 | If both API keys are missing, research jobs cannot be started |

---

## Architecture

**Approach:** Standalone service. No coupling to RAG/Ask pipeline.

**New files:**
- `src/main/ipc/research.ts` — IPC handler registration
- `src/main/services/ResearchService.ts` — core business logic
- `src/main/services/SearchProviderService.ts` — Brave + Exa abstraction
- `src/renderer/features/research/ResearchScreen.tsx`
- `src/renderer/features/research/NewResearchJobModal.tsx`
- `src/renderer/features/research/ReportDocumentView.tsx`
- `src/renderer/features/research/ReportDashboardView.tsx`
- `src/renderer/features/research/FeedbackBar.tsx`
- `src/renderer/features/research/RerunModal.tsx`

---

## Data Model

### `research_job`
```sql
CREATE TABLE research_job (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  goals TEXT NOT NULL,
  domains TEXT NOT NULL,          -- JSON array of strings
  supplement_urls TEXT,           -- JSON array of URLs, nullable
  status TEXT NOT NULL DEFAULT 'draft',  -- draft|running|done|failed
  schedule_interval TEXT,         -- null|daily|weekly
  next_run_at INTEGER,            -- unix ms, nullable
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### `research_report`
```sql
CREATE TABLE research_report (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES research_job(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'generating',  -- generating|done|failed
  trigger TEXT NOT NULL,          -- manual|schedule|feedback_rerun
  feedback_context TEXT,          -- feedback note that triggered this run, nullable
  error_message TEXT,
  created_at INTEGER NOT NULL
);
```

### `research_report_section`
```sql
CREATE TABLE research_report_section (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES research_report(id) ON DELETE CASCADE,
  section_type TEXT NOT NULL,     -- summary|finding|source_table|metric
  heading TEXT NOT NULL,
  body_md TEXT NOT NULL,
  display_order INTEGER NOT NULL
);
```

### `research_feedback`
```sql
CREATE TABLE research_feedback (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES research_report(id) ON DELETE CASCADE,
  section_id TEXT REFERENCES research_report_section(id),  -- null = whole-report
  sentiment TEXT,                 -- up|down|null
  note TEXT,
  created_at INTEGER NOT NULL
);
```

---

## IPC Contract

All channels prefixed `aria:research:`.

```typescript
researchJobCreate(req: {
  title: string;
  goals: string;
  domains: string[];
  scheduleInterval?: 'daily' | 'weekly';
  supplementUrls?: string[];
}) → { jobId: string } | { error: string }

researchJobList({}) → { jobs: ResearchJobDto[] }

researchJobGet({ jobId: string }) → ResearchJobDto | { error: string }

researchJobUpdate(req: {
  jobId: string;
  title?: string;
  goals?: string;
  domains?: string[];
  scheduleInterval?: 'daily' | 'weekly' | null;
}) → { ok: true } | { error: string }

researchJobDelete({ jobId: string }) → { ok: true } | { error: string }

researchJobRun(req: {
  jobId: string;
  feedbackContext?: string;
}) → { reportId: string } | { error: string }

researchReportGet({ reportId: string }) → ResearchReportDto | { error: string }

researchReportList({ jobId: string }) → { reports: ResearchReportDto[] }

researchFeedbackSave(req: {
  reportId: string;
  sectionId?: string;
  sentiment?: 'up' | 'down';
  note?: string;
}) → { ok: true } | { error: string }

researchSuggestionsGet({}) → { jobs: ResearchJobDto[] }

researchSuggestionApprove({ jobId: string }) → { ok: true } | { error: string }

researchSuggestionDismiss({ jobId: string }) → { ok: true } | { error: string }
```

---

## Run Pipeline

```
researchJobRun(jobId, feedbackContext?)
  1. Set job.status = 'running'
  2. Insert research_report (status='generating', version=N+1, trigger=...)
  3. For each domain × goal combination:
     a. Brave Search API → top 5 result URLs
     b. Exa semantic search → top 5 result URLs
     c. Deduplicate by URL
     d. Jina Reader (r.jina.ai/<url>) → clean markdown per URL
        - Timeout: 10s per URL; skip on timeout/error
  4. Concatenate all markdown into synthesis context
  5. Frontier LLM (generateObject + Zod):
     - Input: title, goals, domains, feedbackContext, page corpus
     - Output: { summary, findings[], sources[], metrics[] }
  6. Write research_report_section rows
  7. Set report.status = 'done', job.status = 'done', job.next_run_at = ...
  8. Push IPC event to renderer
```

**Graceful degradation:**
- Brave key missing → skip Brave, run Exa only
- Exa key missing → skip Exa, run Brave only
- Both missing → blocked at UI before IPC call
- Jina fetch fails for a URL → skip, continue
- LLM synthesis fails → report.status = 'failed', error_message stored
- Schedule fires mid-run → skip cycle

---

## Transcript Auto-detect

Fires as a post-ingest hook after `transcriptIngest` completes:

```
transcriptIngest completes
  → researchDetectTopics(transcriptId)
  → LLM extracts 0–5 research topics: { title, goals, domains }
  → Insert each as research_job with status='draft'
  → If count > 0: push briefing notification
      "N research topics detected from [meeting title] — review?"
```

The notification links to `/research` with the Suggested section expanded.

---

## UI Layout

### `/research` — Research Screen

**Two-column layout:**

**Left rail (240px) — Job list:**
- Editorial heading "Research" + gold `+ New` button
- **Suggested section** (collapsible, gold left-border): transcript-detected draft jobs; each card has inline `Approve` / `Dismiss` buttons
- **Job cards**: title, domain chips, status badge (amber=Running, green=Done, muted=Draft), last-run timestamp; active card has gold left-border

**Right panel — Report view:**
- Topbar: job title + breadcrumb; `Document | Dashboard` view toggle (right-aligned); `Re-run` button; `⋯` menu (Edit / Delete / Schedule)
- Report content area (switches per toggle)
- Footer strip: "Generated · [timestamp] · Version N of M" with `← Older / Newer →` navigation

### Document View
- **Summary card**: full-width, gold left-border, 3–5 sentence executive summary
- **Key Findings**: numbered list, `BriefingItem`-style rows
- **Sources table**: Source name | Domain | Relevance | Link — borderless, alternating row shading
- **Per-section feedback bar**: 👍 👎 + "Add note" inline expander below each section

### Dashboard View
- **Stat cards row**: "Sources found" / "Domains covered" / "Key findings" / "Confidence score" — large number + label + gold top-accent line
- **Coverage chart**: horizontal bar chart, sources per domain
- **Findings grid**: 2-column card grid, one card per finding
- **Sources table**: same as document view

### New Research Job (slide-over)
- Title — full-width text input
- Goals — textarea
- Domains — tag chip input
- Supplement URLs — optional collapsible section
- Schedule toggle → Daily / Weekly radio if on
- Footer: `Cancel` | `Start Research` (gold, disabled with tooltip if no API keys)

### Transcript Suggestion Notification
Briefing item + toast:
> **"3 research topics detected from today's meetings"**
> *AI infrastructure costs · Competitor pricing · SOC 2 compliance*
> `Review suggestions →`

### Re-run Modal
- Read-only summary of all feedback notes on current report version
- Textarea: "Add any final guidance" (pre-filled with collected notes)
- `Cancel` | `Re-run Research` (gold)
- On submit: report panel shows `Generating…` skeleton; version counter increments

### Settings — Integrations
Two new rows under the existing provider list:
- **Research — Brave Search**: key input + status chip
- **Research — Exa**: key input + status chip

---

## Error Handling

| Failure | Behaviour |
|---|---|
| Both API keys missing | Button disabled; tooltip: "Add a Brave Search or Exa key in Settings first" |
| API rate limit / 4xx | Retry once after 2s; skip provider if still failing |
| Jina fetch timeout (>10s) | Skip URL, continue run |
| LLM synthesis fails | `report.status = 'failed'`; UI shows error card with Retry button |
| Transcript detect LLM fails | Silent — no notification, no draft created; logged locally |
| Schedule fires mid-run | Skip cycle |

---

## Testing

- **Unit:** `ResearchService` + `SearchProviderService` with MSW mocking Brave, Exa, Jina. Covers deduplication, graceful degradation, section parsing.
- **Integration:** `researchJobRun` IPC handler against real SQLite. Verifies report + section rows written.
- **UI:** `ResearchScreen` (list renders, toggle switches, feedback submits), `NewResearchJobModal` (validation, disabled state).
- **Static ratchet:** grep assertion that only `researchJobRun` sets `job.status = 'running'`.

---

## Settings Keys (safeStorage)

```
aria.research.braveApiKey
aria.research.exaApiKey
```

---

## Route

`/research` added to `AppRoutes` and `READ_ONLY_ALLOW_LIST` (report viewing is read-only; job creation and re-run gated by `assertEntitled` at IPC layer).
