# Phase 5 Independent Review

**Reviewer:** Independent fresh-context subagent (Claude, isolated context)
**Date:** 2026-05-18
**Verdict:** REVISE

## Summary

The plan is unusually detailed and the plan-checker has clearly applied pressure — the `sending` state machine, two-layer ratchet, AST first-line + runtime ordering split, frozen migration SQL, per-account keyring drop with verification, and ARIA_PROVIDER_REGISTRY kill-switch are all correctly motivated. However, several concrete risks survive both passes: the existing Phase 4 `applyCalendarChange(db, approvalId)` call signature is silently being changed (deps→registry), the chokepoint MOVE in 05-02 Task 2 happens in the same task as the ratchet rewrite (leaving an unverifiable window), migration 012a does an unconditional `INSERT INTO approval_new SELECT *` despite admitting the live column list isn't known at plan time, the AST first-line rule cannot tolerate normal post-write helper extraction, and the `sending` state machine still has a clear duplicate-send window when boot recovery races MSAL silent acquire. Several of these are BLOCKER-class for a phase that touches every approval write path in the app. Resolve them before execute.

## Concerns

### C1 — Chokepoint MOVE + ratchet REWRITE happen in the same task with no green intermediate (BLOCKER)
- **Where:** 05-02 Task 2 (`<files>` lists single-calendar-write-site.test.ts AND moves write-event.ts AND moves send.ts AND renumbers migrations AND adds `sending` state machine, all in one task).
- **Why:** The existing Layer-1 ratchet at `tests/static/single-calendar-write-site.test.ts` allow-lists `src/main/integrations/google/{write-event.ts, calendar.ts}`. The plan dissolves the chokepoint into `src/main/integrations/write-event.ts` and rewrites the ratchet to allow that new path. Between deleting the old test and landing the new one, *there is no green protection*. If the executor lands the move first, every Phase 4 e2e + Phase 3 send still works but the architectural invariant is unenforced. If they land the ratchet first, CI breaks. In a phase touching every send + every calendar write, this is the riskiest moment in the project and the plan does not split it.
- **Suggestion:** Split Task 2 into 2a (introduce new chokepoint files that *delegate* to legacy paths; ratchet allow-listed at both locations; Phase 4 paths untouched), 2b (flip approve.ts to call the new chokepoint, runtime tests stay green), 2c (delete legacy delegation, tighten ratchet to only-new-path). Same shape for send. This is the Phase 4 P-04-01 ratchet's whole point — preserve it during the migration, don't briefly remove it.

### C2 — `applyCalendarChange` signature silently changes (BLOCKER)
- **Where:** Existing Phase 4 signature is `applyCalendarChange(db, approvalId, deps?)` — see `src/main/integrations/google/write-event.ts:88`. Plan 05-02 Task 2's pseudo-code uses `applyCalendarChange({ db, approvalId })` (single object) and `registry.get(...)` instead of `deps.buildCalendarClient`. The truth bullet "Phase 4 e2e specs still pass without modification (regression-safe)" cannot be true if approve.ts must be retargeted at a different signature.
- **Why:** approve.ts already calls the old signature; any e2e or integration test that passes `deps.buildCalendarClient` to inject the CalendarClient (the Phase 4 test pattern) will silently bind to nothing. The plan checks `tsc --noEmit` but a renamed param + default destructuring will pass tsc and break at runtime.
- **Suggestion:** Either preserve the legacy `(db, approvalId, deps?)` signature on the new chokepoint and adapt deps to support a `providerOverride` for tests, OR call out the signature break explicitly with a typed migration step + adapter shim. Add a runtime test that exercises the actual Phase 4 propose→approve→write path against MSW.

