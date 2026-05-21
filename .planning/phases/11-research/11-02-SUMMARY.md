---
phase: 11-research
plan: "02"
subsystem: research
tags: [ipc-handlers, renderer, static-ratchet, entitlement, settings]
dependency_graph:
  requires:
    - migration-132-research-tables
    - SearchProviderService
    - ResearchService
    - research-ipc-channels
    - research-dto-interfaces
  provides:
    - research-ipc-handlers-12ch
    - research-secrets-ipc
    - research-renderer-components
    - research-route
    - integrations-research-keys
  affects:
    - src/main/ipc/index.ts
    - src/main/ipc/transcripts.ts
    - src/shared/ipc-contract.ts
    - src/renderer/app/routes.tsx
    - src/renderer/features/settings/IntegrationsSection.tsx
    - tests/static/single-entitlement-gate-site.test.ts
tech_stack:
  added: []
  patterns:
    - IPC handler db-locked guard + assertEntitled gate (research_create, research_run)
    - Fire-and-forget detectResearchTopics hook in transcripts.ts post-ingest
    - Editorial CSS tokens (var(--gold), var(--rule), var(--f-serif), var(--f-mono))
    - CSS-only coverage bar chart (no chart library)
    - Push event subscription via window.aria.onResearchReportDone
key_files:
  created:
    - src/main/ipc/research.ts
    - src/renderer/features/research/ResearchScreen.tsx
    - src/renderer/features/research/NewResearchJobModal.tsx
    - src/renderer/features/research/ReportDocumentView.tsx
    - src/renderer/features/research/ReportDashboardView.tsx
    - src/renderer/features/research/FeedbackBar.tsx
    - src/renderer/features/research/RerunModal.tsx
  modified:
    - src/main/ipc/index.ts
    - src/main/ipc/transcripts.ts
    - src/shared/ipc-contract.ts
    - src/renderer/app/routes.tsx
    - src/renderer/features/settings/IntegrationsSection.tsx
    - tests/static/single-entitlement-gate-site.test.ts
decisions:
  - Added RESEARCH_SECRETS_SET + RESEARCH_SECRETS_HAS as 2 additional channels (not in original 12) because researchSecretsHas and secretsSetResearchKey must be invokable from renderer for key presence check and key save
  - GATED_SITES expanded from 5 to 7 entries (research_create and research_run on research.ts)
  - transcripts.ts emitToRenderer made optional to avoid breaking existing tests
  - researchJobRun returns { ok: true, reportId: '' } — reportId is empty string because the run is fire-and-forget; renderer learns the real reportId via RESEARCH_REPORT_DONE push event
metrics:
  duration: "~35 minutes"
  completed: "2026-05-21"
  tasks_completed: 2
  tasks_total: 2
  files_created: 7
  files_modified: 6
---

# Phase 11 Plan 02: IPC Wiring + Renderer Components Summary

**One-liner:** 14 IPC channels registered (12 research + 2 secrets), GATED_SITES ratchet updated to 7 sites, transcripts fire-and-forget hook added, /research route created, 6 renderer components (ResearchScreen + 5 children) + IntegrationsSection Brave/Exa key rows.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | research.ts IPC handlers + GATED_SITES + index.ts + transcripts.ts hook | 77fa954 | research.ts, index.ts, transcripts.ts, ipc-contract.ts, single-entitlement-gate-site.test.ts |
| 2 | Renderer components + route + Integrations key rows | 76792bf | ResearchScreen.tsx, NewResearchJobModal.tsx, ReportDocumentView.tsx, ReportDashboardView.tsx, FeedbackBar.tsx, RerunModal.tsx, routes.tsx, IntegrationsSection.tsx |

## Verification Results

### IPC channel count
- 12 research channels (job CRUD + run + report + feedback + suggestions): CONFIRMED
- 2 research secrets channels (set + has): CONFIRMED
- Total: 14 channels registered in researchChannels block in index.ts

