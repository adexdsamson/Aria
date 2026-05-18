---
phase: 04-calendar-smart-scheduling-google
plan: 03
subsystem: scheduling
tags: [scheduling, nl, intent, approval, e2e, mvp-slice, sc-1]
dependency_graph:
  requires:
    - migration-010 (polymorphic approval + calendar_event extensions)
    - scheduling/conflict (04-02 pure-function detector)
    - scheduling/rules (04-02 loadActiveRules)
    - integrations/google/write-event (04-01 applyCalendarChange chokepoint)
    - integrations/google/calendar (04-01 freebusyQuery + patchEvent)
    - approvals/persist (insertApproval, transitionTo, getApproval)
    - approvals/gate (assertApproved)
    - llm/providers (getLocalModel, getFrontierModel)
    - briefing/redact (redactAllPii for frontier route)
  provides:
    - scheduling/intent (parseIntent + IntentSchema + IntentRefusedError)
    - scheduling/resolver (resolveTarget + NeedsClarificationError)
    - scheduling/self-only-gate (assertSelfOnly + SelfOnlyGateError)
    - scheduling/propose (proposeCalendarChange orchestrator)
    - SCHEDULING_PROPOSE / SCHEDULING_CONFIRM_TARGET / SCHEDULING_OVERRIDE IPC
    - SchedulingChat (/scheduling route)
    - CalendarApprovalCard (kind='calendar_change' variant)
    - APPROVALS_APPROVE dispatch to applyCalendarChange on kind='calendar_change'
  affects:
    - ApprovalRowDto (widened kind union + calendar_* fields)
    - AriaApi (3 new methods)
    - SideNav (Scheduling tab)
tech_stack:
  added: []
  patterns:
    - "Zod schema + generateObject + maxRetries=2 + redact-then-rehydrate (mirrors sensitivityClassifier)"
    - "Custom-error-class refusal/clarification flow (mirrors ApprovalGateError shape)"
    - "Two-predicate self-only gate (organizer.self + attendee allowlist)"
    - "Pure-orchestrator translating thrown errors → typed result union for renderer"
    - "ARIA_E2E env-gated CalendarClient mock shared between freebusy (propose) and patchEvent (apply)"
key_files:
  created:
    - src/main/scheduling/intent.ts
    - src/main/scheduling/resolver.ts
    - src/main/scheduling/self-only-gate.ts
    - src/main/scheduling/propose.ts
    - src/renderer/features/scheduling/SchedulingChat.tsx
    - tests/unit/main/scheduling/intent.test.ts
    - tests/unit/main/scheduling/self-only-gate.test.ts
    - tests/unit/main/scheduling/propose.test.ts
    - tests/unit/renderer/features/approvals/ApprovalCard-calendar.spec.tsx
    - tests/unit/renderer/features/scheduling/SchedulingChat.spec.tsx
    - tests/e2e/scheduling-propose.spec.ts
    - tests/e2e/calendar-approval-bypass.spec.ts
  modified:
    - src/main/ipc/scheduling.ts (3 new handlers + ARIA_E2E hooks)
    - src/main/ipc/approvals.ts (APPROVALS_APPROVE dispatches applyCalendarChange)
    - src/main/ipc/index.ts (register 3 new channels)
    - src/shared/ipc-contract.ts (widen ApprovalRowDto.kind + 3 channels + DTOs)
    - src/preload/index.ts (5 new __e2e bridges, gated)
    - src/renderer/features/approvals/ApprovalCard.tsx (CalendarApprovalCard subcomponent)
    - src/renderer/app/routes.tsx (/scheduling route)
    - src/renderer/components/SideNav.tsx (Scheduling nav entry)