### C3 — Migration 012a SQL is described as "illustrative not exhaustive" (BLOCKER)
- **Where:** 05-02 Task 2 action block: "The execute task MUST first cat the current approval schema ... and replicate every column exactly — this DDL block is the SHAPE not the column list."
- **Why:** The current `approval` table was rebuilt by migration 010 already (see `010_calendar_writeback.sql:17`) and has many calendar-specific columns (recurring_scope, before_json, after_json, calendar_event_id, rule_overrides_json) plus Phase 3 columns. `INSERT INTO approval_new SELECT * FROM approval` only works if column order is identical and counts match exactly — a single forgotten column in the illustrative DDL silently truncates real production rows. better-sqlite3 does NOT enforce column-count match on `SELECT *` into an explicitly-named table with the same column count and order — but if columns drift it will throw mid-migration AFTER `DROP TABLE approval`. There is no rollback once `DROP TABLE` runs inside the txn even on failure if a subsequent CREATE INDEX succeeds. Phase 4's L-04-01 lesson is exactly "migration columns ≠ wired columns" — and the plan is asking the executor to free-hand the live schema.
- **Suggestion:** Either (a) use `ALTER TABLE ... ADD COLUMN idempotency_key` + extend CHECK via a triggered approach + DROP+re-add CHECK via a separate table-rebuild AT THE END, OR (b) commit the verbatim full DDL into the plan now (the planner can read 010_calendar_writeback.sql and write it exhaustively). Don't ship a "fill this in at execute time" migration for the approval table.

### C4 — `sending` state machine still has a duplicate-send window (HIGH)
- **Where:** 05-02 Task 2 action, sendApprovedEmail body steps 4–6.
- **Why:** The window narrows but is not closed. Three remaining races:
  1. **Process crash between `transitionTo('sending')` and the await of `sendMessage`** — boot recovery flips to needs-operator-decision, but the network call may have been buffered to the OS socket and sent. The plan acknowledges this and pushes resolution onto the user via the banner ("check Sent folder"). That is the right call for v1 but should be called out as residual risk in the plan's success criteria, not described as "preventing a duplicate-send hazard" (B2 truth). It prevents *automatic* duplicates; it cannot prevent the first send from succeeding on the wire.
  2. **Two app instances racing** — Aria is local-first desktop; nothing in the plan prevents the user from launching a second instance (Electron does not single-instance by default unless `app.requestSingleInstanceLock` is called). Two instances boot, both see `state='sending'` and both move it to `needs-operator-decision`, OR (worse) both see `state='approved'` and both dispatch. Plan should explicitly invoke `requestSingleInstanceLock` or document it as pre-existing protection.
  3. **User clicks Approve a second time while in `sending`** — `assertApproved` reads `state='approved'`. If the row is in `sending` it throws ApprovalGateError correctly. Good. But the ApprovalCard UI must also disable the Approve button during `sending` — the plan never specifies this. A double-click within the same render frame before the state transition commits is a real path.
- **Suggestion:** Add `app.requestSingleInstanceLock()` to main.ts boot ordering. Add a `disabled={state==='sending'||state==='sent'}` invariant test for ApprovalCard. Reword B2 mitigation as "narrows to provider-level dedup window" rather than "prevents duplicate-send hazard".

### C5 — AST `body.body[0]` first-line rule is brittle and contradicts good refactoring (HIGH)
- **Where:** 05-02 Task 2: "explicit `applyCalendarChange.body.body[0]` AST traversal is the preferred form".
- **Why:** This forbids: (a) extracting an early-return guard helper like `assertCalendarPreconditions(db, approvalId)` that internally calls assertApproved, (b) wrapping in try/finally where the first statement is `const release = await mutex.acquire()`, (c) an idiomatic `using` declaration for cleanup, (d) adding a feature-flag short-circuit. The current Phase 4 grep ratchet was more flexible (literal absence test + presence within the file). The AST tightening solves a problem that does not exist (the runtime spy already enforces the actual invariant — transitionTo cannot run before dispatch). Coupling correctness to AST line index will cause executor churn at the worst time.
- **Suggestion:** Drop the AST first-line rule. Keep the runtime spy ordering test (B3) — that is the authoritative invariant. Keep the grep-based "assertApproved is mentioned within first 5 statements" as advisory. Or relax to "assertApproved appears before any registry.get / network call" via AST scan of all call expressions in source order — still implementable, more robust to refactoring.

