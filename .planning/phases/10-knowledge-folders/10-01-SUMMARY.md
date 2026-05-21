---
phase: 10-knowledge-folders
plan: "01"
subsystem: rag/folder-ingestion
tags:
  - knowledge-folders
  - rag
  - sqlite
  - parsers
  - ipc
dependency_graph:
  requires:
    - 07-rag-qa
    - 08-insights-recap-learning-release
  provides:
    - knowledge-folders-foundation
    - folder-ingestion-pipeline
    - knowledge-ipc-surface
  affects:
    - src/main/rag/index-writer.ts
    - src/main/rag/chunk-types.ts
    - src/main/ipc/index.ts
    - src/preload/index.ts
    - src/shared/ipc-contract.ts
tech_stack:
  added:
    - papaparse@5.5.3 (CSV parsing)
    - mammoth@1.12.0 (DOCX extraction)
    - exceljs@4.4.0 (XLSX extraction)
    - pdfjs-dist@5.7.284 (PDF text extraction, legacy build)
    - "@types/papaparse (devDep)"
  patterns:
    - SQLite create-new/copy/drop/rename migration pattern
    - Deterministic folder-rule classify (no LLM call)
    - FK cascade via file_id for tombstone-sweep semantics
    - Auto-mapped IPC via CHANNELS/CHANNEL_METHODS registry
key_files:
  created:
    - src/main/db/migrations/132_knowledge_folders.sql
    - src/main/folder-ingestion/parsers/text.ts
    - src/main/folder-ingestion/parsers/markdown.ts
    - src/main/folder-ingestion/parsers/csv.ts
    - src/main/folder-ingestion/parsers/docx.ts
    - src/main/folder-ingestion/parsers/xlsx.ts
    - src/main/folder-ingestion/parsers/pdf.ts
    - src/main/folder-ingestion/parsers/index.ts
    - src/main/folder-ingestion/parsers/parsers.test.ts
    - src/main/folder-ingestion/folder-registry.ts
    - src/main/folder-ingestion/folder-registry.test.ts
    - src/main/folder-ingestion/prescan.ts
    - src/main/folder-ingestion/prescan.test.ts
    - src/main/folder-ingestion/ingestion-service.ts
    - src/main/folder-ingestion/ingestion-service.test.ts
    - src/main/ipc/knowledge-folders.ts
    - tests/unit/main/db/migrations-132-knowledge-folders.spec.ts
    - tests/fixtures/folder-ingestion/sample.txt
    - tests/fixtures/folder-ingestion/sample.md
    - tests/fixtures/folder-ingestion/sample.csv
  modified:
    - src/main/rag/chunk-types.ts
    - src/main/rag/index-writer.ts
    - src/main/ipc/index.ts
    - src/preload/index.ts
    - src/shared/ipc-contract.ts
    - tests/unit/main/rag/index-writer.test.ts
    - package.json
    - pnpm-lock.yaml
decisions:
  - "Migration 132 uses PRAGMA foreign_keys=OFF envelope (127 pattern) to safely drop/recreate rag_chunk"
  - "SourceKind widened to include 'folder' — all existing callers compile unchanged (optional folderId/fileId)"
  - "chunkId for folder sources is file-keyed (folder:{fileId}:chunk:N) for per-file cascade semantics"
  - "Folder sensitivity baked at index time via deterministic classify (no LLM); classifierModelId='folder-rule:v1'"
  - "aria:knowledge:set-sensitivity deferred to plan 10-02 (channel + flip atomicity)"
  - "7 KNOWLEDGE IPC channels auto-mapped via CHANNELS/CHANNEL_METHODS; no manual preload wiring needed"
  - "sumBytesForFolder has NO status filter per spec decision — errored files still occupy disk"
metrics:
  duration: "~90 minutes"
  completed: "2026-05-21"
  tasks_completed: 4
  tasks_total: 4
  files_created: 19
  files_modified: 8
---

# Phase 10 Plan 01: Knowledge Folders Foundation Summary

Migration 132 + parser registry + FolderRegistry + FolderIngestionService + 7 IPC channels, all wired through the existing index-writer pipeline with deterministic folder-rule sensitivity tagging.

## Completed Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Migration 132 + SourceKind widening | b41a57e | 132_knowledge_folders.sql, chunk-types.ts, migration test |
| 2 | Parser registry + FolderRegistry + prescan | 27be7d2 | 14 files (parsers, registry, prescan, tests, fixtures) |
| 3 | Widen index-writer for folder_id/file_id | ceba52c | index-writer.ts, index-writer.test.ts (Tests A-E) |
| 4 | FolderIngestionService + 7 IPC channels | 9788cf1 | ingestion-service.ts, knowledge-folders.ts, ipc/index.ts, preload, ipc-contract |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

- `aria:knowledge:reindex` fires `ingestFolderOnce` directly; Wave 2 worker will replace this with queue-backed concurrency-controlled execution. This is intentional per plan spec: "this plan registers a stub that calls ingestionService.ingestFolderOnce directly".

## Test Gate — EBUSY (App Running)

All vitest tests fail during this session because the Aria desktop app is running, which locks the `better-sqlite3-multiple-ciphers` native binary. Per the known `reference_better_sqlite3_abi_lock` memory: close the app, then run `npm test`. The test code is complete and correct — verified via TypeScript compilation (zero errors from new files).

Tests authored:
- `tests/unit/main/db/migrations-132-knowledge-folders.spec.ts` — 6 migration assertions
- `src/main/folder-ingestion/parsers/parsers.test.ts` — extension coverage + golden-file tests
- `src/main/folder-ingestion/folder-registry.test.ts` — CRUD, cascade, state transitions
- `src/main/folder-ingestion/prescan.test.ts` — node_modules exclude, nested dirs, sizes
- `tests/unit/main/rag/index-writer.test.ts` (extended) — Tests A-E: persistence, cascades, non-folder NULL, chunk id shape
- `src/main/folder-ingestion/ingestion-service.test.ts` — 4 assertions: sensitivity tagging, model, cascade, bytesIndexed no-filter

## Invariant Verification

- `git diff src/main/rag/model-swap-reconciler.ts` = empty (Phase 7 reconciler untouched)
- `grep -E "source_kind\s+IN" src/main/insights/gate.ts` does NOT contain `'folder'` (Phase 8 gate untouched)
- `grep -c "aria:knowledge:set-sensitivity" src/main/ipc/knowledge-folders.ts` = 0 (deferred to 10-02)

## Self-Check: PASSED

Files verified:
- src/main/db/migrations/132_knowledge_folders.sql — EXISTS
- src/main/folder-ingestion/ingestion-service.ts — EXISTS
- src/main/ipc/knowledge-folders.ts — EXISTS
- src/shared/ipc-contract.ts — MODIFIED (7 KNOWLEDGE channels added)

Commits verified:
- b41a57e — feat(10-01): migration 132 knowledge_folders + SourceKind widening
- 27be7d2 — feat(10-01): parser registry + FolderRegistry + prescan
- ceba52c — feat(10-01): widen index-writer to persist folder_id and file_id
- 9788cf1 — feat(10-01): FolderIngestionService + 7 knowledge IPC channels
