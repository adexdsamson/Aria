---
phase: 17-voice-confirm-writes-through-the-gate
plan: "03"
subsystem: voice
tags: [voice, intent-router, read-back, tdd, d-01, d-02, d-03, d-05, d-08]

# Dependency graph
requires:
  - phase: 17-01
    provides: 'cancelled' state + IPC channels foundation
  - phase: 17-02
    provides: performAsk() extracted service (VoiceIntentRouter calls it for ask domain)
  - src/main/approvals/persist.ts
    provides: insertApproval / getApproval / ApprovalRow (router stages rows here)
  - src/main/scheduling/propose.ts
    provides: proposeCalendarChange (schedule domain handler)
  - src/main/scheduling/intent.ts
    provides: parseIntent (pre-parsed intent passed to proposeCalendarChange)
  - src/main/drafting/email.ts
    provides: draftReply (draft domain handler)
  - src/main/rag/person-resolver.ts
    provides: resolvePersonMentions (D-08 pre-staging disambiguation)
  - src/main/scheduling/rules.ts
    provides: loadActiveRules → timeZone for read-back formatting
provides:
  - src/main/voice/voice-intent-router.ts: VoiceIntentRouter + VoiceIntentRouterDeps + RouteResult
  - src/main/voice/read-back-template.ts: buildReadBackText() pure template builder
  - tests/unit/main/voice/voice-intent-router.spec.ts
  - tests/unit/main/voice/read-back-template.spec.ts
affects:
  - 17-04: cloud STT / sensitivity gate can use router as intent stage
  - 17-05: VOICE_CONFIRM_APPROVAL handler calls voiceConfirm after router stages a 'ready' row
  - 17-07: ratchet update — router correctly does NOT import any write chokepoints

# Tech tracking
tech-stack:
  added: []
  patterns:
    - TDD: test(17-03) RED x2 → feat(17-03) GREEN x2 (4 commits)
    - hasWord() word-boundary helper prevents 'ask' substring match inside 'task'
    - ask-domain-first ordering in keyword classifier (question words before action words)
    - requireFn() pattern for mandatory injectable deps
    - pure buildReadBackText() reads ONLY from ApprovalRow fields (never raw transcript)
    - JSON.parse wrapped in try/catch for all row field reads

key-files:
  created:
    - src/main/voice/voice-intent-router.ts
    - src/main/voice/read-back-template.ts
    - tests/unit/main/voice/voice-intent-router.spec.ts
    - tests/unit/main/voice/read-back-template.spec.ts
  modified: []

key-decisions:
  - "Ask domain checked BEFORE schedule in keyword classifier — 'what is on my calendar' must not route to schedule domain"
  - "hasWord() regex helper prevents 'ask' substring match inside 'task' (discovered as Rule 1 fix during GREEN)"
  - "Router uses requireFn() to throw early when a dep is missing vs. silently returning unknown"
  - "proposeCalendarChange receives pre-parsed intent via intentFn: to avoid double-parsing in voice path"
  - "handleDraft uses stub GmailMessageRow for voice-triggered drafts; production flow provides real thread context"

requirements-completed:
  - VOICE-09
  - VOICE-11

# Metrics
duration: 56min
completed: 2026-06-08
---

# Phase 17 Plan 03: VoiceIntentRouter + Read-Back Template Summary

**Voice intent router (D-01) keyword pre-filter → per-domain dispatch → insertApproval(ready) + buildReadBackText() pure template from resolved ApprovalRow fields — router ends at staging (never calls voiceConfirm/assertApproved/write chokepoints)**

## Performance

- **Duration:** 56 min
- **Started:** ~2026-06-08T13:30:00+01:00
- **Completed:** ~2026-06-08T14:26:00+01:00
- **Tasks:** 2 (TDD: 4 commits — test RED + feat GREEN x2)
- **Files created:** 4

## Accomplishments

### Task 1: buildReadBackText() pure template builder

Created `src/main/voice/read-back-template.ts`:
- Pure function (no async, no DB access, no IPC) per D-05
- Reads ONLY from `ApprovalRow` fields (never raw transcript) — structural Pitfall 5 / T-17-06 avoidance
- `email_send`: parses `recipients_json` + `subject`; falls back to `(no recipients)` / `(no subject)`
- `calendar_change`: `Intl.DateTimeFormat` with caller-supplied timezone; falls back to `(unknown time)` on null/missing `startIso`
- `task_batch`: mentions Todoist
- `default`: generic "Action ready. Say yes to confirm, or say cancel."
- All JSON.parse calls wrapped in try/catch — malformed JSON never throws

Created `tests/unit/main/voice/read-back-template.spec.ts` — 15 tests covering all 4 kind branches, null-field edge cases, JSON parse resilience.

### Task 2: VoiceIntentRouter class