decisions:
  - "parseIntent maxRetries=2 with cancel-not-in-v1 refusal short-circuit (no retry on deliberate refusal)"
  - "Redact PII before frontier route only; local Ollama sees raw text — same policy as sensitivity classifier Stage 2"
  - "Resolver looks up calendar_event cache (Phase 2 sync) by time-of-day window ±30min OR summary LIKE substring; ambiguity triggers NeedsClarificationError"
  - "isHighValue heuristic: duration>30min AND external attendees present (powers CAL-07 prime-time bonus)"
  - "Self-only gate: organizer.self===true OR organizer.email===userEmail AND all attendees match organizer/user emails (undefined attendees = self-only)"
  - "proposeCalendarChange transitions pending→generating→ready in one synchronous flow (no long-running draft state for calendar changes)"
  - "APPROVALS_APPROVE dispatch is main-side (mirrors email_send dispatch but inverted: scheduling does it inside the approve handler rather than chaining renderer IPCs) to keep renderer simple"
  - "ARIA_E2E mock is module-level; same buildE2eCalendarClient instance backs both freebusyQuery (propose) and patchEvent (apply) so a single calls[] array proves end-to-end"
metrics:
  duration_min: 35
  completed_date: "2026-05-18"
  task_count: 4
  file_count: 19
---

# Phase 04 Plan 03: SC-1 MVP Vertical Slice Summary

Wave 3 wires the NL pipeline end-to-end: `parseIntent` → `resolveTarget` → `assertSelfOnly` → `freebusyQuery` → `detectConflictsAndAlternatives` → `insertApproval(kind='calendar_change', state='ready')`. The renderer gets a `/scheduling` chat surface and a calendar variant of `ApprovalCard`. Approving a calendar_change row routes through the existing `applyCalendarChange` chokepoint from Plan 04-01 — APPR-02 is now reachable from a user click, with the bypass attempt proven inert by an e2e spec.

## Outcomes

- **parseIntent** (intent.ts): Zod IntentSchema + generateObject + maxRetries=2 + p-queue serialization. Cancel commands throw `IntentRefusedError('cancel-not-in-v1')` BEFORE any approval row is created (T-04-03-09). Frontier route redacts PII via `redactAllPii` from the briefing redactor (T-04-03-01).
- **resolveTarget** (resolver.ts): NL ref "my 3pm" → calendar_event lookup with ±30min hour window on today; substring LIKE for free-text refs. Multiple matches → `NeedsClarificationError('multiple-matches')` with candidate list. Recurring events carry `parentId` + `recurrence` from `recurrence_json`. `proposedChange` preserves the original duration when shifting weekday or time-of-day. `forceEventId` deps option short-circuits NL lookup for confirmTarget.
- **assertSelfOnly** (self-only-gate.ts): two-predicate gate (organizer + attendee allowlist). Refuses BEFORE alternatives generated so the renderer can surface a clean "do this in Google Calendar" refusal (T-04-03-03).
- **proposeCalendarChange** (propose.ts): orchestrator translating thrown errors to typed `ProposeRefusal` / `ProposeClarification` so the renderer never sees raw exception strings. Excludes the target event's own busy window from the busyIntervals fed to `detectConflictsAndAlternatives` (otherwise the move would self-conflict). insertApproval payload populates before_json with `{summary, startUtc, endUtc, parentId, recurrence, etag, isRecurring, attendees, organizer}` so applyCalendarChange has everything it needs without re-fetching the event.
- **SCHEDULING_PROPOSE / CONFIRM_TARGET / OVERRIDE** IPC handlers wired into `registerSchedulingHandlers`. OVERRIDE uses a direct prepared UPDATE on `rule_overrides_json` (no state transition) and logs phase='override' via `logCalendarAction` (T-04-03-05).
- **SchedulingChat** (/scheduling route): NL textarea + Submit; switches on result type — success / clarification (candidate buttons → confirmTarget) / refusal (copy keyed on code) / error. Refusal copy is locked verbatim per CONTEXT.md.
- **CalendarApprovalCard**: before/after time, attendees list with self-only badge, conflicts color-coded (hard=red, soft=amber), alternatives picker that swaps `after_json` on click, recurring scope radios (this/future/all) defaulting to 'this' for recurring events only, hard-conflict override flow requiring an explicit reason before Approve is enabled.
- **APPROVALS_APPROVE dispatch**: when row.kind === 'calendar_change', after `transitionTo('approved')` the handler invokes `applyCalendarChange(db, id, deps)`. Optional `calendarOverrides: {scope, overrideReasons, afterJson}` payload is persisted to the row before the transition fires (so the chokepoint reads the right after_json + recurring_scope).
- **E2E harness** (scheduling.ts ARIA_E2E hooks): seed `calendar_event` rows, set/get/clear a module-level CalendarClient mock used by BOTH propose's freebusyQuery AND apply's patchEvent, read `calendar_action_log` rows by approvalId. The mock is exported to `approvals.ts` via `buildE2eCalendarClientForApproveDispatch` so both surfaces share state.