### assertEntitled calls
- `assertEntitled(db, 'research_create')` in RESEARCH_JOB_CREATE handler: PASS
- `assertEntitled(db, 'research_run')` in RESEARCH_JOB_RUN handler: PASS
- Manual grep confirmed: only these 2 calls in research.ts (no other handlers gate on entitlement)

### Static ratchet
- GATED_SITES updated from 5 to 7 entries with 2 research.ts entries: CONFIRMED
- Manual node verification: both per-site tests PASS (assertEntitled literals present in research.ts)
- ABI worktree issue prevents vitest run; logic manually verified

### TypeScript compilation
- `npx tsc --noEmit` produces 0 new errors in research files
- Pre-existing 2 errors in RecapScreen.tsx + SchedulingRulesSection.tsx are unrelated

### transcripts.ts hook
- emitToRenderer optional in TranscriptHandlerDeps: CONFIRMED
- fire-and-forget detectResearchTopics call after return value assembled: CONFIRMED

### Route
- '/research' in READ_ONLY_ALLOW_LIST: CONFIRMED
- Route `<Route path="/research" element={<LockedGuard><ResearchScreen /></LockedGuard>} />` added: CONFIRMED

### Renderer components
- ResearchScreen: two-column 240px rail + flex-1 right panel, push event via onResearchReportDone
- NewResearchJobModal: Start Research disabled when hasKeys === false with tooltip
- ReportDocumentView: gold left-border summary + section cascade + version nav footer
- ReportDashboardView: 4 stat cards + CSS-only coverage chart + 2-col findings grid
- FeedbackBar: thumbs up/down calls researchFeedbackSave IPC
- RerunModal: Re-run button calls onRerun({ feedbackContext }) then onClose
- All use editorial CSS token variables (no raw colors)

### IntegrationsSection
- "Research — Brave Search" and "Research — Exa" key rows added: CONFIRMED
- input type="password" + save button + "Key saved" confirmation: CONFIRMED
- On save calls window.aria.researchSecretsSet({ provider, key }): CONFIRMED

## Deviations from Plan

### [Rule 2 - Missing Critical Functionality] Added RESEARCH_SECRETS_SET + RESEARCH_SECRETS_HAS channels

- **Found during:** Task 1
- **Issue:** Plan's IntegrationsSection spec called `window.aria.secretsSetResearchKey` and `window.aria.researchSecretsHas` but neither channel existed in ipc-contract.ts or CHANNEL_METHODS. Without these channels the renderer cannot save or check research API keys.
- **Fix:** Added RESEARCH_SECRETS_SET and RESEARCH_SECRETS_HAS to CHANNELS, AriaApi interface, and CHANNEL_METHODS in ipc-contract.ts. Registered in research.ts and added to the researchChannels block in index.ts.
- **Files modified:** src/shared/ipc-contract.ts, src/main/ipc/research.ts, src/main/ipc/index.ts
- **Commit:** 77fa954

## Known Stubs

None — all IPC handlers have full db-query implementations. All renderer components have full render logic wired to real IPC calls.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: elevation | src/main/ipc/research.ts | RESEARCH_JOB_RUN handler is fire-and-forget: entitlement check runs before dispatch but the response returns before the job completes. If assertEntitled throws the error is returned properly; the background job only runs after the gate passes. T-11-07 mitigated. |
| threat_flag: information_disclosure | src/renderer/features/research/NewResearchJobModal.tsx | researchSecretsHas returns boolean flags only (hasBrave, hasExa) — never the raw key. T-11-09 mitigated. |

## Self-Check: PASSED

- src/main/ipc/research.ts: FOUND
- src/renderer/features/research/ResearchScreen.tsx: FOUND
- src/renderer/features/research/NewResearchJobModal.tsx: FOUND
- src/renderer/features/research/ReportDocumentView.tsx: FOUND
- src/renderer/features/research/ReportDashboardView.tsx: FOUND
- src/renderer/features/research/FeedbackBar.tsx: FOUND
- src/renderer/features/research/RerunModal.tsx: FOUND
- commit 77fa954: FOUND
- commit 76792bf: FOUND
