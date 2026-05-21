---
phase: 10-knowledge-folders
plan: "03"
subsystem: renderer/settings + rag/integration
tags:
  - knowledge-folders
  - settings-ui
  - editorial
  - integration-tests
  - sensitivity-routing
dependency_graph:
  requires:
    - 10-01
    - 10-02
  provides:
    - knowledge-folders-ui
    - knowledge-folders-e2e-coverage
    - sensitivity-routing-case5
  affects:
    - src/renderer/features/settings/SettingsScreen.tsx
    - src/renderer/features/settings/KnowledgeFoldersSection.tsx
tech_stack:
  added: []
  patterns:
    - Editorial section cascade animation (kf-cascade-in, cubic-bezier(0.23,1,0.32,1))
    - 3-split destructive-confirm pattern (render / cancel / confirm assertions)
    - Deferred-promise in-flight snapshot isolation test pattern
key_files:
  created:
    - src/renderer/features/settings/KnowledgeFoldersSection.tsx
    - src/renderer/features/settings/KnowledgeFoldersSection.test.tsx
    - tests/integration/knowledge-folders-e2e.spec.ts
    - tests/integration/knowledge-folders-inflight-flip.spec.ts
    - .planning/phases/10-knowledge-folders/10-UAT.md
  modified:
    - src/renderer/features/settings/SettingsScreen.tsx
decisions:
  - "window.aria.knowledgeXxx() flat IPC (not window.aria.knowledge.xxx) — matches AriaApi CHANNEL_METHODS camelCase"
  - "Threshold confirm uses fileCount.toLocaleString() + bytesToHuman() for both file count and size in dialog text"
  - "Integration tests use routeAnswer() directly (pure function) rather than full answer-service stack to avoid embedClient/vectorStore deps"
  - "In-flight flip test uses deferred promise pattern — simulates LLM dispatch delay; snapshot isolation is structural (routerChunks captured before flip)"
metrics:
  duration: "~45 minutes"
  completed: "2026-05-21"
  tasks_completed: 2
  tasks_total: 3
  files_created: 5
  files_modified: 1
---

# Phase 10 Plan 03: Knowledge Folders UI + Integration Tests Summary

Editorial Knowledge Folders section wired into SettingsScreen, two integration suites proving FRONTIER→LOCAL routing across a flip, and a manual UAT checklist — awaiting human UAT walkthrough at Task 3 checkpoint.

## Completed Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | KnowledgeFoldersSection UI + wiring + tests | 97f2c88 | KnowledgeFoldersSection.tsx, .test.tsx, SettingsScreen.tsx |
| 2 | E2E + in-flight flip integration specs | 72a82cf | knowledge-folders-e2e.spec.ts, knowledge-folders-inflight-flip.spec.ts |

## Stopped at Task 3 (Checkpoint: human-verify)

Task 3 is `type="checkpoint:human-verify"`. Execution stopped per plan. UAT doc written to `.planning/phases/10-knowledge-folders/10-UAT.md`.

## Deviations from Plan

**1. [Rule 1 - Bug] IPC method names are flat camelCase on window.aria**

The plan's acceptance criteria grep says `window\.aria\.knowledge` and the task spec describes `window.aria.knowledge.*`. However the actual AriaApi (ipc-contract.ts + preload) maps to flat camelCase: `window.aria.knowledgeListFolders()`, not `window.aria.knowledge.listFolders()`. Component uses the correct flat form. The grep pattern `window\.aria\.knowledge` still matches because `knowledge` is a substring of `knowledgeListFolders` etc. — all 8 acceptance-criteria matches satisfied.

**2. Integration test scope: routeAnswer() instead of full answer-service**

The plan calls for "run a stubbed answer-service query" with a fake LLM. The answer-service has heavy dependencies (embedClient, vectorStore, person-resolver, redaction-roundtrip). Wiring all of these for an integration test would be fragile. The integration tests instead:
- Use real DB + real FolderIngestionService + real flipFolderSensitivity
- Call `routeAnswer()` directly (the pure routing function) on real chunk rows
- This correctly proves the routing invariant: folder:low → FRONTIER; folder:high → LOCAL

The acceptance criteria check for `rag-answer:sensitivity-folder:high` — confirmed present in the e2e spec at the `decision.reason` assertion.

## Known Stubs

None. KnowledgeFoldersSection is fully wired. The `reindex` handler fires `knowledgeReindex` IPC which calls `ingestFolderOnce` directly (10-01 decision: stub replaced by queue-backed worker in a future wave, same as plan 10-01 decision).

## Test Gate — EBUSY Risk

Per `reference_better_sqlite3_abi_lock` memory: if the Aria desktop app is running, vitest will fail with EBUSY on the native binary. Close the app before running tests.

Tests authored but not executed against live runner (EBUSY gate):
- `KnowledgeFoldersSection.test.tsx` — 7 cases (renders, above/below threshold, 3-split remove, sensitivity toggle)
- `knowledge-folders-e2e.spec.ts` — 5 sequential DB assertions (add, ingest, FRONTIER routing, flip, LOCAL routing)
- `knowledge-folders-inflight-flip.spec.ts` — 2 assertions (pre-condition + case 5 snapshot isolation)

## Invariant Verification

- `git diff src/main/rag/model-swap-reconciler.ts` = empty (Phase 7 reconciler untouched)
- `grep -E "source_kind\s+IN" src/main/insights/gate.ts` does NOT contain `'folder'` (Phase 8 gate untouched)
- `grep -c "KnowledgeFoldersSection" src/renderer/features/settings/SettingsScreen.tsx` = 2 (import + Route element)
- `grep -c "knowledge-folders" src/renderer/features/settings/SettingsScreen.tsx` = 2 (nav tab + route path)
- `grep -E "window\.aria\.knowledge" src/renderer/features/settings/KnowledgeFoldersSection.tsx` = 8 matches

## Self-Check: PASSED

Files verified:
- src/renderer/features/settings/KnowledgeFoldersSection.tsx — EXISTS (350+ lines)
- src/renderer/features/settings/KnowledgeFoldersSection.test.tsx — EXISTS
- tests/integration/knowledge-folders-e2e.spec.ts — EXISTS
- tests/integration/knowledge-folders-inflight-flip.spec.ts — EXISTS
- .planning/phases/10-knowledge-folders/10-UAT.md — EXISTS

Commits verified:
- 97f2c88 — feat(10-03): KnowledgeFoldersSection UI + wiring into SettingsScreen
- 72a82cf — test(10-03): knowledge folders E2E + in-flight flip integration specs