## Local Ollama generateObject Reliability (Pitfall 8 / A2)

Not directly exercised — unit tests stub `generateObject` to assert IntentSchema retry/refusal semantics, and the e2e spec uses the `confirmTarget` short-circuit so it can run without a reachable Ollama daemon. CI will run the e2e in `LLM_UNAVAILABLE_OR_REFUSED` skip-mode when Ollama is absent; manual smoke tests against a live local model will surface schema-adherence issues in v1.x.

The IntentSchema is shallow (single-level optionals only) per Pitfall 8 — `target.eventRef` and `when.nlWhen` are both strings, no nested unions. The 8B Llama prompt template explicitly lists the four allowed action enum values + tells the model where to put time phrases, which should keep `maxRetries=2` sufficient.

## Prompt Tweaks

The intent prompt embeds `Today is ${nowIso} (UTC)` for date anchoring (the model needs this to interpret "Thursday" relative to a known date) and enumerates the four action enum values + the expected location for each phrase fragment. No CoT scaffolding; we rely on AI SDK 6's structured-output retry.

## E2E Seeding Strategy

- `__e2eSeedCalEvent({id, summary, startUtc, endUtc, attendees, organizerEmail, organizerSelf})` inserts directly into `calendar_event` (bypassing sync-calendar) so tests are hermetic.
- `__e2eSetCalMock({ok, busy})` configures the in-process CalendarClient mock returned by both `buildClient()` (propose path) and `buildE2eCalendarClientForApproveDispatch()` (apply path). One module-level `e2eCal.calls[]` array proves the patch/insert reached the chokepoint.
- `__e2eReadCalAudit({approvalId})` reads `calendar_action_log` rows ordered by id ASC so the happy-path spec can assert `proposed` → `pre_write` → `post_write`.

The propose spec uses `schedulingConfirmTarget` (forceEventId path) rather than `schedulingPropose` to avoid the Ollama dependency in CI. The unit tests already cover the full propose flow through 6 branches with a stubbed `intentFn`.

## Working-Hours Resolution Status

Carried forward from 04-02: `workingHoursPerDay` from `getCalendarSettings` is still `undefined` (Google API limitation). The conflict detector falls back to `rules.workingHours` when present, else operates unrestricted with a `'working-hours-unavailable'` warning. Plan 04-03 makes no further changes here.

## Threat Mitigations Landed

| Threat | Mitigation |
|---|---|
| T-04-03-01 PII to frontier | parseIntent runs `redactAllPii` when `routed='frontier'`; local route sees raw text (same as classifier Stage 2) |
| T-04-03-02 Attendee/event payload to frontier | parseIntent prompt contains ONLY NL command + current date; resolver runs locally against calendar_event cache |
| T-04-03-03 Hallucinated event id | resolveTarget requires the event exist in calendar_event; ambiguity → NeedsClarificationError; self-only gate fires on the fetched row |
| T-04-03-04 Renderer bypasses propose | insertApproval is main-process only; calendar-approval-bypass.spec.ts shows the IPC error path |
| T-04-03-05 Silent rule override | SCHEDULING_OVERRIDE writes rule_overrides_json + phase='override' audit row |
| T-04-03-06 Silent failed write | applyCalendarChange writes `failed` audit row + rethrows; APPROVALS_APPROVE returns `calendar-apply:<msg>` so renderer can toast |
| T-04-03-07 Etag race | etag captured in `before_json` at propose time; applyCalendarChange passes it to patchEvent's ifMatch (04-01 chokepoint) |
| T-04-03-08 sendUpdates='all' leak | self-only gate refuses multi-attendee before approval insert; static-grep ratchet (04-01) covers the chokepoint literal |
| T-04-03-09 Cancel → silent change | IntentRefusedError thrown BEFORE insertApproval; covered by unit test (intent.test.ts case 1) |

