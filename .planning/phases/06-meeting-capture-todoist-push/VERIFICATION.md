---
phase: 06-meeting-capture-todoist-push
verified: 2026-05-19T00:00:00Z
status: gaps_found
score: 9/12 dimensions PASS, 1 PARTIAL, 2 WARNING
requirements_score: 7/8 PASS, 1 PARTIAL (MEET-05 chokepoint weakness)
verdict: PASS_WITH_DEFERRED — recommend commit after addressing one BLOCKER (e2e stub) and one HIGH (push chokepoint hardening)
gaps:
  - truth: "tests/e2e/meeting-to-todoist.spec.ts exercises the user flow"
    status: failed
    reason: "File is a 13-line trivial stub that asserts a static array literal contains 'push Todoist task'. No transcript paste, no IPC, no UI driving, no Playwright _electron. Coverage was claimed (SUMMARY wave 3 + UAT line listing it as a 'Verification Run' file) but the file does not exercise anything."
    artifacts:
      - path: "tests/e2e/meeting-to-todoist.spec.ts"
        issue: "Stub assertion: expect([...]).toContain('push Todoist task'). 13 lines total."
    missing:
      - "Real Playwright _electron e2e OR explicit downgrade to 'covered by tests/integration/meeting-to-todoist.spec.ts' with the e2e file deleted to stop overclaiming coverage."
  - truth: "Approved-only chokepoint protects Todoist push (MEET-05 / TASK-01 trust posture mirroring email_send + calendar_change)"
    status: partial
    reason: "pushApprovedMeetingActions reads meeting_action rows by approval_id with no verification that the parent approval is actually in state='approved'. Compare to email_send (assertApproved in gmail-send) and calendar_change (assertApproved in applyCalendarChange). The renderer-side gate only fires push after a successful approve, but a malicious or buggy direct IPC call to todoistPushApprovedActions with any approval_id whose meeting_action rows have pushable=1 would still send."
    artifacts:
      - path: "src/main/integrations/todoist/push-actions.ts"
        issue: "No assertApproved-equivalent on the parent approval row; SQL filters only on a.pushable=1 AND a.status IN ('draft','approved','failed')."
      - path: "src/main/ipc/todoist.ts:100-109"
        issue: "TODOIST_PUSH_APPROVED_ACTIONS handler validates approvalId presence and Todoist token, but does not query approval.state before invoking push."
    missing:
      - "Add an approval-state guard at the top of pushApprovedMeetingActions: load approval row by id, refuse unless state IN ('approved','sending','failed'). Mirrors the APPR-01 chokepoint pattern from Phase 3."
human_verification:
  - test: "Cleanup leftover Todoist task from the wave-3 live smoke"
    expected: "'Send Jordan the pricing deck' task removed from real Todoist account if undesired"
    why_human: "Live API state mutation; SUMMARY explicitly notes cleanup is a human responsibility."
  - test: "Live re-auth UX when Todoist token rejected after initial connect"
    expected: "Provider account row flips to status='degraded' with last_error visible in Settings; user can re-paste token"
    why_human: "Requires real API token + token revocation against Todoist."
---

# Phase 6: Meeting Capture + Todoist Push — Verification Report

**Phase Goal (from ROADMAP / SC):**
1. User pastes a transcript; Aria links it to the right calendar event and produces a summary with cited action items.
2. Approved action items appear in Todoist within one sync cycle.
3. Every action item is clickable to the source transcript span.
4. Aria does not join meetings as a bot or store cloud recordings (verifiable by code review and tests).

**Verified:** 2026-05-19 — uncommitted working tree, same pattern as Phase 5 audit.
**Status:** gaps_found (1 BLOCKER, 1 HIGH, 0 documentation)

---

## Requirements Coverage

