# Phase 11: Research - Context

**Gathered:** 2026-05-21
**Status:** Ready for planning
**Source:** Brainstorm spec (docs/superpowers/specs/2026-05-21-research-feature-design.md)

<domain>
## Phase Boundary

Adds a standalone Research feature: users commission web-backed research jobs, Aria auto-detects topics from meeting transcripts, reports render in Document + Dashboard views, and a feedback loop enables per-section corrections and re-runs. No coupling to the existing RAG/Ask pipeline.

</domain>

<decisions>
## Implementation Decisions

### Architecture
- Standalone service — new `src/main/ipc/research.ts` + `src/main/services/ResearchService.ts` + `src/main/services/SearchProviderService.ts`. NOT piggybacking RAG/Ask.
- 4 new DB tables: `research_job`, `research_report`, `research_report_section`, `research_feedback`
- Route: `/research` added to `AppRoutes` + `READ_ONLY_ALLOW_LIST`; job creation + re-run gated by `assertEntitled` at IPC layer

### Search Providers
- **Brave Search API** (primary, broad web coverage) + **Exa** (semantic/research-grade)
- Both used per run; results merged and deduplicated by URL
- Either key alone is sufficient — graceful degradation if one key missing
- Both keys missing → job blocked at UI before IPC call; button disabled with tooltip
- **Jina Reader** (`r.jina.ai/<url>`) fetches full page content (clean markdown) from result URLs; 10s timeout per URL, skip on fail
- Settings keys in safeStorage: `aria.research.braveApiKey` / `aria.research.exaApiKey`
- Settings → Integrations: two new rows "Research — Brave Search" + "Research — Exa"

### Job Lifecycle
- One-shot by default; optional daily/weekly scheduled refresh per job
- `research_job.status`: draft | running | done | failed
- `researchJobRun` is the single entry point that sets `job.status = 'running'` (static-grep ratchet)

### Run Pipeline
1. Set `job.status = 'running'`
2. Insert `research_report` row (`status='generating'`, `version=N+1`, `trigger=manual|schedule|feedback_rerun`)
3. For each domain × goal combination: Brave Search (top 5 URLs) + Exa (top 5 URLs) → deduplicate → Jina Reader fetch
4. Frontier LLM `generateObject` + Zod → `{ summary, findings[], sources[], metrics[] }`
5. Write `research_report_section` rows
6. Set `report.status='done'`, `job.status='done'`, update `next_run_at`
7. Push IPC event to renderer

### Transcript Auto-detect
- Post-ingest hook fires after `transcriptIngest` completes
- LLM extracts 0–5 research topics `{ title, goals, domains }` from transcript
- Each inserted as `research_job` with `status='draft'`
- If count > 0: push briefing notification "N research topics detected from [meeting title] — review?" linking to `/research` with Suggested section expanded
- Auto-detect LLM failure is silent (no notification, no draft, logged locally)

### Report Views
- Two switchable views on the same data: **Document** and **Dashboard**
- Document view: Summary card (gold left-border) + Key Findings (BriefingItem-style) + Sources table + per-section feedback bar
- Dashboard view: Stat cards row (Sources found / Domains covered / Key findings / Confidence score) + Coverage chart (horizontal bar) + Findings grid (2-col) + Sources table
- Version navigation: footer strip "Generated · [timestamp] · Version N of M" with ← Older / Newer →

### Feedback Model
- Per-section: thumbs up/down + "Add note" inline expander
- Whole-report re-run: "Re-research with this feedback" button → Re-run Modal → consolidated notes as `feedbackContext` → new versioned run
- `research_feedback.section_id` is nullable (null = whole-report feedback)
- All report versions preserved

### IPC Channels (all prefixed `aria:research:`)
- `researchJobCreate`, `researchJobList`, `researchJobGet`, `researchJobUpdate`, `researchJobDelete`
- `researchJobRun` (manual trigger + re-run with feedbackContext)
- `researchReportGet`, `researchReportList`
- `researchFeedbackSave`
- `researchSuggestionsGet`, `researchSuggestionApprove`, `researchSuggestionDismiss`