Created `src/main/voice/voice-intent-router.ts`:
- Exports `VoiceIntentRouter`, `VoiceIntentRouterDeps`, `RouteResult` union
- Two-stage parsing (D-01): keyword pre-filter → domain → per-domain service dispatch
- **Ask domain** first in classifier to prevent question-word transcripts from mis-routing to schedule
- `hasWord()` regex helper for word-boundary matching (prevents 'ask' inside 'task')
- Domains: `ask` / `schedule` / `draft` / `task` / `unknown`
- **Ask**: calls `performAskFn` in-process (D-02 / SC1 / VOICE-09) — no preload bridge re-crossing
- **Schedule**: `parseIntentFn` + `proposeCalendarChangeFn`; pre-parsed intent threaded via `intentFn:` to avoid double-parsing
- **Draft**: `resolvePersonMentionsFn` runs PRE-STAGING (D-08); `ambiguous` → returns `{ kind: 'ambiguous', options }` without calling `draftReplyFn`
- **Task**: `insertApprovalFn(kind='task_batch', state='ready')` directly
- All staged domains: `getApprovalFn` → `buildReadBackText` → `{ kind: 'staged', approvalId, readBackText }`
- DOES NOT import `voiceConfirm`, `assertApproved`, `sendApprovedEmail`, `applyCalendarChange`, `pushApprovedMeetingActions` (D-03 / ratchet-critical)
- `approval_path` left at default `'explicit'`; `voiceConfirm` stamps `'voice-explicit'` on confirm (Pitfall 8)

Created `tests/unit/main/voice/voice-intent-router.spec.ts` — 19 tests covering all keyword domains, RouteResult union shapes, ask answer pass-through, ambiguous person pre-staging gate (D-08).

## Task Commits

Each task was committed atomically (TDD pattern):

1. **Task 1 RED: Failing tests for buildReadBackText()** — `ec64c03` (test)
2. **Task 1 GREEN: implement buildReadBackText()** — `0ebd32b` (feat)
3. **Task 2 RED: Failing tests for VoiceIntentRouter** — `d71173e` (test)
4. **Task 2 GREEN: implement VoiceIntentRouter** — `a4d34de` (feat)

## Files Created

- `src/main/voice/read-back-template.ts` — pure buildReadBackText() per D-05
- `src/main/voice/voice-intent-router.ts` — VoiceIntentRouter class + RouteResult union
- `tests/unit/main/voice/read-back-template.spec.ts` — 15 tests (all pass)
- `tests/unit/main/voice/voice-intent-router.spec.ts` — 19 tests (all pass)

## Decisions Made

- Ask domain checked BEFORE schedule in the keyword classifier — "what is on my calendar today" must route to ask, not schedule; calendar is a keyword for schedule ACTION but "what" is an interrogative that takes priority
- `hasWord()` regex prevents substring false-positives — "task" contains "ask", so a simple `t.includes('ask')` would mis-classify task transcripts as ask domain
- `requireFn()` pattern: mandatory deps throw early with a clear message rather than silently returning `{ kind: 'unknown' }` — easier to diagnose DI wiring issues in production
- `proposeCalendarChange` receives pre-parsed intent via `intentFn:` option to avoid double-parsing the transcript
- `handleDraft` uses a stub `GmailMessageRow` built from the transcript for voice-triggered drafts; this is correct for voice where there's no existing email thread — production voice drafts use the voice channel context

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] keyword classifier: 'ask' substring match inside 'task'**
- **Found during:** Task 2 GREEN (tests failed: "add a task to remind me" → { kind: 'ask' })
- **Issue:** `t.includes('ask')` matches inside "task" — substring is a false positive
- **Fix:** Added `hasWord(t, 'ask')` using a word-boundary regex `(?:^|\W)ask(?:\W|$)`
- **Files modified:** `src/main/voice/voice-intent-router.ts`
- **Commit:** `a4d34de`

**2. [Rule 1 - Bug] keyword classifier: ask domain must be checked before schedule**
- **Found during:** Task 2 GREEN (tests failed: "what is on my calendar today" → schedule domain)
- **Issue:** `t.includes('calendar')` in the schedule check fires before the ask domain check for interrogative transcripts containing calendar-related nouns
- **Fix:** Moved ask domain check to be first in the classifier
- **Files modified:** `src/main/voice/voice-intent-router.ts`
- **Commit:** `a4d34de`

## Verification Results

| Check | Result |
|-------|--------|
| `read-back-template.spec.ts` | 15/15 PASS |
| `voice-intent-router.spec.ts` | 19/19 PASS |
| Ratchet: no write chokepoints in router | PASS (grep: 0 matches, comments only) |
| `pnpm typecheck` | 84 errors (baseline flat, 0 new) |
| `buildReadBackText` exported | confirmed |
| `VoiceIntentRouter`, `VoiceIntentRouterDeps`, `RouteResult` exported | confirmed |
| Router does NOT call voiceConfirm / assertApproved | confirmed |

## Known Stubs

None — the router is a pure dispatch layer. The `handleDraft` stub `GmailMessageRow` built from the transcript is an intentional limitation for voice-triggered drafts (no email thread context available). Plan 17-05 wires the full confirm flow; the draft thread-context problem is deferred to Phase 18 when voice is integrated with email browsing context.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. The router is in-process main-process only; all external writes are gated behind `insertApproval(state='ready')` → voiceConfirm (Plan 17-05) → assertApproved.

## Self-Check: PASSED

- `src/main/voice/read-back-template.ts` exists: FOUND
- `src/main/voice/voice-intent-router.ts` exists: FOUND
- `tests/unit/main/voice/read-back-template.spec.ts` exists: FOUND
- `tests/unit/main/voice/voice-intent-router.spec.ts` exists: FOUND
- Commits `ec64c03`, `0ebd32b`, `d71173e`, `a4d34de`: FOUND in git log

---
*Phase: 17-voice-confirm-writes-through-the-gate*
*Completed: 2026-06-08*