| Req | Description | Plan | Evidence | Verdict |
|---|---|---|---|---|
| MEET-01 | Paste/upload transcript; ingest linked to calendar event when possible | 06-01 | `src/main/transcripts/ingest.ts:1-148`, `link-calendar.ts`, `normalize.ts` supports paste/txt/vtt/srt/json; migration 123_meeting_notes.sql columns event_provider_key/event_account_id/calendar_event_id; IPC TRANSCRIPT_INGEST registered (ipc/index.ts:317-327) | PASS |
| MEET-02 | Extract action items with owners + due-date hints; surface for review | 06-02 | `src/main/transcripts/extract.ts` + `chunk.ts` + `dedupe-actions.ts`; migration 124 adds meeting_action table with owner/due_iso/due_confidence/priority_hint; NoteReviewScreen renders + TaskBatchApprovalCard branch in ApprovalCard | PASS |
| MEET-03 | Every action has citation to transcript span; user can click to verify | 06-02 | `meeting_action.citation_start/citation_end` (FK to meeting_note, CHECK end>start); `citations.ts` validates against normalized_text bounds; `CitationHighlighter.tsx`; integration test asserts citation persisted and reflected in Todoist description | PASS |
| MEET-04 | Structured summary (decisions / actions / follow-ups) | 06-02 | `meeting_summary_item.kind IN ('topic','decision','follow_up','open_question')`; `extract.ts` produces 5-section schema per CONTEXT lines 76-86 | PASS (CONTEXT promised 5 sections; schema has 4 + actions in meeting_action — matches CONTEXT intent) |
| MEET-05 | Approved action items push to Todoist | 06-03 | `pushApprovedMeetingActions` (push-actions.ts), TODOIST_PUSH_APPROVED_ACTIONS IPC (todoist.ts:100), idempotency_key hashed from approvalId+actionId, meeting_action_task_link table, approval state→'sent' on success. **HOWEVER** no approval-state guard inside the push function — see Gap #2. | PARTIAL — works on happy path but chokepoint weaker than email/calendar |
| MEET-06 | No bot attendee, no cloud recording | 06-01 | `src/main/transcripts/no-bot-guard.ts` (MEETING_BOT_BLOCKLIST), `tests/static/no-meeting-bot-imports.test.ts` scans src/ for blocklisted tokens (recall.ai, symbl.ai, fireflies.ai/api, otter.ai/api, tldv.io/api, zoom.us/rec, meetingbot, recording-bot). Belt+suspenders item #1 (sole-write-path TranscriptSource type) — `ingestTranscriptNote` is sole entry but I did not verify the type-brand enforcement; the static blocklist is real and unit-testable. | PASS |
| TASK-01 | Connect Todoist via API token; pushed task within one sync cycle | 06-03 | TODOIST_CONNECT_TOKEN validates via `client.validateToken()` then writes provider_account row + Phase-5-style keyring (`aria:tokens:todoist:default`); push is immediate on approve (renderer chains `todoistPushApprovedActions` after `approvalsApprove`); integration spec proves end-to-end persist | PASS |
| TASK-02 | Tasks pulled from Todoist visible in dashboard alongside Aria actions | 06-03 | `/tasks` route registered (routes.tsx:19), SideNav entry (SideNav.tsx:17), `TasksScreen.tsx` renders todoist_task rows + meeting_action source link, TASKS_LIST IPC, sync-tasks.ts pulls into todoist_task table | PASS |

**Requirements verdict:** 7/8 PASS, 1 PARTIAL (MEET-05).

---

## Dimensions Verdict (12 from brief)

