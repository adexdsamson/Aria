# Phase 5 Context: Outlook Parity (Email + Calendar)

**Phase:** 5
**Date:** 2026-05-17
**Mode:** mvp
**Requirements (locked by ROADMAP):** EMAIL-02, CAL-02, CAL-03, CAL-08

<domain>
Aria works for an Outlook/M365 exec the same as a Google one. Delivers:
- MSAL-node + Microsoft Graph adapter for Outlook mail (read + send) via PKCE auth-code flow
- Microsoft Graph adapter for calendar (read + write) with recurring-event normalization
- Provider abstraction across both stacks; unified multi-calendar + multi-account UX
- Failure isolation so one provider failing doesn't break the others
</domain>

<canonical_refs>
- `.planning/ROADMAP.md` — phase 5 scope, plans, success criteria (lines 101–113)
- `.planning/REQUIREMENTS.md` — EMAIL-02 (40), CAL-02 (50), CAL-03 (51), CAL-08 (56)
- `CLAUDE.md` — @azure/msal-node 3 + microsoft-graph-client 3, googleapis 144+, safeStorage, sqlite-vec
- `.planning/phases/02-gmail-ingest-daily-briefing-mvp/02-CONTEXT.md` — Google OAuth abstraction, 5min poll cadence, 15min Calendar polling, briefing surface, account chip patterns
- `.planning/phases/03-approval-queue-sensitivity-router-email-triage-drafting-send/03-CONTEXT.md` — generic Approval Queue (already accepts non-email items)
- `.planning/phases/04-calendar-smart-scheduling-google/04-CONTEXT.md` — Provider-agnostic scheduler design, self-only constraint, rules engine, recurring approval UX
- `.planning/phases/01-foundation/01-CONTEXT.md` — safeStorage keychain pattern
- Microsoft Graph mail API docs, Calendar API patterned-recurrence docs, MSAL-node PKCE flow (researcher)
- RFC5545 iCalendar spec (RRULE/RDATE/EXDATE)
</canonical_refs>

<prior_decisions>
**Project-level:**
- Local-first; all secrets via safeStorage (Phase 1)
- Approval gating policy applies to Outlook the same as Google

**From Phase 2:**
- Google OAuth abstraction with loopback redirect; Gmail 5min poll, 7d backfill, Calendar 15min
- Briefing is sectioned/exec-terse with top-N per section — applies to Outlook items too

**From Phase 3:**
- Approval Queue is provider-agnostic; sensitivity router shared across providers
- Tier schema and audit log are reusable; Outlook drafts/sends route through same flow

**From Phase 4:**
- Scheduler accepts canonical Event model; recurring approval card defaults to "this instance" with explicit radio for future/all
- Self-only events only in v1 — same constraint on Outlook
- Rules engine, conflict detection, top-3-by-proximity all provider-agnostic by design
- Audit log row before AND after each calendar API write
</prior_decisions>

<decisions>

### Provider abstraction shape
- **Single `Provider` interface with capability flags:** `{ providerKey, accountId, capabilities: { mail?: MailCapability, calendar?: CalendarCapability } }`. Each capability is its own sub-object with the relevant methods (`listMessages`/`sendMessage` for mail; `listEvents`/`patchEvent`/etc for calendar). Future providers can implement only one half.
- **Retrofit strategy:** Build the new Outlook adapter alongside existing Google code in plan 1–2. A separate plan within this phase unifies the Google adapter onto the same interface — accepts brief duplication to keep regression risk low.
- **Sync state:** Dedicated `provider_sync_state` table: `{ providerKey, accountId, resource: 'mail'|'calendar', cursor: deltaLink|historyId, lastSyncAt, lastError? }`. Canonical entity rows (Message, Event) carry `providerKey + accountId + externalId` for lookup.
- **Consumer pattern:** Higher-level services (TriageSvc, SchedulerSvc, BriefingSvc) accept canonical IDs; dispatch table maps `(providerKey, accountId) → Provider` instance. Adapters never seen by feature code.

### Recurring event normalization (CAL-08)
- **Canonical model: iCal RFC5545 (RRULE / RDATE / EXDATE).** Reasons: Google native; rrule.js stable; Graph pattern → RRULE conversion is documented and one-directional from a clean spec.
- **Microsoft Graph conversion:** Map `recurrence.pattern` + `recurrence.range` → RRULE on read; convert RRULE → Graph pattern on write. Handle RecurrenceRangeType: `endDate` (UNTIL), `numbered` (COUNT), `noEnd` (no clause).
- **Exception/override storage:** Each modified single instance is a **separate canonical Event row** with `parentEventId` + `originalStartTime`. Series row holds the RRULE; expanded instances rendered on demand; EXDATE generated from modified-instance rows.
- **Lossy conversion on write — refuse:** If a Microsoft pattern can't round-trip to RFC5545 (or vice versa), Aria refuses to write and the approval card surfaces `"This recurrence pattern isn't supported in Aria — please edit it in {provider} directly."` Trust-preserving; self-only constraint already limits surface.
- **Supported patterns (v1):** daily, weekly (byWeekday), monthly (byMonthDay or byDay-nth), yearly, with COUNT/UNTIL/forever. Anything outside → refuse. Document the supported list in the rules engine UI.