### C6 — `$select` projection bake omits fields that block known v1 features (HIGH)
- **Where:** 05-01 Task 1 truths, message projection `[id, conversationId, subject, from, receivedDateTime, isRead, importance, bodyPreview, internetMessageId, categories, parentFolderId]`.
- **Why:** RESEARCH calls out this projection cannot change later without forced re-sync. Missing for known/planned features:
  - `toRecipients`, `ccRecipients`, `bccRecipients` — Phase 3 triage and reply drafting need to know who else was on the message. Their absence forces a per-message singleton GET on every drafted reply.
  - `replyTo` — reply drafting accuracy.
  - `flag` (followupFlag) — Outlook's exec-relevant "flag for follow-up" status; directly maps to "what needs me today".
  - `hasAttachments` — briefing surface and triage classify on this.
  - `webLink` — deep-link to Outlook web for the "View in Outlook" affordance the plan promises.
  - `inferenceClassification` (focused/other) — Outlook's own importance signal; if not captured at sync, mixing Outlook into briefing loses Focused Inbox semantics.
  - `sentDateTime` (vs receivedDateTime) — for sent items / Sent folder coverage.
  - `singleValueExtendedProperties` — not needed for v1, but skipping `mentions` means @-mention detection (a known exec-assistant signal) cannot be added without re-sync.
- **Suggestion:** Add `toRecipients, ccRecipients, replyTo, flag, hasAttachments, webLink, inferenceClassification, sentDateTime` to the mail projection before freezing. For calendar, double-check `webLink`, `responseStatus`, `onlineMeeting`, `attendees[].type` are all included (the listed projection mentions `attendees` but not its sub-fields — Graph $select on complex properties needs explicit sub-selection in some cases).

### C7 — Per-account legacy keyring drop on Linux basic_text + locked keychain edge cases (HIGH)
- **Where:** 05-03 Task 4, `dropLegacyGoogleEntry`.
- **Why:** The verification step decrypts the new entry and compares email. On Linux with `safeStorage.getSelectedStorageBackend() === 'basic_text'`, decryption is effectively a no-op base64 round-trip — "verification succeeds" is meaningless. On macOS Keychain or Windows DPAPI, if the keychain is locked at boot (rare on Windows, possible on macOS if FileVault is in an unusual state), `safeStorage.decryptString` throws with an opaque error; the algorithm treats this as `decrypt-failed` and leaves both entries. Re-run on next boot will repeatedly hit the failure if the underlying state is structural (e.g., the new entry was encrypted with a previous DPAPI master key after a Windows account change). Worse: if backend was `basic_text` at write time (Phase 1 warning ignored) and is now properly `gnome-libsecret` after a session config change, decryption fails on a perfectly valid plaintext entry — the legacy entry stays forever.
- **Suggestion:** Gate the drop behind `safeStorage.isEncryptionAvailable() === true && getSelectedStorageBackend() !== 'basic_text'`. On basic_text, defer drop and surface a one-time prompt suggesting the user accept the security trade-off. Record `backend` at write time inside the encrypted blob so verification can detect backend mismatch and re-encrypt rather than just "fail and retain".

