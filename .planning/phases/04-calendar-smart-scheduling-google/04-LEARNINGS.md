---
phase: 04-calendar-smart-scheduling-google
extracted_at: 2026-05-18T13:28:21Z
sources:
  - 04-01-PLAN.md
  - 04-02-PLAN.md
  - 04-03-PLAN.md
  - 04-01-SUMMARY.md
  - 04-02-SUMMARY.md
  - 04-03-SUMMARY.md
  - VERIFICATION.md
  - 04-UAT.md
missing_artifacts: []
counts:
  decisions: 9
  lessons: 11
  patterns: 6
  surprises: 5
---

# Phase 4 Learnings — Calendar Smart-Scheduling (Google)

## 1. Decisions

### D-04-01 — APPR-02 single chokepoint via `applyCalendarChange`
- **What:** All writes to Google Calendar funnel through `src/main/integrations/google/write-event.ts:applyCalendarChange`. First executable line is `assertApproved(db, approvalId)`. Enforced by a static-grep ratchet at `tests/static/single-calendar-write-site.test.ts` (4 assertions including literal absence of `sendUpdates: 'all'` and positive `assertApproved` presence).
- **Why:** Defense in depth — multiple callers cannot independently bypass approval state; a future refactor that introduces a new write path triggers a test failure.
- **Source:** 04-01-PLAN.md, 04-01-SUMMARY.md, write-event.ts:93

### D-04-02 — Polymorphic approval table, `kind='calendar_change'`
- **What:** Migration 010 extended the existing approval-row schema to support a new kind without spawning a parallel table. Calendar-specific columns (`recurring_scope`, `rule_overrides_json`, `before_json`, `after_json`, `calendar_event_id`) joined the same row.
- **Why:** Reuses Phase 3 approval queue UI, state machine, and `assertApproved` chokepoint — calendar changes inherit the proven approval flow instead of reinventing it.
- **Source:** 04-01-PLAN.md, migrations/010_calendar_writeback.sql

### D-04-03 — `rrule.js` as the sole new dependency
- **What:** Phase 4 added only `rrule` for RFC5545 recurrence handling. No other new deps.
- **Why:** Stays inside the locked tech-stack envelope; recurrence math is sufficiently specialized to justify a dependency over hand-rolled parsing.
- **Source:** 04-01-PLAN.md, package.json

### D-04-04 — Typed-JSON scheduling rules (not free-form)
- **What:** Rules schema is a Zod-validated typed object with focus blocks, buffers, no-meeting windows, prime-time windows, working hours, and IANA TZ. Persisted JSON in `scheduling_rules` table; Settings UI generates editors per field.
- **Why:** Type safety from edge to renderer + machine-checkable rules drive the conflict detector. Alternative (free-form text rules + LLM interpretation) would have made conflict detection non-deterministic.
- **Source:** 04-02-PLAN.md, shared/scheduling-rules.ts

### D-04-05 — Pure-function conflict detector + alternatives ranker
- **What:** `detectConflictsAndAlternatives` is a side-effect-free function that takes `{target, rules, busyIntervals}` and returns conflicts + ranked alternatives. Caller pre-fetches busy intervals via `CalendarClient.freebusyQuery`.
- **Why:** Unit-testable in isolation; deterministic given inputs; conflict semantics decoupled from Google API quirks.
- **Source:** 04-02-PLAN.md, conflict.ts

### D-04-06 — Prime-time bonus only for `isHighValue` events
- **What:** CAL-07 prime-time scoring is gated on `target.isHighValue` (duration > 30min AND (external attendees exist OR has 'aria-high-value' label)).
- **Why:** Avoids over-prioritizing low-stakes events; matches the product intent that prime-time is for important slots.
- **Source:** 04-02-PLAN.md, resolver.ts isHighValue heuristic

### D-04-07 — Recurring scope default = "this instance"
- **What:** Approval card surfaces this-instance / this-and-future / all radio; default is "this instance".
- **Why:** Safest default — single-instance changes don't affect a series the user might not realize is recurring.
- **Source:** 04-CONTEXT.md, ApprovalCard CalendarVariant

