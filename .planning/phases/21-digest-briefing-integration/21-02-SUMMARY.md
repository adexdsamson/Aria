---
phase: 21-digest-briefing-integration
plan: 02
subsystem: test
tags: [whatsapp, tdd, wave-0, briefing, digest, vitest]

# Dependency graph
requires:
  - phase: 21-01
    provides: BriefingPayload.whatsApp discriminated union, WhatsAppGroupSummaryDto, WHATSAPP_GENERATE_DIGEST_NOW channel, CatchupChannel 'whatsapp-digest'
provides:
  - digest-cron.spec.ts with 5 failing stubs (Wave 0 gate for Plan 21-03)
  - briefing-whatsapp-enrichment.spec.ts with 6 failing stubs (Wave 0 gate for Plan 21-04)
  - BriefingScreen.spec.tsx extended with 3 Phase 21 WhatsApp union-state cases (gate for Plan 21-05)
affects:
  - 21-03 (must make digest-cron.spec.ts GREEN)
  - 21-04 (must make briefing-whatsapp-enrichment.spec.ts GREEN)
  - 21-05 (must make BriefingScreen.spec.tsx Phase 21 cases GREEN)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Wave 0 RED-first spec pattern: import from non-existent file → all stubs fail at import boundary (digest-cron.spec.ts)
    - makeStubIpcMain + vi.doMock('electron') pattern for IPC handler unit tests (briefing-whatsapp-enrichment.spec.ts)
    - makePayload/installAria spread-override for renderer unit tests (BriefingScreen.spec.tsx extension)

key-files:
  created:
    - tests/unit/main/whatsapp/digest-cron.spec.ts
    - tests/unit/main/ipc/briefing-whatsapp-enrichment.spec.ts
  modified:
    - tests/unit/renderer/features/briefing/BriefingScreen.spec.tsx

key-decisions:
  - "digest-cron.spec.ts imports startWhatsAppDigest from non-existent file — all 5 tests RED by construction until Plan 21-03 creates the implementation"
  - "briefing-whatsapp-enrichment.spec.ts seeds real DB rows (provider_account, whatsapp_group, whatsapp_group_digest) to test the full D-10 state matrix against the live BRIEFING_TODAY handler"
  - "BriefingScreen.spec.tsx extended append-only — no existing test cases modified; 3 new Phase 21 cases added at end of describe block"
  - "Case 14 (whatsApp=undefined) is GREEN immediately because the current BriefingScreen renders no WhatsApp section — this is the correct baseline"

patterns-established:
  - "Wave 0 Nyquist pattern: spec files created before implementation so each plan must make specific failing tests GREEN"
  - "D-07.3 resilience test pattern: spy on db.prepare to throw for WhatsApp queries, assert BRIEFING_TODAY resolves and payload.whatsApp is undefined"

requirements-completed:
  - WA-08
  - WA-09
  - WA-10

# Metrics
duration: 20min
completed: 2026-06-10
---

# Phase 21 Plan 02: Wave-0 Test Stubs (Nyquist Gate) Summary

**Three Wave-0 spec files created/extended as the Nyquist gate for Phase 21 — automated RED stubs covering every digest and briefing enrichment behavior before any implementation ships**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-06-10T12:50:00Z
- **Completed:** 2026-06-10T13:10:00Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Created `tests/unit/main/whatsapp/digest-cron.spec.ts` (262 lines, 5 failing stubs) — RED at import boundary because `src/main/whatsapp/digest-cron.ts` does not yet exist; covers WA-10/D-06/D-07.1/D-09
- Created `tests/unit/main/ipc/briefing-whatsapp-enrichment.spec.ts` (360 lines, 5 failing + 1 passing) — tests the full D-10 state matrix against the live BRIEFING_TODAY handler; covers WA-08/WA-10/D-07.3
- Extended `tests/unit/renderer/features/briefing/BriefingScreen.spec.tsx` with 3 new WhatsApp union-state cases — 2 RED (waiting for Plan 21-05 renderer), 1 GREEN (baseline undefined-→-absent)
- All 12 pre-existing BriefingScreen tests remain GREEN (append-only, no modifications)

## Task Commits

1. **Task 1: digest-cron.spec.ts — 5 failing stubs for WA-10/D-06/D-07.1/D-09** - `ba74188` (test)
2. **Task 2: briefing-whatsapp-enrichment.spec.ts — 6 stubs for WA-08/WA-10/D-07.3/D-10 state matrix** - `80b1f96` (test)
3. **Task 3: BriefingScreen.spec.tsx extended with 3 Phase 21 WhatsApp cases** - `17c78d2` (test)

## Files Created/Modified