### C8 — `assertSelfOnly` overload + Phase 4 string call site interaction (HIGH)
- **Where:** 05-01 Task 5, `assertSelfOnly(event, string)` overload preserved.
- **Why:** The Phase 4 string call site reads from the `calendar_account` singleton (L-04-08 lesson). Plan 05-02 Task 3 then changes the scheduler to load identity from `provider_account.identity_set_json` and pass an `IdentitySet`. But this is described as conformance for new call sites — the *existing* propose.ts call site continues to pass a string per 05-01 Task 5's blast radius enumeration. Once Plan 05-02 Task 3 generalizes propose to be provider-agnostic, what happens to the existing string call site? Two readings:
  1. Plan 05-02 Task 3 updates propose.ts to pass IdentitySet — but the plan's truth bullet "propose.ts/resolver.ts/conflict.ts accept (providerKey, accountId)" does not explicitly say "and now passes IdentitySet to assertSelfOnly".
  2. The string call site remains and 05-02 Task 3 only changes freeBusy. Then Outlook events flowing through the (still-string-based) gate hit only `primaryEmail` and miss UPN/aliases — defeating Pitfall 8 mitigation for any Outlook event the scheduler proposes a move on.
- **Suggestion:** Make 05-02 Task 3 explicit: propose.ts must load `IdentitySet` from `provider_account.identity_set_json` and pass that overload, not the string. Add a unit test that proposes a move on an Outlook event organized by an alias and asserts the gate accepts.

### C9 — MSAL silent acquire + boot ordering race (MEDIUM)
- **Where:** 05-02 Task 3 boot ordering: `openDb → migrations → recoverInflightSends → runDropLegacyGoogleKeyringPerAccount → startSyncOrchestrator`.
- **Why:** `recoverInflightSends` does NOT attempt to verify whether the in-flight message actually reached the provider — by design, it gives up and asks the user. Reasonable for v1. But `startSyncOrchestrator` immediately triggers MSAL `acquireTokenSilent` for every Outlook account at boot. On a cold boot with a network blip, every Outlook account may transiently flip to `degraded` or even `needs-auth` (Pitfall 6 single forceRefresh retry exists, but if THAT also fails on cold network, `needs-auth` sticks). The user reconnects, then the sync orchestrator runs again — but `recoverInflightSends` already ran and won't re-evaluate. If the user had a `sending`-state row and the actual provider DID send it during the previous session, the recovery banner stays up with no resolution path other than "check Sent folder manually". Fine but documents the user-facing failure mode poorly.
- **Suggestion:** Add jittered network-availability check before flipping accounts to needs-auth at cold boot; require two consecutive forceRefresh failures across a 30s window. Document SendingRecoveryBanner explicit user actions: "Mark as sent" / "Resend" / "Discard" — the plan describes the banner but not the resolution affordances.

### C10 — Two-layer ratchet Layer 2 regex misses common patterns (MEDIUM)
- **Where:** 05-02 Task 2 forbidden literals.
- **Why:** The Graph regex `/client\.api\(\s*['"]\/me\/events['"]\s*\)\s*\.\s*patch\s*\(/` matches `client.api('/me/events').patch(` but not:
  - `client.api(\`/me/events/${id}\`).patch(...)` — template literal with id interpolation (the actual common shape).
  - `client.api('/me/events/' + id).patch(...)` — string concat.
  - `client.api('/users/' + userId + '/events').patch(...)` — `/users/{id}/events` is a valid Graph endpoint not covered.
  - `client.api('/me/calendar/events').patch(...)` — alternate canonical path.
  - `client.api('/me/calendars/' + cid + '/events').patch(...)` — multi-calendar path.
  
  An executor adding a per-instance patch via template literal slips the Layer 2 ratchet completely.
- **Suggestion:** Broaden the Graph regexes to match `client\.api\(\s*[`'"][^)]*\/events(\/[^)]*)?[`'"]\s*\)\s*\.\s*(patch|post|delete)\s*\(/` and add template-literal matchers `client\.api\(\s*`[^`]*\/events`. Same for `/sendMail` and message draft send. Add unit tests that the regexes catch each pattern.