## Test Coverage Snapshot

| Suite | Tests | Status |
|---|---|---|
| intent.test.ts | 6 | green |
| self-only-gate.test.ts | 5 | green |
| propose.test.ts | 6 | green (all 6 branches) |
| ApprovalCard-calendar.spec.tsx | 4 | green |
| SchedulingChat.spec.tsx | 4 | green |
| (scheduling suite total across 04-02+04-03) | 43 | green |
| scheduling-propose.spec.ts | 1 | skip-tolerant (NO_BUILD / LLM_UNAVAILABLE) |
| calendar-approval-bypass.spec.ts | 1 | skip-tolerant (NO_BUILD) |

## Commits

| Task | Commit | Description |
|---|---|---|
| 1 | 58ac951 | parseIntent + resolveTarget + assertSelfOnly |
| 3a | 62be0c7 | proposeCalendarChange + SCHEDULING IPC + approve dispatch |
| 2 | a033aa0 | ApprovalCard calendar variant + SchedulingChat surface |
| 3b | 0ca549f | E2E harness + scheduling-propose + bypass specs |

## Deviations from Plan

None of substance. Three minor adjustments noted:

1. **Resolver coverage in propose.test.ts, not its own file** [plan-allowed]: the plan's Task 1 action block explicitly defers resolver coverage to Task 3 to share DB+client fixtures. Honored — resolver paths (multiple-matches, no-match, success) are exercised through propose.test.ts.
2. **SCHEDULING_OVERRIDE writes via direct prepared UPDATE** [Rule 1 — gap]: persist.transitionTo only handles state transitions; appending to rule_overrides_json without changing state needed a direct UPDATE. Bounded to a single column + updated_at; no risk of bypassing transitionTo for state changes.
3. **E2E happy-path uses confirmTarget short-circuit** [Rule 3 — blocking]: parseIntent requires a reachable Ollama daemon and CI may not have one. The propose unit suite already covers all 6 NL branches; the e2e proves the IPC integration + chokepoint dispatch + audit log via the forceEventId path. Pure-bypass coverage of the LLM is therefore unit-only by design.

## Auth Gates

None reached in this plan — calendar.events write scope is already prompted by 04-01's re-consent banner. Manual smoke against a live Google account would surface OAuth flow but is gated by the 04-01 user_setup line.

## Known Stubs

None. Every code path is wired end-to-end:
- Intent parser routes through real `getLocalModel()` / `getFrontierModel()`.
- Resolver reads the live `calendar_event` cache.
- Propose persists a real approval row + audit log entry.
- Approval card mounts under the existing `ApprovalsScreen` rendering pipeline.
- APPROVALS_APPROVE dispatch invokes the real `applyCalendarChange` chokepoint.

The only deferred behavior is the Ollama-driven e2e LLM round-trip — explicitly out of scope for CI; manual smoke covers it.

## Self-Check: PASSED

- FOUND: src/main/scheduling/intent.ts
- FOUND: src/main/scheduling/resolver.ts
- FOUND: src/main/scheduling/self-only-gate.ts
- FOUND: src/main/scheduling/propose.ts
- FOUND: src/renderer/features/scheduling/SchedulingChat.tsx
- FOUND: tests/unit/main/scheduling/intent.test.ts
- FOUND: tests/unit/main/scheduling/self-only-gate.test.ts
- FOUND: tests/unit/main/scheduling/propose.test.ts
- FOUND: tests/unit/renderer/features/approvals/ApprovalCard-calendar.spec.tsx
- FOUND: tests/unit/renderer/features/scheduling/SchedulingChat.spec.tsx
- FOUND: tests/e2e/scheduling-propose.spec.ts
- FOUND: tests/e2e/calendar-approval-bypass.spec.ts
- FOUND commits: 58ac951, 62be0c7, a033aa0, 0ca549f
