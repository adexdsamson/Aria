# Phase 4 Context: Calendar Smart-Scheduling (Google)

**Phase:** 4
**Date:** 2026-05-17
**Mode:** mvp
**Requirements (locked by ROADMAP):** CAL-04, CAL-05, CAL-06, CAL-07, APPR-02

<domain>
Aria reschedules meetings from natural-language commands on Google Calendar, with conflict detection and user-defined scheduling rules enforced. Delivers:
- Calendar write-scope OAuth + canonical Event model + Google recurring-event handling
- Typed scheduling-rules engine (focus blocks, buffers, no-meeting windows, time-zone, prime-time)
- NL command parsing → structured intent → conflict check → Approval Queue
- Calendar approval card flow (reusing Phase 3 generic queue)
</domain>

<canonical_refs>
- `.planning/ROADMAP.md` — phase 4 scope, plans, success criteria (lines 87–99)
- `.planning/REQUIREMENTS.md` — CAL-04..07 (lines 52–55), APPR-02 (line 30)
- `.planning/PROJECT.md` — trust posture, approval gating policy
- `CLAUDE.md` — googleapis 144+, google-auth-library 9, Vercel AI SDK 5 + Zod for `generateObject`, p-queue, better-sqlite3
- `.planning/phases/03-approval-queue-sensitivity-router-email-triage-drafting-send/03-CONTEXT.md` — Approval Queue state machine, tier schema, classifier/router patterns to reuse for calendar items
- `.planning/phases/02-gmail-ingest-daily-briefing-mvp/02-CONTEXT.md` — Google OAuth pattern, 15min Calendar poll cadence already locked
- Google Calendar API recurring-event semantics docs (researcher to fetch)
</canonical_refs>

<prior_decisions>
**Project-level:**
- All material calendar changes require explicit approval (APPR-02)
- Local-first; OAuth via google-auth-library loopback flow

**From Phase 2:**
- Calendar polling cadence 15min already locked
- Google OAuth abstraction landed; reuse for write-scope add-on

**From Phase 3:**
- Approval Queue is generic — accepts non-email items without refactor
- Tier schema (silent/explicit/always-confirm + per-content-class overrides) is in place; calendar changes default to always-confirm
- Approval card supports edit-then-approve, reject, snooze, batch — calendar uses same actions
- p-queue serializes all LLM calls
- Sensitivity classifier exists from Phase 3 but calendar payloads don't go to frontier with PII by default (rules engine + slot search runs locally)
</prior_decisions>

<decisions>

### NL command parsing
- **Intent schema (Zod via `generateObject`):** `{ action: 'move'|'create'|'find-time', target: { eventRef?: string, nlDescription?: string }, when: { datetimeRange?: ISO, nlWhen?: string }, attendees?: string[], duration?: minutes }`. A separate resolver step turns NL refs (`"my 3pm"`) into concrete Google event IDs and concrete datetimes.
- **Pipeline:** NL → intent → resolver (event ID + datetime resolution against calendar context) → conflict check → proposed change → Approval Queue.
- **Ambiguity handling:** Clarification round-trip in chat. When resolver finds >1 plausible target (e.g. two 3pm events), Aria asks `"Which one — X or Y?"` before proposing. No auto-pick.
- **v1 command scope:** move (reschedule), create new event, find-time (read-only slot suggestion). **Cancel is NOT in v1** — punt to v1.x; if user issues cancel, Aria refuses with a "cancel is coming, do it in Calendar for now" message.
- **Out of scope for v1:** accept/decline invitations on user's behalf, find-and-replace bulk edits.

### Conflict detection + alternatives
- **Conflict types — all four detected:**
  - Busy block (existing event) — **hard**
  - Focus block (rule-defined) — **hard** by default, override possible
  - Buffer violation (less than configured buffer between meetings) — **soft** (warn + propose anyway)
  - No-meeting window / OOO / outside working hours — **hard**, override needed
- **Alternatives:** Top-3 ranked by proximity to requested time. (Rule-fitness scoring deferred to v1.x — proximity is the v1 ranking.)
- **Working hours:** Use Google Calendar's native working-hours setting as the hard boundary for slot search when available. **AMENDED 2026-05-18 (per RESEARCH Q1 RESOLVED):** Google Calendar v3 API does not reliably expose working-hours start/end. When `CalendarClient.getCalendarSettings()` returns `workingHours=undefined`, the authoritative fallback is an optional `workingHours: { start: "HH:mm", end: "HH:mm", weekdays: number[] }` field on `scheduling_rules.rules_json` (RulesSchema in Plan 04-02). Google remains the canonical source when available; the rules-JSON field is a strict fallback only.
- **Slot scorer inputs (v1):** proximity to requested time; buffer adherence (penalty if soft-conflict); prime-time bonus for high-value events only.