### C11 — Provider interface lacks fields v1 already needs (MEDIUM)
- **Where:** 05-02 Task 1 Provider shape.
- **Why:** Two concrete v1 needs missing:
  - **Capability for "draft create + edit" flow.** Phase 3 supports user-editable drafts. Gmail allows `drafts.create` + `drafts.update` + `drafts.send`. Graph has its own draft lifecycle (`/me/messages` POST creates a draft; PATCH edits; `/messages/{id}/send` sends). The plan describes `sendMessage` and a two-call reply (`createReply` + send) but not the draft-edit lifecycle. If Phase 3's voice-match drafting flow currently calls `gmail.users.drafts.update`, the abstraction doesn't cover it.
  - **No `getCalendarList` / multi-calendar discovery.** Outlook users routinely have multiple calendars (work, personal, shared). The plan reads only `/me/events` and `/me/calendar/events` interchangeably — no path for the secondary calendar a user adds in Outlook. CAL-03 promises unified multi-calendar but the read path is single-calendar per account. May be acceptable for v1 but should be explicit.
- **Suggestion:** Add `mail.upsertDraft(canonical) → { externalId }` to the Provider interface; if Phase 3 doesn't need it yet, leave the Microsoft impl `throw new NotImplementedError`. Add a one-sentence note in CONTEXT clarifying v1 reads only the default calendar per Outlook account (CAL-03 "all connected calendars" interpreted as "all connected accounts, default calendar each"). Better to acknowledge the gap now than ship surprise.

### C12 — Migration numbering scheme is left to executor at task start (MEDIUM)
- **Where:** 05-02 Task 2 action: "12.1 (or 13 if scheme uses integers — pick 13 and bump 05-03's migration to 014)".
- **Why:** Phase 4 already shipped migration 010. Current files are `006...010_calendar_writeback.sql`. Phase 5 introduces 011 and 012 (both integer). Then 012a is described as "or 013". Then 05-03 has 014 "or whatever". Letting the executor decide a global ordering invariant at task start, *across two separate plans*, invites 05-02-SUMMARY and 05-03 to disagree about user_version. The 05-03 truth bullet asserts `user_version=14` while 05-02 truth bullet asserts `user_version=13` — these encode a decision the plan also says is open.
- **Suggestion:** Pick now in the plan: 013 (idempotency_key + state extension) and 014 (legacy views). Update both plan files to remove the conditional. The current allowance is a small but real coordination risk between two sequential plans.

### C13 — MSAL token cache encryption per-platform + tenant-switch invalidation (MEDIUM)
- **Where:** 05-01 Task 2 cache.ts.
- **Why:** MSAL serializes its cache as JSON. The plan encrypts the blob via safeStorage. Two gaps:
  - On Linux basic_text, T-05-01-02 says "surface existing Phase 1 warning before connect proceeds". But MSAL cache holds refresh tokens — a basic_text store is essentially plaintext disk. The Phase 1 warning targeted Google tokens; the warning text needs to be specific that MSAL refresh tokens are also at risk.
  - If a user signs into a different tenant on the same Microsoft account (work vs personal), MSAL's `homeAccountId` differs and the new cache entry should be a SEPARATE key. The plan keys on `accountId=homeAccountId` which handles this. But if the user revokes consent on one tenant and reconnects on another, the orchestrator may still see the old `provider_account` row with `status='ok'` until the next sync tick — there's a window of cross-tenant identity confusion. Test SC-4 only revokes; it doesn't cover the tenant-switch case.
- **Suggestion:** Add a tenant-switch UAT step. On `connectMicrosoft` completion, if a `provider_account` row already exists with same display_email but different homeAccountId, prompt the user before swapping. (Cheap; reduces surprise.)

