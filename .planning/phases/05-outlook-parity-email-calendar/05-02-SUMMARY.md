# Phase 05-02 Summary — Outlook Parity Shared Chokepoints + Multi-Account UI

## Status

Wave 2 implementation is complete through Task 4. Task 5 human Outlook verification was explicitly deferred by the user, so Outlook live-send/live-calendar evidence is not claimed here.

## Completed

- Unified provider abstraction landed with Google and Microsoft adapters behind `ProviderRegistry`.
- Email send and calendar write paths now dispatch through shared chokepoints:
  - `src/main/integrations/send.ts`
  - `src/main/integrations/write-event.ts`
- Legacy Google chokepoint files were deleted:
  - `src/main/integrations/google/send.ts`
  - `src/main/integrations/google/write-event.ts`
- Static ratchets were collapsed to the shared chokepoints and provider wrapper files.
- `sending`, `failed`, and `needs-operator-decision` approval states are available for send recovery and operator handoff.
- Single-instance lock and boot recovery were added for in-flight sends.
- `SyncOrchestrator` was added and starts after vault seal/unlock.
- Scheduling propose now uses provider account `IdentitySet`; production string-overload call sites were removed.
- Provider token migration synthesizes `providerTokens.google:*` from legacy `googleTokens.*`; fresh Google reconnect writes provider tokens without repopulating legacy Google token storage.
- Multi-account Settings UI was added with `AddAccountModal`, `AccountRow`, provider-account IPC, and reachability tests.
- `StuckBadge` was added for 60s+ `sending` approvals with Cancel -> `needs-operator-decision`.

## Verification Run

- `vitest run tests/static/ --reporter=dot`: 3 files passed, 11 tests passed.
- Task 4 focused renderer/static suite previously passed: 6 files, 20 tests.
- Task 3 focused suite previously passed: 5 files, 29 tests.
- Task 2c focused suite previously passed: 9 files, 36 tests.
- `googleapis` direct grep count for `src/main/scheduling/`, `src/main/approvals/`, `src/main/briefing/`: 0.
- `assertSelfOnly` production string-call-site grep: 0.
- `@typescript-eslint/typescript-estree` test grep: 0.
- `/me/sendMail` grep: one match in `src/main/integrations/microsoft/mail.ts`.
- Migration `012a` sets `PRAGMA user_version = 121`.

## Deferred Manual Verification

The following Task 5 items remain unverified because the user asked to skip Outlook verification for now:

- Outlook draft -> approve -> `/me/sendMail` via shared chokepoint.
- Outlook calendar move -> Graph patch via shared calendar chokepoint.
- Live confirmation of `X-Aria-Idempotency-Key` in Outlook sent mail.
- Live C4 crash-recovery counts for auto-reconciled vs operator-decision sends.
- L-04-09 time-of-day fidelity reproduction on Outlook calendar move.

## Open Q 2

Direct `googleapis` grep count is 0 after comment hygiene filters. Decision: no descope was needed; scheduler/provider conformance remained in Task 3 scope.

## L-04-05 Trace

- Calendar path: `applyCalendarChange` only transitions after successful provider write; chokepoint failures keep rows in `approved` and record failure context.
- Email path: `sendApprovedEmail` transitions `approved -> sending -> sent/failed`; recovery reconciles in-flight sends by idempotency key or marks them for operator decision.
- Live Outlook Task 5 verification is deferred, so this summary records automated/unit evidence only.

## B2 + C4 Recovery

- `idempotency_key` is present and non-null after migration 012a.
- Boot recovery runs on seal/unlock before normal approval handling.
- Single-instance lock is wired at app boot.
- Manual Task 5 crash-recovery counts: deferred.

## Multi-Account UI Notes

- Existing Gmail and Google Calendar rows were preserved for regression safety.
- New provider-account list is additive and renders accounts from `provider_account`.
- `Reconnect` is visible for `needs-auth` accounts.
- `Disconnect` cascades through provider-account cleanup IPC.
- No new UI pitfall surfaced in focused renderer tests.

## ARIA_PROVIDER_REGISTRY

The legacy direct Google dispatch path has been removed from approval/write/send flow after Task 2c. `isProviderRegistryEnabled()` remains callable for Plan 05-03 cleanup, but the old legacy chokepoint files no longer exist.

## C1 Chokepoint Move

The move followed the planned peer -> migrate -> delete sequence:

- Task 2a introduced shared chokepoints alongside legacy files.
- Task 2b migrated callers to shared paths.
- Task 2c deleted legacy Google chokepoint files and collapsed ratchets.

Each task boundary had a green focused test run. Git commits were not created during this session, so commit-count evidence is not available.

## Known Remaining Typecheck Baseline

`tsconfig.node.json` still fails on pre-existing baseline errors:

- `src/main/drafting/email.ts(33,1)` unused `crypto`.
- `src/main/ipc/scheduling.ts(70,24)` implicit `any`.
- `src/main/ipc/scheduling.ts(75,25)` implicit `any`.
- `src/main/ipc/triage.ts(51,10)` unused `buildPromptFromMessages`.
- `src/main/scheduling/resolver.ts(289,16)` expected 1 argument, got 2.

`tsconfig.json` still fails on the pre-existing renderer baseline:

- `src/renderer/features/settings/SchedulingRulesSection.tsx(437,9)` `unknown` not assignable to `ReactNode`.
