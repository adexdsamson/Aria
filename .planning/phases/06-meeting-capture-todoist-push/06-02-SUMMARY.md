# Phase 6 Wave 2 Summary

Date: 2026-05-19
Plan: `06-02-PLAN.md`
Status: Completed

## Delivered

- Added migration `124_meeting_extraction_approvals.sql`.
- Added `meeting_summary`, `meeting_summary_item`, and `meeting_action` tables.
- Widened `approval.kind` to include `task_batch`.
- Added nullable `approval.meeting_note_id`.
- Added transcript chunking with overlap and absolute offset preservation.
- Added citation validation, quote extraction, and chunk-relative to note-relative offset conversion.
- Added meeting extraction schema and `extractMeetingArtifacts` wrapper with `generateObject` test seam.
- Added action dedupe by normalized text and overlapping citation spans.
- Added `transcriptGetReview` IPC to fetch note, summary items, and actions.
- Added `NoteReviewScreen` and `CitationHighlighter`.
- Added `TaskBatchApprovalCard` branch in `ApprovalCard`.

## Extraction Route Evidence

- Extraction wrapper accepts `route` and `modelName` and returns route/model metadata with artifacts.
- The implementation keeps transcript text in-memory through the extraction prompt path and does not add transcript logging.
- Full sensitivity/router orchestration remains a wave-3 hardening candidate if Todoist push exposes additional outbound paths.

## Citation Coverage

- PASS: Citation spans validate against `meeting_note.normalized_text` bounds.
- PASS: Invalid spans are discarded before artifacts are returned.
- PASS: Chunk citations are offset back to absolute note positions.
- PASS: Review UI highlights clicked citation spans.

## Approval Queue Behavior

- PASS: `task_batch` approval cards render extracted actions.
- PASS: `unassigned` actions remain visible but are disabled for approval/push.
- PASS: Approving a task-batch card passes only selected pushable actions as edited body payload.
- PASS: No Todoist push/send path exists in wave 2.

## Verification

- PASS: Focused wave-2 suite: 8 files, 12 tests.
- PASS: Migration suite updated; latest `user_version` is `124`.
- PASS: Static grep for Todoist push/create-task strings in wave-2 transcript/review paths returned no matches.
- PASS: Node typecheck introduced no new errors; only known baseline remains.
- PASS: Renderer typecheck introduced no new errors; only known baseline remains.

## Known Baseline Typecheck Errors

- `src/main/drafting/email.ts(33,1)` unused `crypto`
- `src/main/ipc/scheduling.ts(70,24)` implicit `any`
- `src/main/ipc/scheduling.ts(75,25)` implicit `any`
- `src/main/ipc/triage.ts(51,10)` unused `buildPromptFromMessages`
- `src/main/scheduling/resolver.ts(289,16)` wrong argument count
- `src/renderer/features/settings/SchedulingRulesSection.tsx(437,9)` `unknown` not assignable to `ReactNode`

## Carry Forward

- Wave 3 owns Todoist token connection, push/pull sync, Tasks view, briefing Open Actions, and UAT.
- Wave 3 should turn approved `task_batch` payloads into idempotent Todoist task creation.