- `tests/unit/main/whatsapp/digest-cron.spec.ts` — NEW: 5 failing RED stubs; mirrors whatsapp-retention.spec.ts in-memory DB + loggerMock + vi.fn() seam pattern; imports startWhatsAppDigest from non-existent file to force RED state
- `tests/unit/main/ipc/briefing-whatsapp-enrichment.spec.ts` — NEW: 6 stubs; mirrors briefing-regenerate.spec.ts makeStubIpcMain + vi.doMock('electron') pattern; seeds real DB rows for D-10 state matrix
- `tests/unit/renderer/features/briefing/BriefingScreen.spec.tsx` — EXTENDED: 3 new cases appended; uses existing makePayload/installAria helpers; existing 12 tests unchanged

## Decisions Made

- digest-cron.spec.ts imports directly from the not-yet-created implementation file — this is the canonical Wave 0 RED mechanism (the whole describe block fails at module boundary, not test-by-test)
- briefing-whatsapp-enrichment.spec.ts uses real in-memory DB with actual migration runner — same pattern as briefing-regenerate.spec.ts; seeds provider_account with correct schema (display_email NOT NULL, capabilities_json, status check constraint)
- BriefingScreen Case 14 (whatsApp=undefined → absent) is immediately GREEN because current BriefingScreen renders nothing for an undefined whatsApp field — this validates the baseline before Plan 21-05 adds the section
- vi.doMock for digest-cron module in briefing tests to prevent real cron startup in test environment

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed provider_account INSERT schema**
- **Found during:** Task 2 first test run
- **Issue:** Plan template used `(account_id, provider_key, label, status, access_token_enc, refresh_token_enc, extra_json)` but migration 138 uses `(account_id, provider_key, display_email, display_label, status, capabilities_json)` — `label` column does not exist, `access_token_enc`/`refresh_token_enc` columns removed in the schema rebuild
- **Fix:** Updated INSERT to use actual schema: `display_email`, `display_label`, `capabilities_json` with correct NOT NULL constraints
- **Files modified:** `tests/unit/main/ipc/briefing-whatsapp-enrichment.spec.ts`
- **Commit:** `80b1f96` (within task 2 commit)

## Verification Results

- `npx vitest run tests/unit/main/whatsapp/digest-cron.spec.ts` → **FAIL** (missing import — `no tests` executed) ✓ RED as expected
- `npx vitest run tests/unit/main/ipc/briefing-whatsapp-enrichment.spec.ts` → **FAIL** (5 failing / 1 passing — assertion failures, not syntax errors) ✓ RED as expected
- `npx vitest run tests/unit/renderer/features/briefing/BriefingScreen.spec.tsx` → **FAIL** (2 failing / 13 passing — new Phase 21 cases RED, existing cases GREEN) ✓ Partial RED as expected

## Nyquist Gate Status

All Phase 21 behaviors now have automated verification before implementation:

| Behavior | Spec File | Status |
|----------|-----------|--------|
| runNow() writes non-NULL digest row (WA-08/D-06) | digest-cron.spec.ts | RED |
| Ollama-down → NULL row (WA-10/Pitfall 2) | digest-cron.spec.ts | RED |
| INSERT OR REPLACE retry on NULL row (D-06/Pitfall 3) | digest-cron.spec.ts | RED |
| dbHolder.db===null → pendingCatchup (D-07.1) | digest-cron.spec.ts | RED |
| Partial p-queue failure → mixed rows (D-09) | digest-cron.spec.ts | RED |
| not-linked → payload.whatsApp undefined (D-10) | briefing-whatsapp-enrichment.spec.ts | RED |
| zero-groups → payload.whatsApp undefined (D-10) | briefing-whatsapp-enrichment.spec.ts | RED |
| summarized digest → state='ready' (WA-08) | briefing-whatsapp-enrichment.spec.ts | RED |
| NULL digest → state='unavailable' (WA-10) | briefing-whatsapp-enrichment.spec.ts | RED |
| degraded status → connection='degraded' | briefing-whatsapp-enrichment.spec.ts | RED |
| BRIEFING_TODAY never throws (D-07.3) | briefing-whatsapp-enrichment.spec.ts | RED |
| whatsApp.state=ready → briefing-whatsapp rendered | BriefingScreen.spec.tsx | RED |
| whatsApp.state=unavailable → unavailable + retry | BriefingScreen.spec.tsx | RED |
| whatsApp=undefined → section absent (baseline) | BriefingScreen.spec.tsx | GREEN |

## Known Stubs

None — all stubs are intentionally RED for Wave 0. The RED state is the goal; GREEN is the job of Plans 21-03, 21-04, and 21-05.

## Next Phase Readiness

- Plan 21-03 (digest-cron.ts implementation): must make all 5 digest-cron.spec.ts tests GREEN
- Plan 21-04 (briefing enrichment): must make 5/6 briefing-whatsapp-enrichment.spec.ts tests GREEN
- Plan 21-05 (renderer): must make 2/3 BriefingScreen.spec.tsx Phase 21 cases GREEN

---
*Phase: 21-digest-briefing-integration*
*Completed: 2026-06-10*