| # | Dimension | Verdict | Evidence |
|---|---|---|---|
| 1 | Requirements coverage | PASS | All 8 MEET-*/TASK-* IDs claimed by exactly one plan and have code evidence |
| 2 | Migration ordering 123/124/125 | PASS | embedded.ts:587-928 — registered in strict order, sequential numeric, 125 sets `PRAGMA user_version=125`. 124 widens approval.kind to include 'task_batch'. 125 widens provider_account.provider_key to include 'todoist' and provider_sync_state.resource to include 'tasks' |
| 3 | Transcripts surface substance | PASS | 9 substantive source files in src/main/transcripts/ (chunk, citations, dedupe-actions, extract, ingest, link-calendar, no-bot-guard, normalize, post-ingest); ingest.ts is 148 LOC, extract.ts 146 LOC; no TODO/FIXME markers |
| 4 | Todoist architectural plug-in | WARNING | `createTodoistProvider` (provider-adapter.ts:4) returns a `Provider` shape with `capabilities: { tasks: true }`, but **ProviderRegistry explicitly throws on providerKey='todoist'** (registry.ts:37-38, 70-71) with `'todoist-provider-is-task-only'`. So the Phase-5 abstraction reuse is partial — the type exists but is not wired into the registry. This appears intentional (Todoist is task-only, not mail/calendar) but should be documented |
| 5 | Push chokepoint | PARTIAL — Gap #2 | See requirements MEET-05; push-actions.ts has no assertApproved-equivalent on approval.state |
| 6 | Static-grep ratchets | PASS | `tests/static/no-meeting-bot-imports.test.ts` reads MEETING_BOT_BLOCKLIST from production source, walks src/ recursively, excludes the guard file itself, asserts zero hits. Substantive (28 LOC), real assertion |
| 7 | Approval kind extension | PASS | Migration 124 widens `approval.kind` to include `task_batch`; nullable `meeting_note_id` FK added; index `idx_approval_meeting_note`. ApprovalKind type widened (approvals/persist.ts:22). ApprovalCard.tsx has `task_batch` branch (TaskBatchApprovalCard). post-ingest.ts:40-47 creates task_batch rows. Polymorphic table handles the new kind cleanly. |
| 8 | UAT integrity | WARNING | UAT.md lists 9 manual checks all marked "Covered by automated tests" except live smoke item, and reports "21 files passed, 38 tests passed" + "Live Todoist smoke passed". I could not re-run the suite locally due to EBUSY on better-sqlite3 native binary (dev process likely holding the .node file). The live-smoke claim is honest (acknowledges cleanup needed). **BUT** UAT does NOT mark the tests/e2e/meeting-to-todoist.spec.ts as a stub — see Gap #1 |
| 9 | Reachability (Phase 4 blindspot) | PASS | `/meetings` → TranscriptCaptureScreen in routes.tsx:18; SideNav.tsx:16 (sidenav-meetings). `/tasks` → TasksScreen in routes.tsx:19; SideNav.tsx:17 (sidenav-tasks). Both reachable from primary nav |
| 10 | Phase 5 learnings honored | PASS (no contradicting evidence) | New Phase 6 UI files (NoteReviewScreen, TasksScreen, TranscriptCaptureScreen) render dynamic data via aria.* IPC; no obvious hardcoded empty arrays or stub renders. Did not exhaustively trace local-TZ display in TasksScreen |
| 11 | Tests substance | WARNING — Gap #1 | All unit tests in tests/unit/main/transcripts (7 files), tests/unit/main/integrations/todoist (3 files), 3 migration specs, 1 static guard, 1 substantive integration spec (100 LOC, real ingest+push round trip). **tests/e2e/meeting-to-todoist.spec.ts is a 13-line trivial assertion** — listed in UAT.md as a "Verification Run" file but provides no actual e2e coverage |
| 12 | Honest deferred items | PASS | CONTEXT.md `<deferred>` block at lines 132-141 honestly lists: live capture/bots, Chrome extension bridge, Asana/Jira, three-way merge, speaker embeddings, action-item learning loop, bulk import, audio upload. SUMMARY wave 1 honestly defers .docx/.pdf parsers. Wave 2 honestly notes "Full sensitivity/router orchestration remains a wave-3 hardening candidate" — and I could not find evidence wave 3 closed this; transcript extraction may still bypass the Phase 3 sensitivity classifier (HR/legal/financial categories were supposed to route entirely local per CONTEXT line 89). Not blocking but worth a future spike |

---

## Migration Verification

| Version | File | Tables/Changes | Status |
|---|---|---|---|
| 123 | 123_meeting_notes.sql | meeting_note, meeting_note_segment + 3 indices | PASS — exists in embedded.ts:587-620 |
| 124 | 124_meeting_extraction_approvals.sql | meeting_summary, meeting_summary_item, meeting_action; widens approval.kind to add 'task_batch'; adds approval.meeting_note_id FK; 5 indices | PASS — exists embedded.ts:622-756, full ALTER+rebuild done in transaction |
| 125 | 125_todoist_tasks.sql | Widens provider_account.provider_key to add 'todoist'; widens provider_sync_state.resource to add 'tasks'; recreates meeting_action (no functional change — pre-existing rows preserved); creates todoist_task, meeting_action_task_link; 3 indices; `PRAGMA user_version = 125` | PASS — exists embedded.ts:758-928. Properly recreates the singleton VIEWs after provider_account rebuild |

**Numbering:** 122 → 123 → 124 → 125, no skipped versions. Recreates dropped views correctly.

---

## Wiring (Key Links)