### Unified UI + multi-account UX
- **Calendar view:** Single merged calendar grid, **color-coded by account**. Per-account toggle to hide. Matches CAL-03 literally. SC-2 (smart-scheduling works on Outlook calendar) tested against the same Phase-4 scheduler flow.
- **Mail / briefing:** Single sorted feed with account chip on each item. Triage queue, briefing top sections, approvals — all unified, ranked by priority/time without per-account silos. Account chip lets user scope to one account if needed (chip-filter pattern, no separate views).
- **Multi-account same-provider:** v1 supports **N accounts of each provider**. `accountId` is first-class:
  - OAuth connect flow is "Add account" (not "Connect Google" — you can have multiple)
  - Settings shows account list with status, sync time, disconnect, re-auth
  - Briefing/queue items show `account chip (Outlook · work)` style label
  - Send-from defaults to the receiving account; user can swap on draft if needed
- **Account display:** color (auto-assigned, user-editable) + short label (user-editable, default = email handle).

### Token expiry / re-auth / failure isolation
- **Failure isolation (hard + soft):** Classify by error code.
  - **Hard pause** on auth failures (4xx invalid_grant / 401 after refresh): account marked `needs-auth`; its sync loop stops; other accounts continue.
  - **Soft retry** on transient (5xx, network, throttle): exponential backoff with cap; account stays `degraded` until success.
  - Briefing always renders with what's available; missing-account note appears in a "status" tray (not the briefing body).
- **Re-auth UX:** Notification **badge on Settings** + status chip on the affected account row. Less intrusive than a persistent app-wide banner. Click chip → in-app OAuth re-consent flow. (No modals interrupting unrelated work.)
- **Token storage:** Per-provider helpers — separate keyring namespacing. Each provider has its own `storeTokens(accountId, …)` / `getTokens(accountId)` helper that wraps safeStorage with a provider-specific key prefix (`aria:tokens:google:{accountId}`, `aria:tokens:msgraph:{accountId}`). Lets either provider rotate secret format independently.
- **Concurrent refresh:** Single-flight refresh per `(providerKey, accountId)` to avoid duplicate refresh storms on app start.

### Cross-cutting
- **MSAL-node:** Use auth-code + PKCE flow per CLAUDE.md. Public client app type. Scopes for v1: `Mail.Read`, `Mail.Send`, `Calendars.ReadWrite`, `offline_access`, `User.Read` (for identifying the account). Send-scope requested same-flow.
- **Graph polling cadence:** Same as Google — Gmail 5min, Calendar 15min. Use Graph `delta` queries for incremental sync (mail and events both support).
- **Outlook approval flow:** Outlook drafts route through Phase 3 Approval Queue; sensitivity classifier and tier gate behave identically. `EMAIL-06` send action uses Graph `sendMail`.
- **Test posture:** Plan 3 calls for "integration testing on a real M365 tenant" — this requires a developer M365 tenant. Researcher must identify cheapest viable option (M365 Developer Program subscription).

</decisions>

<deferred>
- **Exchange on-prem (non-Graph)** — out of scope; M365/Graph only in v1
- **Shared mailboxes / delegate access** — defer (self-only matches Phase 4 calendar constraint)
- **Outlook native categories/flags sync** — defer; v1 reads but doesn't write Outlook-specific metadata
- **Calendar push notifications (Graph webhooks)** — defer; v1 stays on 15min poll
- **iCloud / Yahoo / IMAP** — out of scope for v1
- **Cross-account drag-to-reschedule UX** — defer; smart-scheduling commands handle the core case
- **Recurrence patterns outside the supported list** — refuse-on-write in v1
- **Per-account theming beyond color + label** — defer
</deferred>

<open_questions_for_research>
- MSAL-node PKCE flow in Electron: BrowserWindow vs `loopbackInterface.executeRedirect` — which pattern is cleanest, do we need a custom redirect handler in main process
- Graph `/me/messages/delta` vs `/me/mailFolders('Inbox')/messages/delta` — best scope for our use case; how to bootstrap from empty state with 7d backfill window like Gmail
- Recurring conversion edge cases: Graph `weekIndex` (first/second/third/fourth/last) → RRULE BYSETPOS mapping; Graph `recurrenceTimeZone` handling vs event timezone
- rrule.js feature coverage vs RFC5545 — does it handle all patterns we plan to support
- M365 Developer Program — cost, signup friction, sandbox tenant capabilities, whether mail send is throttled in dev tenants
- Account ID stability — Graph `id` for `/me` vs `mail` vs `userPrincipalName` — pick the one that survives email-address change
- Existing Google adapter retrofit: scope of changes, integration tests that must pass before unification plan completes
- safeStorage on Linux: namespacing strategy when libsecret unavailable (basic_text fallback)
- Token refresh single-flight implementation — promise dedup vs lock file
</open_questions_for_research>

<success_criteria_recap>
From ROADMAP (locked):
1. User connects an Outlook account; Outlook mail appears alongside Gmail in the briefing
2. User connects Outlook Calendar; unified view shows both calendars; smart-scheduling works on Outlook calendar
3. A recurring event from Outlook displays identically to one from Google
4. Token expiry on Outlook surfaces a re-auth banner; other providers continue working
</success_criteria_recap>