### Rules engine design
- **Config shape:** Typed JSON, no DSL. Schema (sketch):
  ```ts
  {
    focusBlocks: [{ day: Weekday | 'all', start: 'HH:mm', end: 'HH:mm' }],
    buffers: { beforeMin: number, afterMin: number },
    noMeetingWindows: [{ day, start, end, label }],
    primeTimeWindows: [{ day, start, end }],
    timeZone: IANA  // mirrors Google calendar TZ; settable for travel mode in future
  }
  ```
  Edited via settings UI; advanced users can drop into JSON.
- **Hard vs soft:** Hard rules **block** the initial proposal. Aria refuses (per SC-3) and shows alternatives. Each alternative may carry an explicit **"Override and schedule into focus/no-meeting"** button — click logs the override with reason.
- **Override logging:** Overrides recorded in audit log (table) for future learning of which rules the user actually keeps.
- **Prime-time priority (CAL-07):** User defines prime-time windows; slot scorer prefers them only for **high-value events**. "High-value" v1 heuristic: longer than 30min AND has external attendees OR explicit user tag. Non-high-value events deliberately routed to non-prime slots when possible.

### Attendees + recurring + write-back
- **Multi-attendee scope (v1): self-only events only.** If the target event has other attendees, Aria refuses the move/create with a clear message ("multi-attendee calendar changes coming in v1.x — please do this one in Google Calendar"). This punts attendee-notification UX and consent friction.
  - Implication: NL parser must surface attendee count early so the refusal happens before generating alternatives.
  - **Find-time** can include attendees as a free-busy lookup constraint without writing.
- **Recurring 'this / future / all' UX:** Approval card defaults to **"this instance"** with explicit radio buttons to switch to "all future" or "all". Default surfaces the safest choice; user must consciously change for broader impact (satisfies SC-4 — choice is explicit and visible).
- **Time-zone source of truth:** User's Google primary-calendar TZ is canonical. NL parser interprets datetimes in that TZ; conflict checks normalize to it. Falls back to system OS TZ only if Google TZ unavailable, with a banner warning.
- **Write-back:** Use `events.patch` (not `update`) to preserve fields Aria doesn't know about. Recurring writes use `sendUpdates='none'` enforced by self-only constraint (no attendees to notify). Audit log row written before AND after Google API call.

### Cross-cutting
- **OAuth:** Calendar write scope added incrementally to existing read scope; consent prompt explains why. Reuse Phase 2 OAuth abstraction.
- **LLM calls:** NL→intent runs through p-queue. Sensitivity classifier from Phase 3 NOT invoked for routine scheduling commands (calendar payload is structured, not body text); if user's NL command contains PII tokens, redaction helper still applies before frontier call.
- **Approval card for calendar:** Shows before/after time, event title, attendees list (read-only, since self-only), conflict-check result, rule-impact summary, recurring scope radio (when applicable).
- **Polling vs push:** v1 stays on 15min poll (Phase 2). Google push notifications for low-latency change detection deferred to v1.x.

</decisions>

<deferred>
- **Cancel command** — v1.x (user explicitly excluded from v1 commands)
- **Multi-attendee move/create** — v1.x (self-only in v1)
- **Aria-managed working-hours config** — defer; use Google's
- **Rule-fitness scoring for alternatives** — v1.x; v1 ranks by proximity
- **Travel-mode TZ override** — schema supports it; UI deferred
- **Bulk find-and-replace scheduling** — out of scope
- **Accept/decline invitations on user's behalf** — out of scope
- **Google push notifications** — v1.x optimization
- **Background re-scoring on rule changes** — defer
</deferred>

<open_questions_for_research>
- googleapis 144+ recurring-event API: `events.patch` semantics for `this instance` (RFC5545 EXDATE vs separate event instance) — researcher must confirm the correct shape for each of (this / future / all) writes
- Working-hours field on Google Calendar: how to read (CalendarSettings API?), what to do if user hasn't set it
- `generateObject` + Zod reliability for NL→intent on local Ollama vs frontier — solo-dev tradeoff
- Self-only detection: cheapest way to determine an event is self-only (organizer == self AND attendees empty? or organizer == self AND all attendees == self?)
- Conflict-check performance: how to query free/busy across N rule windows + busy blocks efficiently for top-3 alternative search; pre-cache window?
- iCal RRULE parsing — use a vetted lib (rrule.js) vs minimal hand-roll
- Audit-log table shape — extend Phase 3 routing-log or new calendar-actions table?
</open_questions_for_research>

<success_criteria_recap>
From ROADMAP (locked):
1. User types "move my 3pm to Thursday" and sees a proposed change with conflict check, awaiting approval
2. Approved calendar changes write back to Google Calendar with correct time-zone handling
3. Aria refuses to schedule into a focus block without explicit override
4. Recurring meeting moves handle the "this instance / all future / all" decision explicitly
</success_criteria_recap>
