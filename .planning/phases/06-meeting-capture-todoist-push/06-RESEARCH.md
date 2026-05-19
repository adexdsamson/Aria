# Phase 6 Research: Meeting Capture + Todoist Push

Date: 2026-05-19
Scope: MEET-01..06, TASK-01..02

## Research Summary

Phase 6 can be planned as three vertical waves:

1. Transcript/Note foundation: normalize pasted/uploaded transcripts, persist notes/actions/summary tables, link to calendar events, and enforce MEET-06 no-bot boundaries.
2. Extraction/review: generate cited summaries and action items with Zod schema, route sensitive transcript content correctly, and render a Note review UI plus task-batch approval card.
3. Todoist/tasks: connect Todoist via pasted personal API token, push approved actions, pull Todoist tasks, and render a unified Tasks view plus briefing open-actions section.

## Todoist API Findings

Todoist documentation has moved REST/Sync v2/v9 pages toward a unified API v1 surface, but the same core concepts remain:

- Official API docs show Bearer-token authorization against `https://api.todoist.com/api/v1/...` and a sync endpoint at `/api/v1/sync`.
- Sync commands use UUIDs and command arrays, with `sync_status` reporting per-command success.
- Task completion/close semantics are nuanced: recurring tasks advance rather than simply archive. Use Todoist client/library wrappers where possible for task close/reopen behavior.
- The official TypeScript client constructs as `new TodoistApi(authToken, options?)` and remains the best typed path for REST task/project APIs.

Sources:

- [Todoist API docs](https://developer.todoist.com/api/v1/)
- [Todoist API TypeScript client docs](https://doist.github.io/todoist-api-typescript/api/classes/TodoistApi/)

## Implementation Implications

- Prefer `@doist/todoist-api-typescript` for token validation and push operations in wave 3.
- Use a thin internal Todoist adapter wrapper so API-v1 vs REST-v2 endpoint naming churn is isolated behind tests.
- For pull sync, plan a local adapter abstraction that can call Sync API directly if the TS client does not expose incremental sync sufficiently. Keep this out of wave 1/2.
- Store Todoist token in safeStorage provider-token namespace, e.g. `todoist:default`.
- Expand provider abstractions carefully: current `ProviderKey` is only `google | microsoft`, and `provider_sync_state.resource` only allows `mail | calendar`. Phase 6 must migrate these before registering Todoist task sync.

## Transcript Parsing Findings

No dependency is required for v1 raw text. VTT/SRT support can be implemented with small deterministic parsers:

- VTT cues: optional cue id, time range line, one or more text lines.
- SRT cues: numeric cue id, time range with comma millisecond separator, text lines.
- JSON exports should be treated as best-effort adapters for arrays/objects with speaker/start/end/text-like fields.
- PDF/DOCX ingestion should be deferred to a later wave unless already installed dependencies make it cheap; Phase 6 success criteria only require paste/upload "any text format", so `.txt`, `.vtt`, `.srt`, and `.json` cover the MVP without native parser risk.

## Key Risks

- Migration numbering: current runner maps `012a` to user_version `121`; normal `015_*` files would be skipped. Phase 6 migrations should use `123_*`, `124_*`, etc.
- Transcript content is sensitive. Extraction must go through the existing routing/redaction discipline, and logs must never include raw transcript text.
- Action citations must be character offsets into normalized text, not generated quotes alone.
- Approval schema currently only allows `email_send | calendar_change`; task-batch approvals require a migration and renderer branching.
- Todoist API token rejection should hard-pause only Todoist, not other providers.

## Planning Decision

Use three plans matching ROADMAP estimates:

- `06-01-PLAN.md`: Note/transcript foundation and no-bot guardrails.
- `06-02-PLAN.md`: Extraction, cited review UI, task-batch approvals.
- `06-03-PLAN.md`: Todoist adapter, push/pull sync, Tasks view, briefing open actions, UAT.
