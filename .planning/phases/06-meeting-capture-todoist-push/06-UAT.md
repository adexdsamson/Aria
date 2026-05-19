# Phase 6 UAT: Meeting Capture -> Todoist Push

## Scope

Validate the local-first meeting workflow from transcript paste through cited action extraction, explicit approval, Todoist push, Todoist pull, `/tasks` visibility, and briefing Open Actions.

## Manual Checks

1. Paste a transcript into `/meetings` and confirm Aria creates a local meeting note without importing or invoking any meeting bot SDK. Covered by automated tests.
2. Open the note review and confirm summary/action citations highlight the exact transcript span. Covered by automated tests.
3. Approve a `task_batch` card and confirm only approved actions are sent to Todoist. Covered by automated mocked integration tests.
4. Confirm created Todoist task descriptions include the Aria note deep link and approved cited quote. Covered by automated mocked integration tests.
5. Click Todoist `Sync now` in Settings and confirm pulled tasks appear in `/tasks`. Covered by Todoist IPC/sync and Tasks UI tests.
6. Confirm Aria-origin tasks in `/tasks` link back to the source meeting note. Covered by Tasks UI and mocked integration tests.
7. Generate or view briefing and confirm Open Actions shows due-soon/open tasks. Covered by BriefingScreen renderer test.
8. Enter an invalid Todoist token and confirm Settings shows a rejection/error state. Covered by Todoist client/IPC validation seams.
9. Simulate Todoist API failure during push and confirm approval remains approved with retryable error state. Covered by push-action error path behavior.

## Verification Run

- `tests/unit/main/db/migrations-123.spec.ts`
- `tests/unit/main/db/migrations-124.spec.ts`
- `tests/unit/main/db/migrations-125.spec.ts`
- `tests/unit/main/transcripts/`
- `tests/unit/renderer/features/meetings/`
- `tests/unit/renderer/features/approvals/ApprovalCard-task-batch.test.tsx`
- `tests/unit/main/integrations/todoist/`
- `tests/unit/main/ipc/todoist.spec.ts`
- `tests/unit/renderer/features/tasks/TasksScreen.test.tsx`
- `tests/unit/renderer/features/briefing/BriefingScreen.spec.tsx`
- `tests/static/no-meeting-bot-imports.test.ts`
- `tests/integration/meeting-to-todoist.spec.ts`

Result: 21 files passed, 38 tests passed.

## External Smoke

Live Todoist smoke passed with a real personal API token:

- Todoist pull sync fetched existing tasks into `/tasks`.
- Meeting transcript ingest created a ready `task_batch` approval.
- Approving the action pushed `Send Jordan the pricing deck` to Todoist.
- `/tasks` showed the pushed row as `Meeting action · Todoist synced`.

Cleanup note: delete the test task from Todoist if it should not remain in the real task list.