### UI Layout
- `/research`: two-column (left rail 240px job list + right panel report view)
- Left rail: "Suggested" section (collapsible, gold left-border, Approve/Dismiss per card) + job cards (title, domain chips, status badge, timestamp; active = gold left-border)
- Right panel: topbar (title + Document|Dashboard toggle + Re-run + ⋯ menu) + report content + footer version nav
- New Research Job: slide-over panel (title, goals, domains tag input, optional supplement URLs, schedule toggle)
- Re-run Modal: read-only feedback summary + final guidance textarea + Re-run Research button

### Error Handling
- Brave/Exa rate limit / 4xx → retry once after 2s; skip provider if still failing
- Jina timeout > 10s → skip URL, continue run
- LLM synthesis fails → `report.status='failed'`; UI shows error card with Retry button
- Schedule fires mid-run → skip cycle

### Testing
- Unit: ResearchService + SearchProviderService with MSW mocking Brave, Exa, Jina; covers deduplication, graceful degradation, section parsing
- Integration: `researchJobRun` IPC handler against real SQLite; verifies report + section rows written
- UI: ResearchScreen (list renders, toggle switches, feedback submits), NewResearchJobModal (validation, disabled state)
- Static ratchet: grep assertion that only `researchJobRun` sets `job.status = 'running'`

### Claude's Discretion
- Migration number (next after current highest — check existing migrations before assigning)
- Exact node-cron schedule string for daily/weekly refresh
- IPC push event mechanism for renderer notification (follow existing pattern in briefing/insights IPC)
- Exact Zod schema shape for `generateObject` synthesis call
- Brave Search API endpoint and Exa API endpoint (standard REST — follow existing provider pattern)
- Chart rendering library for coverage chart (follow existing UI patterns; recharts is likely already in use)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design spec
- `docs/superpowers/specs/2026-05-21-research-feature-design.md` — Full approved design: data model DDL, IPC contract, run pipeline, UI layout, error handling

### Existing IPC patterns to follow
- `src/main/ipc/transcripts.ts` — transcriptIngest hook point for post-ingest auto-detect
- `src/main/ipc/briefing.ts` — briefing notification push pattern
- `src/main/ipc/insights.ts` — IPC push event pattern for renderer notification
- `src/main/ipc/index.ts` — IPC handler registration pattern

### Existing DB patterns
- `src/main/db/migrations/` — canonical migration files; read highest number before assigning next migration number
- `src/main/services/` — service file patterns

### Existing UI patterns
- `src/renderer/features/briefing/BriefingScreen.tsx` — editorial screen layout + BriefingItem pattern
- `src/renderer/features/scheduling/SchedulingChat.tsx` — slide-over panel pattern
- `src/renderer/features/settings/IntegrationsSection.tsx` — Settings → Integrations row pattern
- `src/renderer/app/routes.tsx` — route registration + READ_ONLY_ALLOW_LIST

### Entitlement gate
- `src/main/ipc/entitlement.ts` — assertEntitled pattern for IPC gate

</canonical_refs>

<specifics>
## Specific Ideas

- Jina Reader URL pattern: `https://r.jina.ai/<url>` — prepend to any search result URL
- Brave Search API: `https://api.search.brave.com/res/v1/web/search`
- Exa API: `https://api.exa.ai/search` with `type: 'neural'` for semantic search
- Confidence score = LLM self-rated 0–100 field in the synthesis Zod schema
- `assertEntitled` call on `researchJobRun` and `researchJobCreate` at IPC layer

</specifics>

<deferred>
## Deferred Ideas

- SearXNG self-hosted search — rejected; too much user setup friction for exec persona
- Research piggybacking RAG/Ask pipeline — rejected; different lifecycle (versioned, scheduled, feedback-driven)
- Real-time streaming report generation (SSE/websocket) — defer to v2
- Multi-user / shared research jobs — out of v1 scope
- PDF/DOCX export of research reports — out of v1 scope

</deferred>

---

*Phase: 11-research*
*Context gathered: 2026-05-21 via brainstorm spec*