### D-04-08 — Self-only v1 constraint (multi-attendee refused)
- **What:** `assertSelfOnly` refuses any event with attendees other than the organizer. Two-predicate check: organizer match AND attendees ⊆ {organizer}.
- **Why:** Multi-attendee changes need response handling, RSVP propagation, and `sendUpdates` semantics that v1 punts to Google Calendar's own UI. The refusal is paired with a clear message + Google Calendar deep link guidance.
- **Source:** 04-03-PLAN.md, self-only-gate.ts

### D-04-09 — E2E specs use `confirmTarget` short-circuit to avoid Ollama dep
- **What:** Phase 4 e2e Playwright specs skip the NL parse step and POST a pre-resolved `forceEventId` via the `confirmTarget` IPC.
- **Why:** CI runs without Ollama; making the e2e harness model-independent allows the pipeline to be exercised in any environment. Unit-level coverage of parseIntent's 6 branches is sufficient with stubbed `intentFn`.
- **Source:** 04-03-PLAN.md, tests/e2e/scheduling-propose.spec.ts

---

## 2. Lessons

### L-04-01 — Migration columns ≠ wired columns
- **What:** Migration 010 added 6 columns to `calendar_event` (`etag`, `i_cal_uid`, `sequence`, `organizer_email`, `organizer_self`, `recurrence_json`). Resolver and self-only gate read them. Phase 2 sync (`sync-calendar.ts`) never wrote them — `EventRow`, `toEventRow`, and the INSERT statement all predated Migration 010. Every cached row had `organizer_email = NULL` → every self-only check refused.
- **Context:** Caught only at UAT Test 6. Verifier accepted the chokepoint because unit tests injected full event rows; sync→resolver wire was never integration-tested.
- **Source:** 04-UAT.md Test 4 gap, commit 88d2c18

### L-04-02 — Unit tests with stubbed providers hide config drift
- **What:** `DEFAULT_OLLAMA_BASE_URL` was set to `http://127.0.0.1:11434` — missing the `/api` suffix that `ollama-ai-provider-v2`'s `createOllama({ baseURL })` requires. Every real `generateObject` call had been 404'ing since Phase 1. Latent for three full phases because every test stubs `generateObjectFn`.
- **Context:** Phase 3 sensitivity classifier likely also dark since Phase 3 ship — worth a follow-up audit.
- **Source:** 04-UAT.md, commit e6fdd5b

### L-04-03 — Hardcoded copy maps hide diagnostic-rich error messages
- **What:** `SchedulingChat.tsx`'s `REFUSAL_COPY` constant overrode the propose handler's `result.message` (which contained the real failure reason from parseIntent/resolveTarget/gate). User saw "Sorry, I couldn't understand…" instead of "intent parse failed after 2 attempts: Not Found" or "I couldn't find an event matching ''".
- **Context:** Three rounds of UAT failure diagnosis hinged on switching this. The renderer pattern should be: show backend `result.message` when present, fall back to constant only when message is empty.
- **Source:** commit 8e3a1d8

### L-04-04 — Components with passing unit tests can still be unreachable
- **What:** `SchedulingRulesSection.tsx` shipped with 3 green unit tests but was never imported by `SettingsScreen.tsx`. No nav entry, no Route. CAL-05 was effectively unimplemented from a user perspective despite the verifier marking it PASS.
- **Context:** Verifier checked code existence + tests, not reachability from app root.
- **Source:** 04-UAT.md Test 3, commit 0cfe470

### L-04-05 — `transitionTo` before chokepoint breaks rollback on API failure
- **What:** Approve handler marks row 'approved' BEFORE calling `applyCalendarChange`. On Google API throw, row stays 'approved' but no write reached Google. Card disappears, user thinks it worked.
- **Context:** First Test 6 attempt — `InvalidInstanceIdError` thrown by mis-fired Pitfall-3 guard. Same pattern likely exists for email_send.
- **Source:** 04-UAT.md Test 6, approvals.ts:187-218

### L-04-06 — Pitfall guards must be scoped to their actual concern
- **What:** Pitfall-3 ("scope=this requires instance id with `_`") was applied unconditionally. Non-recurring events have scope='this' by default and event IDs without underscores → guard fired for the wrong case → silent write failure.
- **Context:** Fix: gate the check on `isRecurring = Boolean(before.parentId) || (before.recurrence?.length > 0)`.
- **Source:** commit a42f25a