| From | To | Via | Status |
|---|---|---|---|
| `/meetings` route | TranscriptCaptureScreen | routes.tsx:18 | WIRED |
| `/tasks` route | TasksScreen | routes.tsx:19 | WIRED |
| Approvals UI | Todoist push | ApprovalsScreen.tsx:93-96 — branch on `kind === 'task_batch'` calls `todoistPushApprovedActions` after successful approve | WIRED |
| TODOIST_PUSH_APPROVED_ACTIONS | pushApprovedMeetingActions | todoist.ts:107 | WIRED but **no state guard** (Gap #2) |
| post-ingest | task_batch approval | post-ingest.ts:46-56 inserts approval via insertApproval(kind='task_batch') | WIRED |
| Briefing Open Actions | todoist_task | briefing/generate.ts:403 `gatherOpenActions(db)` + BriefingScreen.tsx:160 renders `payload.openActions` | WIRED |
| TODOIST_FORCE_SYNC | syncTodoistTasks | todoist.ts:82-98 — manual sync only; **not on cron**. CONTEXT promised 5-min pull cadence matching mail; only manual button-driven sync exists | WIRED (manual); CRON NOT IMPLEMENTED |
| TaskBatchApprovalCard | ApprovalCard | ApprovalCard.tsx branch on kind='task_batch' | WIRED |
| no-bot-guard blocklist | static test | tests/static/no-meeting-bot-imports.test.ts:4 imports MEETING_BOT_BLOCKLIST from production source | WIRED |

---

## Anti-Patterns & Debt Markers

Phase 6 source files (src/main/transcripts/, src/main/integrations/todoist/, renderer features): **zero matches** for TODO/FIXME/XXX/placeholder/coming soon. Clean.

---

## Findings — Discharged Adversarial Stance

**Phase 6 mostly hits its goal.** Migrations are clean and ordered. The MEET-06 invariant is enforced through both a runtime blocklist module and a static test that walks the source tree. Citations propagate through the integration spec and into Todoist task descriptions. The Tasks and Meetings screens are reachable through routes AND nav (lesson from Phase 4 honored).

**Two real gaps:**

1. **BLOCKER — fake e2e file.** `tests/e2e/meeting-to-todoist.spec.ts` is a 13-line stub that asserts a string literal exists in a hard-coded array. UAT.md and the wave-3 SUMMARY list it as part of the verification run. This is exactly the failure mode this verifier is designed to catch. Either:
   - Delete the file and remove it from UAT's "Verification Run" list; OR
   - Replace with a real Playwright `_electron` e2e (paste transcript → click approve → assert Todoist mock called).

2. **HIGH — push chokepoint weaker than email/calendar.** `pushApprovedMeetingActions` trusts approvalId without checking `approval.state`. The renderer chains approve→push, but a direct IPC call would bypass. Phase 3 invested heavily in the `assertApproved` single-chokepoint pattern; Phase 6 should mirror it. Add: `const ap = db.prepare('SELECT state FROM approval WHERE id=?').get(approvalId); if (!ap || ap.state !== 'approved') throw new Error('not-approved');` at the top of pushApprovedMeetingActions. Trivial to add.

**Two warnings (not blocking commit):**

3. Sensitivity-router orchestration on transcript chunks (CONTEXT line 89) is a documented wave-2 carry-forward that wave-3 didn't appear to close. HR/legal/financial transcript chunks may still hit frontier. Wave-2 SUMMARY explicitly punted this. Worth a follow-up spike post-commit.

4. CONTEXT promised 5-min Todoist pull cadence matching mail; only manual TODOIST_FORCE_SYNC IPC exists. Phase 6 wave-3 SUMMARY doesn't claim auto-pull was implemented, so this is arguably a quiet deferral rather than a false claim — but UAT item 5 says "Click Todoist `Sync now`" which is honest about the manual-only flow. Decide whether to land cron in this phase or defer explicitly.

---

## Recommendation

**fix-X-first → then commit.**

Required before commit:
- ~~Delete or replace `tests/e2e/meeting-to-todoist.spec.ts`. The stub file misrepresents coverage.~~ **FIXED** — file deleted. The integration spec at `tests/integration/meeting-to-todoist.spec.ts` (100 LOC, real ingest+push round trip) provides actual coverage; the e2e stub was misleading. Plan 06-03 references to the deleted path remain as historical record.
- ~~Add 2-line approval-state guard at the top of `pushApprovedMeetingActions`.~~ **FIXED** — `assertApproved(db, approvalId)` is now the first executable statement of `pushApprovedMeetingActions` (src/main/integrations/todoist/push-actions.ts:32). Brings MEET-05 to parity with the email_send / calendar_change chokepoints. The P-04-01 invariant from Phase 4 now generalizes to all three approve→write surfaces.

Acceptable to defer (document in 06-DISCUSSION-LOG.md or open Phase 6.5 ticket):
- Sensitivity-router pass on transcript chunks
- Automatic Todoist pull cron (currently manual-only via Force Sync)

## Post-fix status

**Verdict updated:** PASS_WITH_DEFERRED — ready to commit. Both blockers resolved in working tree before commit-1.
- Live re-auth chip UX (human verification needed)

After those two fixes land, this phase achieves its goal honestly and is ready to commit.

---

_Verified: 2026-05-19_
_Verifier: Claude (gsd-verifier, working-tree audit)_
