# Phase 5 UAT - Outlook Parity Email + Calendar

Date: 2026-05-19
Status: Automated wave-3 checks PASS; live Outlook OAuth/manual tenant checks DEFERRED per user direction.

## SC-1 - Outlook Mail In Briefing Alongside Gmail

Automated status: PARTIAL PASS.

- PASS: Briefing rows now render `AccountChip` through the shared `BriefingItem` component.
- PASS: Briefing engine prefers local `provider_account` calendar rows and keeps provider/account identity on degraded calendar payloads.
- DEFERRED: Live Outlook mail + Gmail side-by-side briefing requires Microsoft OAuth credentials/tenant consent.

## SC-2 - Smart-Scheduling On Outlook

Automated status: PARTIAL PASS.

- PASS: Approval cards render account chips for provider-scoped rows.
- PASS: Calendar approval timestamps now use `schedulingRulesGet().timeZone` instead of hardcoded UTC.
- PASS: Backend `last_error_message` is rendered verbatim in approval cards.
- DEFERRED: Live Outlook write-back through Graph requires Microsoft OAuth credentials/tenant consent.

## SC-3 - Recurring Outlook Event vs Google Identical Render

Automated status: PASS.

- PASS: `CalendarGrid` renders Google and Outlook recurring events through the same tile structure.
- PASS: Provider account color and `AccountChip` are applied per event.

## SC-4 - Token Expiry On Outlook Isolated

Automated status: PARTIAL PASS.

- PASS: `ProviderStatusTray` aggregates per-account status and exposes reconnect actions.
- PASS: Existing settings account rows continue to show per-account status.
- DEFERRED: Revoking live Microsoft consent and reconnecting is blocked until OAuth credentials are available.

## C7 - Linux basic_text Keyring Guard

Automated status: PASS.

- PASS: `runDropLegacyGoogleKeyringPerAccount` skips destructive legacy Google token drops when `safeStorage.getSelectedStorageBackend()` returns `basic_text`.
- PASS: Verified accounts drop legacy Google token entries outside `basic_text`.

## C14 - recurrence_unsupported

Automated status: PASS.

- PASS: `RecurrenceUnsupportedPill` renders visible `complex recurrence - see in Outlook` copy for unsupported events.
- PASS: Pill links to `event.webLink` when available.
- PASS: First-detection toast persists per account in localStorage.
- PASS: Briefing local calendar gather excludes `recurrence_unsupported=1` events and surfaces a calendar status note with the suppressed count.

## Final Cleanup Verification

- PASS: Migration `014_legacy_singleton_views.sql` creates `gmail_account_view` and `calendar_account_view`.
- PASS: Because `012a` maps to user_version `121`, the runner maps `014_legacy_singleton_views.sql` to executable migration version `122`; otherwise the file would be skipped.
- PASS: `ARIA_PROVIDER_REGISTRY` is absent from production `src/` code.
- DEFERRED: Live safeStorage inspection for retained `googleTokens.*` entries requires user machine OAuth state after Microsoft setup.

## Manual Carry-Overs

- Microsoft live OAuth smoke remains deferred until keys are available.
- F-1 sensitivity classifier audit remains Phase 4.5 / Phase 8.
- F-4 time-of-day scheduling nuance remains Phase 4.5.
- F-8 onboarding seal atomicity unchanged.
- F-10 local model documentation remains Phase 8.