### L-04-07 — Small local models need explicit few-shot examples for strict-schema JSON
- **What:** qwen2.5:3b with a one-example prompt ("my 3pm") consistently returned move-intents with `target: undefined` — putting the entire phrase including the event title into `when.nlWhen`. Adding 4 explicit title/time-split examples produced reliable parses.
- **Context:** Bigger models (llama3.1:8b+) handle ambiguous prompts; 3B-class models need every disambiguation written out.
- **Source:** 04-UAT.md Test 4, commit 7488dda

### L-04-08 — IPC `getUserEmail` was never wired; `'user@local'` fallback masked itself
- **What:** `registerSchedulingHandlers` was called without a `getUserEmail` provider. The self-only gate compared real organizer emails against `'user@local'` and only passed when `organizer.self === true`. Sync drift (L-04-01) hid this because the column was NULL.
- **Context:** Wired a query to `calendar_account.email` singleton.
- **Source:** commit a07f811

### L-04-09 — Time-of-day fidelity isn't enforced in propose
- **What:** "Friday 2pm" → event landed Friday 4pm (preserved source event's time-of-day). The resolver/propose pipeline appears to honor day deltas more reliably than time deltas. Affects every test where the user asked for a specific time but only got day movement.
- **Context:** Not blocking SC-1 (proposal was produced and approved live to Google), but degrades trust. Tracing whether parseIntent's `when.nlWhen` is being parsed by a TZ-aware date library or dropped.
- **Source:** 04-UAT.md Tests 6/7/8 followups

### L-04-10 — UTC vs local TZ rendering in approval cards
- **What:** Card displays Google API's UTC times, not the user's IANA TZ from settings. User in Africa/Lagos saw "3:00 PM" for a 4 PM Lagos event.
- **Context:** Simple `Intl.DateTimeFormat` formatting issue at the renderer; should consume `rules.timeZone` for display.
- **Source:** 04-UAT.md polish observations

### L-04-11 — Ollama model VRAM/RAM headroom matters
- **What:** llama3.1:8b failed to load on the dev machine: "model requires more system memory (5.3 GiB) than is available (3.6 GiB)". Falling back to qwen2.5:3b unblocked SC-1.
- **Context:** Tech-stack plan specified llama3.1:8b OR qwen2.5:7b as defaults; reality is users with mid-tier RAM need a 3B-class option. Worth adding to the install doc.
- **Source:** 04-UAT.md Test 4, env change

---

## 3. Patterns

### P-04-01 — Static-grep ratchet for single-call-site invariants
- **Pattern:** A test that greps the codebase for forbidden call patterns and the required first-line presence of an enforcement function (`assertApproved`). Runs in CI; a refactor introducing a parallel write site causes immediate failure.
- **Where:** `tests/static/single-calendar-write-site.test.ts`
- **Reusable for:** Any "one chokepoint" architectural decision — payment, send, delete. Cheap, fast, no runtime cost.
- **Source:** 04-01-PLAN.md, 04-01-SUMMARY.md

### P-04-02 — `ARIA_DEBUG=1` env-var-gated diagnostic field on IPC responses
- **Pattern:** Add an optional `debug` field to IPC response DTOs, populated only when `process.env.ARIA_DEBUG === '1'`. Surfaces internal state (parsed Intent, candidate event list, gate comparison values) to DevTools without leaking to production builds.
- **Where:** `ProposeRefusal.debug` in propose.ts
- **Reusable for:** Any complex pipeline where the user-visible error is a refined version of internal state — sensitivity routing, RAG retrieval, brief generation.
- **Source:** commits 7fc3c1b, a07f811

### P-04-03 — `confirmTarget` short-circuit for E2E without LLM
- **Pattern:** Expose a dev/test IPC that bypasses the LLM call and accepts a pre-resolved object (eventId, intent). Lets Playwright drive the post-LLM path deterministically.
- **Where:** `SCHEDULING_CONFIRM_TARGET` handler
- **Reusable for:** Any phase that has an LLM step blocking E2E reproducibility — Phase 3 sensitivity, Phase 6 meeting capture, Phase 7 RAG.
- **Source:** 04-03-PLAN.md, tests/e2e

### P-04-04 — Polymorphic approval row with `kind` discriminator
- **Pattern:** Single `approval` table with a `kind` column and kind-specific JSON-or-extra columns. Renderer dispatches on kind to the right variant card. Approve handler dispatches on kind to the right chokepoint.
- **Where:** approvals table + `ApprovalCard` switch
- **Reusable for:** Future approval kinds (slack send, doc edit, file delete).
- **Source:** 04-01-PLAN.md

### P-04-05 — Few-shot prompting for small structured-output models
- **Pattern:** When using a 3B-class local model for structured JSON, embed 3-4 concrete input/output examples in the prompt covering the ambiguous boundaries (title vs time, event vs duration). Rule-only prompts are insufficient.
- **Where:** parseIntent buildPrompt
- **Reusable for:** All Aria pipelines that ask local models for typed output — sensitivity routing, action-item extraction.
- **Source:** commit 7488dda

### P-04-06 — Pre-fetch then pure-function for testable conflict logic
- **Pattern:** Heavy/slow/network operations (freebusy query) live in the caller. Pure-function consumer takes plain data inputs. Unit tests are trivial; orchestrator can swap data sources (e.g., Outlook freebusy).
- **Where:** `detectConflictsAndAlternatives` in conflict.ts
- **Reusable for:** Phase 5 Outlook parity (same conflict detector, different source for busyIntervals).
- **Source:** 04-02-PLAN.md

---

## 4. Surprises

### S-04-01 — UAT surfaced more latent bugs than scope-creep
- **What:** Phase 4 UAT generated 9 fix commits, but only ONE was a Phase 4 bug (the chokepoint mis-fire). The other 8 were latent bugs from Phases 1, 2, 3 that no prior UAT had exercised.
- **Implication:** Live UAT after every phase is cheap insurance against latent drift. Phases that don't get UAT'd accumulate dark debt.

### S-04-02 — Verifier auto-PASS while user-facing feature unreachable
- **What:** The verifier marked CAL-05 (rules editor) PASS based on component existence + unit tests, but the component was never wired into any route. UAT broke this in <1 minute. Same pattern almost certainly hides elsewhere.
- **Implication:** Add a grep-based reachability check to gsd-verifier — for each new `*Section.tsx`, confirm it's imported by a Screen or routes file.

### S-04-03 — Ollama provider config bug had been silent for THREE phases
- **What:** Phase 3's sensitivity classifier uses the same `getLocalModel()` path. With the broken baseURL, every classify call has been 404'ing — likely falling back to a default decision. No user-visible alarm because the fallback "looked plausible".
- **Implication:** Phase 3 sensitivity routing needs re-verification with the now-functional pipeline.

### S-04-04 — "I couldn't understand" was hiding "I can't reach Ollama"
- **What:** Five rounds of model-blame, prompt-engineering, and schema-tightening before the real cause (404) was identified, because the renderer's hardcoded copy obliterated the actionable error message from the backend.
- **Implication:** Never silently replace structured error responses with constants. Always show the backend message; layer human-friendly copy on top, not instead of.

### S-04-05 — Self-created Google events DO return organizer info — sync just didn't store it
- **What:** Initial diagnosis assumed Google omitted `organizer` for solo events. False — Google returns `organizer: {email, self: true, displayName}` on every event the user owns. The Phase 2 sync drop was the issue, not API behavior.
- **Implication:** When diagnosing API-vs-storage failures, capture the raw API response first; don't trust intermediate schemas.

---

## Cross-phase action items

| ID | Item | Owner phase |
|---|---|---|
| F-1 | Audit Phase 3 sensitivity classifier — was it dark since ship? | Phase 4.5 or Phase 8 prep |
| F-2 | Fix approve flow architectural race (transitionTo before chokepoint) | Phase 4.5 |
| F-3 | Local TZ rendering in approval cards | Phase 4.5 or Phase 9 UI |
| F-4 | Time-of-day parse fidelity (`Friday 2pm` ≠ `Friday`) | Phase 4.5 |
| F-5 | One-shot sync_token clear when organizer_email IS NULL exists | Phase 4.5 or Phase 5 prep |
| F-6 | OllamaSection "Active model" refresh after Save | Phase 9 polish |
| F-7 | REFUSAL_COPY → real message + collapsible details | Phase 9 polish |
| F-8 | Onboarding seal: atomic with openDb, progress UX | Phase 4.5 or Phase 8 release prep |
| F-9 | Verifier reachability grep for new components | tooling, gsd-sdk |
| F-10 | qwen2.5:3b documented as low-RAM fallback in install docs | Phase 8 release prep |
