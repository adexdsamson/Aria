# Phase 4 Discussion Log

**Date:** 2026-05-17
**Phase:** 4 — Calendar Smart-Scheduling (Google)

Human reference only. Downstream agents read CONTEXT.md.

## Gray Areas Selected
- NL command parsing
- Conflict detection + alternatives
- Rules engine design
- Attendees + recurring + write-back

## Q&A

### NL command parsing
- **Intent schema:** _Action + target + when (+ optional attendees/duration); separate resolver step._
- **Ambiguity handling:** _Clarification round-trip in chat._
- **Command scope (v1):** _Move + Create + Find-time. Cancel NOT in v1._

### Conflict detection + alternatives
- **Conflict types:** _All four — busy, focus, buffer (soft), no-meeting/OOO/working-hours._
- **Alternatives:** _Top 3 ranked by proximity to requested time._
- **Working hours:** _Google Calendar's native working-hours setting as hard boundary._

### Rules engine design
- **Config shape:** _Typed JSON, no DSL, settings UI._
- **Hard vs soft override:** _Hard rules block proposal; explicit "Override" button on the alternative; override logged._
- **Prime-time semantics:** _User-defined windows; scorer prefers them only for high-value events (>30min + external attendees, or tagged)._

### Attendees + recurring + write-back
- **Multi-attendee scope:** _Self-only in v1; refuse if event has other attendees._
- **Recurring UX:** _Default to "this instance" with explicit option to change to "all future" or "all"._
- **Time-zone source of truth:** _User's Google primary-calendar TZ as canonical; OS TZ fallback with banner._

## Deferred Ideas
- Cancel command → v1.x
- Multi-attendee changes → v1.x
- Aria-managed working hours → defer (use Google's)
- Rule-fitness scoring for alternatives → v1.x
- Travel-mode TZ override → v1.x
- Bulk find-and-replace, accept/decline → out of scope
- Google push notifications → v1.x

## Claude's Discretion (not asked, applied)
- Use `events.patch` (not `update`) to preserve unknown fields
- `sendUpdates='none'` enforced by self-only invariant
- Audit log row before AND after Google API call
- Reuse Phase 2 OAuth abstraction for write-scope add-on
- NL→intent through p-queue; sensitivity classifier not invoked for routine scheduling commands
- Self-only detection must surface attendee count early so refusal happens before alternative search