### C14 — `recurrence_unsupported` row UX is undefined (LOW)
- **Where:** 05-01 Task 4 + 05-03 Task 2.
- **Why:** When Graph returns a lossy pattern (BYHOUR / RDATE / EXDATE), the event persists with `recurrence=null, recurrence_unsupported=1`. 05-03 renders a "View in Outlook" badge instead of expanding instances. But: the briefing's `gather.ts` reads from `calendar_event WHERE account_id IN (...)`. A series-master with `recurrence=null` looks like a single one-off event at its `startUtc` — the briefing will surface ONE occurrence of a weekly recurring event with unsupported BYHOUR, on its first occurrence only, forever. Worse: the unified calendar grid shows it once. The user sees "missing" events on subsequent weeks and won't connect that to the "View in Outlook" badge.
- **Suggestion:** When `recurrence_unsupported=1`, the grid should expand using `seriesMasterId` instances fetched separately (the `eventInstances` capability already exists in the Provider interface). For briefing, suppress these events entirely and surface a small status note. Specify the UX or close it as a known v1 gap in 05-CONTEXT.

### C15 — Phase 4 `<verify>` runtime ordering test does not cover the kill-switch path (LOW)
- **Where:** 05-02 Task 2 runtime ordering test (B3).
- **Why:** The spy test runs against the registry path. The kill-switch fallback `legacyGoogleProvider()` is exercised in Task 2.5 manually but not by the runtime ordering spy. If the kill-switch path accidentally calls `transitionTo` before dispatch (because it re-uses the old Phase 4 code which had L-04-05 still latent), the test passes but the kill-switch breaks the very invariant it exists to preserve.
- **Suggestion:** Add a parallel runtime ordering test parameterized on `ARIA_PROVIDER_REGISTRY=true|false`. Both modes must pass the ordering invariant.

### C16 — UPN-only org accounts where /me returns no `mail` (LOW / EDGE)
- **Where:** 05-01 Task 2 identity.ts.
- **Why:** Some M365 tenants have users with `userPrincipalName` set but `mail` empty (unlicensed Exchange, federated, B2B guests). `fetchSelfIdentity` falls back to empty arrays. `display_email` then ends up as empty string and `provider_account.display_email` is `NOT NULL`. Connect fails or produces a garbage row.
- **Suggestion:** Identity resolution priority: `mail || userPrincipalName || displayName`. Document in identity.ts. Add unit test fixture for the `mail: null` case.

## Strengths

- Clear separation of "build Microsoft side first; abstract later" (05-01) from "lift abstraction" (05-02) from "user surfaces + cleanup" (05-03). This is the right risk shape.
- Two-layer ratchet (Layer 1 on Provider methods + Layer 2 on SDK literals) is the correct evolution of P-04-01.
- `sending` state machine + idempotency_key + boot recovery banner is genuinely well thought out for an irreversible-action problem; even where it has gaps (C4), the architecture is sound.
- Runtime spy ordering test (B3) is the right tool — the plan rightly rejected brittle line-offset checks.
- Kill-switch (ARIA_PROVIDER_REGISTRY) with explicit sunset in 05-03 is appropriate de-risking for the highest-risk refactor in the project.
- Per-account keyring drop with verification + partial-failure non-stranding (R4) is much safer than the obvious "wipe all on success" approach.
- Frozen migration SQL invariant (R2) directly addresses Phase 4's L-04-01 / mid-phase migration drift.
- Open Q 2 grep decision routed through SUMMARY rather than re-evaluated in 05-03 (M5) is good plan hygiene.
- Reachability test (component-reachability.test.ts) carries forward L-04-04 / S-04-02 lesson properly.
- Honoring Pitfall 8 (UPN ≠ SMTP) via `IdentitySet` rather than a bare email string is the right design.

## Final verdict

**REVISE.** C1, C2, C3 are blockers — the chokepoint move + ratchet rewrite needs to be split into safe intermediate states, the signature change must be made explicit (not a "make it work" instruction), and migration 012a must commit verbatim column-correct DDL into the plan. C4–C8 are HIGH risks that should be resolved before execute. The remaining concerns are smaller and could be handled in execute-time judgment, but the blockers genuinely warrant a plan-checker third pass on the chokepoint move sequencing.
