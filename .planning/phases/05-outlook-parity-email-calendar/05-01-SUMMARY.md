# Phase 05-01 Summary — Microsoft Graph Adapter Foundation

## Status

Wave 1 implementation is present in the working tree and has been verified with focused automated tests. Live Microsoft tenant/OAuth smoke was deferred because Microsoft OAuth keys are not currently available.

## Completed

- Added provider-account persistence foundation:
  - `011_provider_accounts.sql`
  - `012_message_provider_key.sql`
  - embedded migration entries
  - provider/account backfill for legacy Google rows
- Added provider token storage helpers in `safeStorage`.
- Added Microsoft integration modules:
  - MSAL auth/cache/client/error surfaces
  - identity-set extraction
  - mail adapter and delta sync
  - calendar adapter and delta sync
  - recurrence Graph/RFC5545 conversion helpers
  - provider-account helpers
  - Microsoft IPC connect/status/disconnect/force-sync
- Added provider-account canonical columns to synced mail/calendar/approval data.
- Added unit tests for Microsoft auth, cache, client, identity, mail, calendar, recurrence, sync, and IPC surfaces.

## Verification Run

Focused Microsoft suite:

```text
vitest run \
  tests/unit/main/integrations/microsoft/auth.spec.ts \
  tests/unit/main/integrations/microsoft/client.spec.ts \
  tests/unit/main/integrations/microsoft/identity.spec.ts \
  tests/unit/main/integrations/microsoft/mail-adapter.spec.ts \
  tests/unit/main/integrations/microsoft/calendar-adapter.spec.ts \
  tests/unit/main/integrations/microsoft/recurrence-graph.spec.ts \
  tests/unit/main/integrations/microsoft/sync-mail.spec.ts \
  tests/unit/main/integrations/microsoft/sync-calendar.spec.ts \
  tests/unit/main/ipc/microsoft.spec.ts \
  --reporter=dot
```

Result: 9 files passed, 16 tests passed.

## Deferred

- Live Microsoft tenant smoke: deferred until OAuth credentials/dev tenant are available.
- End-to-end Outlook send/calendar move: deferred to the Phase 5 human verification gate.

## Notes

- This summary was added after Wave 2 because the implementation files existed but the Wave 1 summary artifact was missing, causing Wave 3's dependency gate to see `05-01` as incomplete.
- Vitest emitted a transient native ABI teardown warning during one run: if Electron fails to launch, run `pnpm rebuild:native:electron`.
