# 11-03 SUMMARY — Research test suite + SideNav entry

**Status:** Complete
**Date:** 2026-06-02
**Plan:** 11-03

## What was done

Fleshed out the Phase 11 test suite and confirmed the Research feature is reachable and functional.

- **Unit — ResearchService** (`tests/unit/main/research-service.spec.ts`): 9 tests — createResearchJob, runResearchJob happy path (MSW-mocked Brave/Exa/Jina/LLM → report row `status='done'` + `RESEARCH_REPORT_DONE` emit), graceful degradation (one provider 429s, report still produced), generateObject failure → `status='failed'`, detectResearchTopics (draft rows + emit; silent on LLM throw), and RES-03 scheduled refresh (asserts a version=2 report row after the cron fires).
- **Unit — SearchProviderService** (`tests/unit/main/search-provider-service.spec.ts`): 15 tests (already implemented in Plan 01) — Brave/Exa 200/429-retry/500, Jina 200/timeout/404, dedup.
- **Integration** (`tests/integration/research-ipc.spec.ts`): 3 tests against real in-memory `better-sqlite3` (migration **133_research.sql**) — `researchJobRun` writes a `research_report` row; all HTTP MSW-mocked.
- **UI** (`tests/unit/renderer/research-screen.spec.tsx`): 8 tests — empty state, job cards, Document/Dashboard toggle, Start-Research disabled (no key) / enabled (key present), FeedbackBar thumbs up/down.
- **SideNav**: Research link → `/research` with `data-testid="nav-research"` (confirmed present; was already added in Plan 02).

**Commits:** `2ed832a` (ResearchService + IPC integration tests), `159c764` (ResearchScreen UI tests).

## Verification (orchestrator re-ran)
`vitest run` on the 3 new/updated spec files → **3 files, 20 tests, all passing**.

## Human-verify (Task 3) — live walkthrough, 2026-06-02
User walked the running app (dark mode). **PASS** on everything verifiable without an API key:
1. Research nav item + `/research` two-column layout (left rail + right panel, empty states) ✅
2. Settings → Integrations shows "RESEARCH — Brave Search" + "RESEARCH — Exa" key rows ✅
3. "+ New Research" modal (title/goals/domains/schedule) with "Start Research" correctly **disabled** + "add a key" banner when no key ✅

**Deferred:** steps 4–5 (create + run a real research job, Document/Dashboard report, feedback, re-run) require a live Brave/Exa API key the user didn't have loaded. That pipeline is covered by the 20 automated tests (MSW-mocked providers → real-SQLite report write). Recorded as deferred live-run, consistent with other phases.

## Deviations
- SideNav Research link was **already present from Plan 02** (no change needed).
- `search-provider-service.spec.ts` was **already fully implemented in Plan 01** (15 tests; no change).
- Plan frontmatter had **stale paths** — real locations used: SideNav `src/renderer/components/SideNav.tsx` (not `components/editorial/`), service `src/main/services/ResearchService.ts`, IPC `src/main/ipc/research.ts`, migration `133_research.sql` (not 132 — Phase 10 took 132).
- RES-03 cron test uses `vi.mock('node-cron')` + direct callback invocation instead of `vi.useFakeTimers()` (deterministic; tests the same version=2 invariant).

## Bug found + fixed during the walkthrough
Dark mode rendered the Research form inputs/surfaces white (undefined `var(--bg, #fff)`). Fixed under quick task **260602-l4c** (`2a11048`): theme-aware `--bg`/`--on-gold` tokens. See [[project_aria_dark_light_mode]].

## Self-Check: PASSED
