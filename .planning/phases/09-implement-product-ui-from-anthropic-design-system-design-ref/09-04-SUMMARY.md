---
phase: 09-implement-product-ui-from-anthropic-design-system-design-ref
plan: 04
subsystem: renderer / workspace screens (batch 2)
tags: [ui, meetings, tasks, ask, recap, re-skin, phase-9]
requires: [09-01, 09-02, 09-03]
provides:
  - editorial-meetings
  - editorial-tasks
  - editorial-ask
  - editorial-recap
affects:
  - src/renderer/features/meetings/*
  - src/renderer/features/tasks/*
  - src/renderer/features/ask/*
  - src/renderer/features/recap/*
key-files:
  created: []
  modified:
    - src/renderer/features/meetings/TranscriptCaptureScreen.tsx
    - src/renderer/features/meetings/NoteView.tsx
    - src/renderer/features/meetings/NoteReviewScreen.tsx
    - src/renderer/features/meetings/CitationHighlighter.tsx
    - src/renderer/features/tasks/TasksScreen.tsx
    - src/renderer/features/tasks/TaskRow.tsx
    - src/renderer/features/ask/AskScreen.tsx
    - src/renderer/features/ask/AnswerCard.tsx
    - src/renderer/features/ask/CitationList.tsx
    - src/renderer/features/ask/SourcePreview.tsx
    - src/renderer/features/recap/RecapScreen.tsx
    - src/renderer/features/recap/RecapEditor.tsx
decisions:
  - "Q-01 default honoured: CitationHighlighter remains inline-only — no hover popovers. The 09-CONTEXT.md instruction was explicit; deferring popovers to a follow-on plan if product asks."
  - "AnswerCard refusal eyebrow ('No answer found') is rendered INSIDE the data-testid='answer-refusal' element — safe because the existing test uses toHaveTextContent (substring match) against REFUSAL_TEXT. Distinct from 09-03's SchedulingChat constraint, which used exact-regex assertions and required externalising the eyebrow."
  - "TaskRow 'task-source' textContent contract preserved verbatim ('Meeting action · Todoist synced' | 'Meeting action' | 'Todoist'). Re-skin lifted the source label into a mono uppercase smallcaps but the inner string output is character-identical to pre-Phase-9."
  - "RecapEditor providerLabel object literals ({ gmail: 'Gmail', outlook: 'Outlook', ... }) retained verbatim to keep the H-4 grep ratchet from Plan 08-02 green. 'What Aria did' literal and audit-row data-testid preserved."
  - "Pre-existing TS error in RecapScreen.tsx:45 (TS2367 on res.ok narrowing) left untouched per pre-authorisation envelope — line not removed by re-skin."
metrics:
  completed: 2026-05-20
  duration_minutes: 22
  tasks_completed: 3
  files_modified: 12
---

# Phase 9 Plan 04: Workspace Re-skin Batch 2 Summary

Meetings + Tasks + Ask Aria + Recap — the four heaviest reading surfaces in the product, re-skinned to the editorial design system from Plans 09-01 / 09-02 / 09-03.

## Tasks Completed

| Task | Name                                                                                | Commit    | Files                                                                                            |
| ---- | ----------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| 1    | Meetings re-skin (TranscriptCapture + NoteView + NoteReviewScreen + CitationHighlighter) | `f0f3eea` | TranscriptCaptureScreen, NoteView, NoteReviewScreen, CitationHighlighter                          |
| 2    | Tasks + Ask Aria re-skin                                                             | `ad440b1` | TasksScreen, TaskRow, AskScreen, AnswerCard, CitationList, SourcePreview                          |
| 3    | Recap re-skin (RecapScreen + RecapEditor)                                            | `9bf1e02` | RecapScreen, RecapEditor                                                                          |

## What Shipped

### Task 1 — Meetings (commit `f0f3eea`)

- **TranscriptCaptureScreen**: editorial header (mono eyebrow "Paste or upload a transcript" + Playfair "Meeting capture"). Paste form lives inside a `<Card>` with editorial Source-Sans labels for title/file/transcript, mono format hint ("Supports plain text, VTT, SRT, JSON, Markdown, Otter export"), primary `<Button>` "Extract action items", and a centered smallcaps trust line ("Aria does not join calls — paste only (MEET-06)") at the bottom.
- **NoteView**: read-only viewer wrapped in `<Card>`. Playfair title + mono "Linked to {id}" / "Standalone note" status row (test-id `note-link-status` textContent unchanged). Transcript pre on ivory-deep canvas. Segment chips use mono uppercase + rule-strong underline.
- **NoteReviewScreen**: two-column editorial layout. Left column = `<LabelRule label="Transcript" align="left">` followed by `<CitationHighlighter>`. Right column = `<Card>` rail with a "Push as task batch" primary button at the top (UI hook only — task-batch IPC routing already passes through approvals queue), then five `<SummarySection>` cards (Topics · Decisions · Action items · Follow-ups · Open Questions). Action items rendered in ivory-deep nested cards with editorial selects.
- **CitationHighlighter**: inline `<mark>` keeps the 60%-opacity gold underline + 12% gold background tint per Q-01 default. NO hover popovers added. `citation-text` and `citation-highlight` test-ids preserved.

Tests: 2/2 meetings test files pass (TranscriptCaptureScreen + NoteReviewScreen).

### Task 2 — Tasks + Ask Aria (commit `ad440b1`)

- **TasksScreen**: editorial header with smallcaps "Tasks" eyebrow and Playfair "Open work" + right-aligned mono "{n} open" counter. Source filter chips (All / Todoist / Meeting actions) use the gold-tinted active state pattern from 09-03 approvals. "Show completed" checkbox is mono uppercase with gold accent.
- **TaskRow**: editorial card with custom 18×18 checkbox (rounded square, gold check, gold-tinted active fill). Playfair title applies line-through + gray when completed. Mono meta row underneath: priority pip (rose for P4+, gold for P3, ink-soft for P2, gray-faint for P1) + due chip (gold-tinted when imminent ≤2 days, rose-tinted when overdue, gray otherwise) + project chip (ivory-deep paper bg with rule border) + label chips (mono uppercase). Gold-underlined "Open meeting note →" appears only for `source==='aria' && noteId`.
- **AskScreen**: 256px threads rail (left) with mono "+" new-thread button, active row uses 2px gold left rail + ivory-deep bg. Per-account filter chips in a 14px-padded header with smallcaps "Filter accounts" prefix. Composer is a Playfair-italic textarea (Cmd-K parity) with primary `<Button>` "Ask". User-turn bubbles are right-aligned ivory-deep with rule border.
- **AnswerCard**: `<article className="card card-accent-top">` with mono "Answer" smallcaps + `<RouteBadge>` from 09-01 primitives + model id sibling smallcaps. Body is Source Sans 15px / 1.6 line-height. Footer carries the routing summary (route · sensitivity · directory-stale hint) and ▲/▼ mono triangle thumbs (replacing emoji); active thumb is gold-tinted. Refusal/error/disambiguation modes restyled in editorial palette; disambiguation uses `<Card>` with rose top-rule.
- **CitationList**: chunk-level rows with kind tag (mono uppercase EMAIL → "Email" etc.), underlined `title` (rule-strong 3px-offset underline), snippet, account chip (rose tint + "(disconnected)" preserved), Intl-formatted timestamp aligned to the right.
- **SourcePreview**: gold left-rail accent (3px var(--gold)), mono kind eyebrow, char-range smallcaps footer.

Tests: 12/12 tasks + ask tests pass.

### Task 3 — Recap (commit `9bf1e02`)

- **RecapScreen**: editorial header with smallcaps "Friday close · trust anchor" eyebrow and Playfair "Weekly recap". Generate-button restyled as outline. Past recaps render as `card card-hover` rows: Playfair isoWeek + mono "Week of {ymd}" + status pill (Draft = ivory-deep + rule-strong border; Finalized = moss tint + moss border).
- **RecapEditor**: each editable section (`meetings`, `actions`, `wins`, `upcoming`) labelled with `<LabelRule align="left" label="…">` (Meetings · Commitments · Wins · Upcoming) and a paper-card surface for the TipTap `<EditorContent>`. "What Aria did" section uses the same `LabelRule` + an ivory-deep textarea for the editable Playfair-italic narrative + a verbatim read-only audit list (`<ul data-testid="recap-audit-list">` with rule-bottom rows). Toast restyled in moss tint.
- Footer button row: Save (outline) · Finalize (primary) on the left; Export DOCX (outline) · Export PDF (outline) on the right. Status pill (Draft / Finalized) sits top-right of the editor header.

Behaviour invariants preserved:
- `recapList` / `recapRegenerate` / `recapSaveEdits` / `recapFinalize` / `recapExportDocx` / `recapExportPdf` IPC untouched.
- TipTap StarterKit per-section editor instances and `setEditable(!readOnly)` lifecycle intact.
- `providerLabel` object literal `{ gmail: 'Gmail', outlook: 'Outlook', google: 'Google', microsoft: 'Outlook', todoist: 'Todoist' }` retained verbatim → H-4 grep ratchet (`RecapScreen.test.tsx`) stays green.
- "What Aria did" string preserved; no `'Sent draft via Gmail'` literal introduced anywhere.
- All data-testids unchanged.

Tests: 4/4 RecapScreen tests pass (incl. H-4 ratchet).

## Test coverage

- `npx vitest run tests/unit/renderer/features/meetings` → 2 files / 2 tests pass.
- `npx vitest run tests/unit/renderer/features/tasks tests/unit/renderer/features/ask` → 2 files / 12 tests pass.
- `npx vitest run src/renderer/features/recap` → 1 file / 4 tests pass.
- Total: 5 files / 18 tests pass, behavioural tests unmodified.

## Deviations from Plan

None. Plan 09-04 executed exactly as written under the pre-authorised Option-2 envelope. The 09-03 SchedulingChat-style textContent escape hatch was not required for AnswerCard refusal (`toHaveTextContent` is substring-based — a smallcaps eyebrow inside the test-id element is safe).

## Verification Results

| Criterion                                                                          | Status                                                                                         |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 3 tasks committed                                                                  | PASS — `f0f3eea`, `ad440b1`, `9bf1e02`.                                                        |
| All 4 surfaces (Meetings/Tasks/Ask/Recap) re-skinned using editorial primitives    | PASS — `components/editorial` imported in 8 of 12 modified files (the 4 leaf primitives intentionally use raw tokens). |
| No IPC / state / hook changes                                                      | PASS — `git diff` shows zero changes to `window.aria.*` signatures, state shapes, or hooks.   |
| Q-01 default — no hover popovers in CitationHighlighter                            | PASS — inline `<mark>` only.                                                                  |
| Behavioural tests pass unmodified                                                  | PASS — 18/18 targeted tests pass.                                                              |
| Snapshot tests updated                                                             | N/A — no snapshot tests on these features.                                                    |
| Cmd-K → /ask flow still functional, expand-to-chat still wired                     | PASS — AskScreen IPC + `?thread=` hydration + transient-filter logic preserved verbatim.       |
| DOCX + PDF recap export buttons wired                                              | PASS — only restyled to outline `<Button>`; `recapExportDocx`/`recapExportPdf` calls unchanged. |
| MEET-06 no-bot guardrail copy preserved                                            | PASS — grep yields 2 hits in TranscriptCaptureScreen.                                          |
| H-4 providerLabel grep ratchet preserved                                           | PASS — RecapScreen.test.tsx Test 8/9 still green.                                              |
| `task-source` textContent contract preserved                                       | PASS — TaskRow returns the three exact strings; tasks test passes.                             |
| Reachability                                                                       | PASS — every modified file imported by the same parent screen / route as before this plan.    |

## Success Criteria

| Criterion                                                                                              | Status |
| ------------------------------------------------------------------------------------------------------ | ------ |
| Meetings, Tasks, Ask Aria, Recap render in editorial style                                             | READY — composition matches design-ref/project/app-screen-{meetings,tasks,ask,recap}.jsx. Manual dev-build smoke deferred per envelope. |
| TipTap editor still works, citations still highlight, Todoist push still works, RAG citations still resolve | PASS — all IPC + TipTap editor lifecycle + citation char-offset contract + Todoist push surface preserved verbatim. |
| DisconnectConfirmDialog 3-assertion contract still passes wherever it gates a destructive action       | N/A in this plan — Recap finalize uses inline toast, not DisconnectConfirmDialog (deferred to 09-06 Settings re-skin where DisconnectConfirmDialog is in scope). |

## Self-Check: PASSED

- `src/renderer/features/meetings/TranscriptCaptureScreen.tsx` — modified.
- `src/renderer/features/meetings/NoteView.tsx` — modified.
- `src/renderer/features/meetings/NoteReviewScreen.tsx` — modified.
- `src/renderer/features/meetings/CitationHighlighter.tsx` — modified.
- `src/renderer/features/tasks/TasksScreen.tsx` — modified.
- `src/renderer/features/tasks/TaskRow.tsx` — modified.
- `src/renderer/features/ask/AskScreen.tsx` — modified.
- `src/renderer/features/ask/AnswerCard.tsx` — modified.
- `src/renderer/features/ask/CitationList.tsx` — modified.
- `src/renderer/features/ask/SourcePreview.tsx` — modified.
- `src/renderer/features/recap/RecapScreen.tsx` — modified.
- `src/renderer/features/recap/RecapEditor.tsx` — modified.
- Commits `f0f3eea`, `ad440b1`, `9bf1e02` — all present in `git log`.
- Targeted vitest: 18/18 tests pass across meetings + tasks + ask + recap.
