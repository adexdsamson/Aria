# Phase 5 Discussion Log

**Date:** 2026-05-17
**Phase:** 5 — Outlook Parity (Email + Calendar)

Human reference only.

## Gray Areas Selected
- Provider abstraction shape
- Recurring event normalization (CAL-08)
- Unified UI + multi-account UX
- Token expiry / re-auth / failure isolation

## Q&A

### Provider abstraction shape
- **Where:** _Single Provider interface with capability flags ({ mail, calendar })._
- **Google retrofit:** _New Outlook adapter alongside existing Google code; unify in a follow-up plan within the phase._
- **Sync-state:** _Dedicated per-provider sync_state table; canonical entities reference providerKey + accountId + externalId._

### Recurring event normalization (CAL-08)
- **Canonical model:** _iCal RFC5545 (RRULE/RDATE/EXDATE)._
- **Exceptions:** _Separate canonical Event row linked via parentEventId + originalStartTime._
- **Lossy conversion:** _Refuse to write; surface "this recurrence pattern isn't supported in Aria" in approval card._

### Unified UI + multi-account UX
- **Calendar view:** _Single merged view, color-coded by account._
- **Mail surface:** _Single sorted feed with account chip._
- **Multi-account:** _Yes — N of each provider supported in v1._

### Token expiry / re-auth / failure isolation
- **Failure isolation:** _Hard isolation: failed account is paused; other accounts keep syncing; briefing renders with what's available._ (Implementation also adds soft retry classification for 5xx/transient.)
- **Re-auth UX:** _Notification badge on Settings + chip on account; click chip → in-app OAuth re-consent._
- **Token storage:** _Per-provider helpers (separate keyring namespacing)._

## Deferred Ideas
- Exchange on-prem, IMAP, iCloud, Yahoo → out of scope
- Shared mailboxes / delegate → defer
- Outlook native categories/flags write → defer
- Calendar push notifications (Graph webhooks) → defer
- Cross-account drag-to-reschedule UX → defer
- Recurrence patterns outside supported list → refuse in v1

## Claude's Discretion (not asked, applied)
- Both hard-pause AND soft-retry classified by error code (not strictly either/or)
- Single-flight token refresh per (providerKey, accountId)
- v1 supported recurrence list: daily / weekly (byWeekday) / monthly (byMonthDay or byDay-nth) / yearly with COUNT/UNTIL/forever
- MSAL scopes: Mail.Read, Mail.Send, Calendars.ReadWrite, offline_access, User.Read
- Graph delta queries for incremental sync, matching Google's 5min/15min cadence
- Per-account color + label, user-editable (auto-assigned defaults)
