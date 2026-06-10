---
phase: 21-digest-briefing-integration
plan: 01
subsystem: api
tags: [whatsapp, ipc-contract, typescript, briefing, digest]

# Dependency graph
requires:
  - phase: 20-whatsapp-foundation
    provides: WhatsApp IPC channels (LINK/DISCONNECT/LIST_GROUPS/SET_TRACKED/STATUS/QR_UPDATE/STATE_CHANGED), WhatsAppStatusDto, WhatsAppGroupDto, CatchupChannel with whatsapp-retention-sweep
provides:
  - BriefingPayload.whatsApp discriminated union field (ready/unavailable/undefined states)
  - WhatsAppGroupSummaryDto interface with per-group sub-state (summarized/no-activity/failed)
  - WHATSAPP_GENERATE_DIGEST_NOW channel in CHANNELS + CHANNEL_METHODS
  - whatsappGenerateDigestNow() handler signature in AriaApi interface
  - CatchupChannel extended with 'whatsapp-digest' literal
affects:
  - 21-02 (digest-cron uses CatchupChannel 'whatsapp-digest' + getLocalModel)
  - 21-03 (briefing read-path enrichment uses BriefingPayload.whatsApp + WhatsAppGroupSummaryDto)
  - 21-04 (generate-now IPC handler uses WHATSAPP_GENERATE_DIGEST_NOW channel)
  - 21-05 (renderer WhatsApp section consumes BriefingPayload.whatsApp union)
  - 21-06 (onUnlock drain uses 'whatsapp-digest' CatchupChannel)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Discriminated-union BriefingPayload field pattern extended: whatsApp? mirrors thisWeekInsights? (D-08)
    - Per-group inner sub-state DTO (WhatsAppGroupSummaryDto) — partial Ollama failure model (D-09)
    - CatchupChannel extension pattern: append new literal to union tail

key-files:
  created: []
  modified:
    - src/shared/ipc-contract.ts
    - src/main/lifecycle/pendingCatchup.ts

key-decisions:
  - "whatsApp? field uses discriminated union (not optional object) mirroring thisWeekInsights? precedent — enables exhaustive switch on state in renderer"
  - "WhatsAppGroupSummaryDto is a plain TS interface (not Zod schema) — briefing types do not need runtime validation at the IPC boundary (follows BriefingInsightRow pattern)"
  - "WHATSAPP_GENERATE_DIGEST_NOW follows invoke-channel pattern (not push) — returns { ok, error? } after enqueue; actual generation is async"
  - "'whatsapp-digest' appended as last CatchupChannel member — mirrors 'whatsapp-retention-sweep' placement (Phase 20 precedent)"

patterns-established:
  - "BriefingPayload side-sections use discriminated union with undefined=omit (see thisWeekInsights?, whatsApp?)"
  - "WhatsApp DTOs placed in Phase 20 region at end of ipc-contract.ts, below WhatsAppStateChangedDto"

requirements-completed:
  - WA-08
  - WA-09
  - WA-10

# Metrics
duration: 12min
completed: 2026-06-10
---

# Phase 21 Plan 01: Shared Type Contracts and CatchupChannel Extension Summary

**Discriminated-union WhatsApp briefing types (BriefingPayload.whatsApp, WhatsAppGroupSummaryDto, WHATSAPP_GENERATE_DIGEST_NOW) and CatchupChannel 'whatsapp-digest' added as the Wave 1 compile-time foundation for Phase 21**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-10T11:48:00Z
- **Completed:** 2026-06-10T12:00:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Extended `ipc-contract.ts` with four surgical additions: WHATSAPP_GENERATE_DIGEST_NOW channel (CHANNELS + CHANNEL_METHODS), BriefingPayload.whatsApp discriminated union, WhatsAppGroupSummaryDto interface, and whatsappGenerateDigestNow() AriaApi signature
- Extended `pendingCatchup.ts` CatchupChannel union with 'whatsapp-digest' literal (single-line addition, no other code changed)
- TypeScript compiles clean (0 errors) after both changes — all downstream Phase 21 plans can now import these contracts

## Task Commits

1. **Task 1: Extend ipc-contract.ts with WhatsApp briefing types and GENERATE_DIGEST_NOW channel** - `816a2f7` (feat)
2. **Task 2: Extend CatchupChannel union with 'whatsapp-digest'** - `01fb1f5` (feat)

## Files Created/Modified
- `src/shared/ipc-contract.ts` — Added WHATSAPP_GENERATE_DIGEST_NOW to CHANNELS and CHANNEL_METHODS, BriefingPayload.whatsApp? discriminated union, WhatsAppGroupSummaryDto interface, whatsappGenerateDigestNow() in AriaApi
- `src/main/lifecycle/pendingCatchup.ts` — Appended | 'whatsapp-digest' to CatchupChannel union

## Decisions Made
- WhatsAppGroupSummaryDto is a plain TypeScript interface (not a Zod schema) because briefing payload DTOs at this boundary are not validated at runtime — matches the BriefingInsightRow precedent
- The whatsApp? field uses an optional discriminated union rather than a required field — `undefined` maps to section-omit without any extra logic (mirrors thisWeekInsights? pattern exactly)
- WHATSAPP_GENERATE_DIGEST_NOW follows the invoke-channel pattern returning `{ ok: boolean; error?: string }` so the renderer can show immediate feedback without polling

## Deviations from Plan

None - plan executed exactly as written. All four additions to ipc-contract.ts landed at the documented insertion points; CatchupChannel received a single-line append.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All Phase 21 downstream plans can now compile:
  - Plan 21-02 (digest-cron): `pendingCatchup.add('whatsapp-digest')` is now a valid CatchupChannel member
  - Plan 21-03 (briefing read-path): `row.whatsApp = { state: 'ready', groups: [...] }` now type-checks against BriefingPayload
  - Plan 21-04 (generate-now IPC): WHATSAPP_GENERATE_DIGEST_NOW exists in CHANNELS for handler registration
  - Plan 21-05 (renderer): BriefingPayload.whatsApp union is ready for exhaustive switch in BriefingScreen
- No blockers.

---
*Phase: 21-digest-briefing-integration*
*Completed: 2026-06-10*
