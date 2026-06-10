---
phase: 21-digest-briefing-integration
plan: 04
subsystem: ipc
tags: [whatsapp, briefing, ipc, read-path, tdd, enrichment]

# Dependency graph
requires:
  - phase: 21-01
    provides: BriefingPayload.whatsApp discriminated union, WhatsAppGroupSummaryDto, WHATSAPP_GENERATE_DIGEST_NOW channel
  - phase: 21-03
    provides: WhatsAppDigestHandle.runNow() for fire-and-forget D-07.3 fallback and GENERATE_DIGEST_NOW handler
  - phase: 21-02
    provides: briefing-whatsapp-enrichment.spec.ts (6 RED stubs turned GREEN by this plan)
provides:
  - readWhatsAppDigests module-local helper implementing D-10 state matrix (pure SELECT, no model)
  - row.whatsApp enrichment block in BRIEFING_TODAY (post-frontier, D-11)
  - WHATSAPP_GENERATE_DIGEST_NOW IPC handler (fire-and-forget runNow, SC4 retry affordance)
  - BriefingHandlerDeps.digestHandle optional field for D-07.3 wiring
affects:
  - 21-05 (renderer BriefingScreen.tsx now receives row.whatsApp from BRIEFING_TODAY)
  - 21-06 (index.ts bootstrap passes _digestHandle to registerBriefingHandlers deps)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Post-frontier enrichment block pattern: insert after thisWeekInsights try/catch, before return row (D-11)
    - D-10 state matrix: not-linked→undefined, zero-groups→undefined, all-failed→unavailable, any-summarized→ready
    - Never-throw enrichment: inner try/catch in readWhatsAppDigests re-throws; outer enrichment block catches + logs (D-07.3)
    - Fire-and-forget digest fallback: void deps.digestHandle.runNow() only when row.whatsApp===undefined
    - Optional injectable dep pattern: digestHandle?: WhatsAppDigestHandle | null added to BriefingHandlerDeps

key-files:
  created: []
  modified:
    - src/main/ipc/briefing.ts

key-decisions:
  - "readWhatsAppDigests is a module-local function (not a cross-module import) per D-13 — keeps the no-frontier ratchet boundary crisp and avoids coupling"
  - "digestHandle injected via optional deps field (not module-level import) — keeps test isolation clean; existing tests that do not pass it work unchanged"
  - "Enrichment block outer try/catch catches and logs, never re-throws — BRIEFING_TODAY always returns even when readWhatsAppDigests fails (WA-10/D-07.3)"
  - "WHATSAPP_GENERATE_DIGEST_NOW returns immediately with {ok:true}; runNow() is async fire-and-forget — no frontier, no await in handler"

patterns-established:
  - "Post-frontier enrichment seam: each new section added to BRIEFING_TODAY follows try/catch block inserted after thisWeekInsights block, before return row"
  - "D-07.3 fallback: when row.whatsApp===undefined && deps.digestHandle present, void digestHandle.runNow() — no await, never throws into briefing"

requirements-completed:
  - WA-08
  - WA-09
  - WA-10

# Metrics
duration: 15min
completed: 2026-06-10
---

# Phase 21 Plan 04: Briefing Read Path — WhatsApp Enrichment Summary

**readWhatsAppDigests module-local helper (D-10 state matrix) + row.whatsApp enrichment in BRIEFING_TODAY + WHATSAPP_GENERATE_DIGEST_NOW IPC handler wired in briefing.ts — all 6 Wave-0 RED stubs turned GREEN**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-10T12:08:00Z
- **Completed:** 2026-06-10T12:23:00Z
- **Tasks:** 2 (committed as one atomic change)
- **Files modified:** 1

## Accomplishments

- Added `readWhatsAppDigests(db, date, logger)` module-local function (105 lines) implementing D-10 state matrix:
  - Not-linked (no provider_account row) → `undefined`
  - Zero tracked groups → `undefined`
  - All groups below activity threshold (no digest rows for today) → `undefined`
  - All digest attempts failed (all summary_text=NULL) → `{ state: 'unavailable', reason: 'model-offline' }`
  - At least one summarized group → `{ state: 'ready', groups: [...] }`
  - `connection?` field populated from `provider_account.status` when `'degraded'` or `'needs-auth'` (D-10)
  - Annotated `// read-only, no model (D-13)` to maintain no-frontier ratchet boundary clarity
- Added enrichment block in `BRIEFING_TODAY` handler after the `thisWeekInsights` try/catch, before `return row` (D-11 post-frontier placement):
  - Wrapped in try/catch — never re-throws to caller (WA-10/D-07.3 resilience)
  - D-07.3 fire-and-forget fallback: `if (row.whatsApp === undefined && deps.digestHandle) { void deps.digestHandle.runNow(); }`
- Added `WHATSAPP_GENERATE_DIGEST_NOW` IPC handler returning `{ok:true}` immediately; calls `deps.digestHandle.runNow()` fire-and-forget (no frontier, no blocking await)
- Extended `BriefingHandlerDeps` with optional `digestHandle?: WhatsAppDigestHandle | null`
- All 6 `briefing-whatsapp-enrichment.spec.ts` tests GREEN
- Bonus: `ipc/index.spec.ts` handler count test now passes (WHATSAPP_GENERATE_DIGEST_NOW was added to CHANNELS in 21-01 but had no handler until this plan)

## Task Commits

1. **Task 1 + Task 2: readWhatsAppDigests + BRIEFING_TODAY enrichment + WHATSAPP_GENERATE_DIGEST_NOW handler** - `03f5436` (feat)

## Files Created/Modified

- `src/main/ipc/briefing.ts` — Added: `import type Database`, `import type BriefingPayload/WhatsAppGroupSummaryDto`, `import type WhatsAppDigestHandle`, `type Db`, `digestHandle?` field in deps, `readWhatsAppDigests` function, enrichment block in BRIEFING_TODAY, WHATSAPP_GENERATE_DIGEST_NOW handler

## Decisions Made

- `readWhatsAppDigests` is module-local (not imported from a separate file) per D-13 — the plan explicitly specifies this annotation and pattern to keep the no-frontier ratchet boundary crisp. Cross-module import would require a new file under `src/main/whatsapp/` which would be scanned by the ratchet; module-local keeps briefing.ts self-contained for read-path enrichment.
- `digestHandle` injected via `BriefingHandlerDeps.digestHandle?: WhatsAppDigestHandle | null` (not module scope) — test isolation: all 6 `briefing-whatsapp-enrichment.spec.ts` tests pass without passing `digestHandle`, making the optional injection backward-compatible.
- The outer enrichment try/catch catches and logs `scope: 'briefing-today-whatsapp'` without re-throwing — ensures BRIEFING_TODAY always resolves even under DB failure or null pointer in the enrichment path (WA-10/D-07.3 invariant).

## Deviations from Plan

None — plan executed exactly as written. Both tasks landed as documented:
- `readWhatsAppDigests` implements all 7 steps of D-10 state matrix
- Enrichment block placed after `thisWeekInsights` block, before `return row`
- `WHATSAPP_GENERATE_DIGEST_NOW` handler returns `{ok:true}` fire-and-forget
- All 6 spec tests GREEN; TypeScript 0 errors

## Verification Results

- `npx vitest run tests/unit/main/ipc/briefing-whatsapp-enrichment.spec.ts` → **PASS** (6/6 GREEN)
- `npx vitest run tests/unit/main/ipc/index.spec.ts` → **PASS** (4/4 GREEN — bonus fix)
- `npx tsc --noEmit` → **PASS** (0 errors)
- `grep -c "readWhatsAppDigests" src/main/ipc/briefing.ts` → 5 (definition + call + comment occurrences)
- `grep -c "read-only, no model" src/main/ipc/briefing.ts` → 2 (JSDoc + inline comment)
- `grep -c "row\.whatsApp" src/main/ipc/briefing.ts` → 2 (assignment + reference in D-07.3 guard)
- `grep -c "briefing-today-whatsapp" src/main/ipc/briefing.ts` → 1 (error scope string)
- `grep -c "WHATSAPP_GENERATE_DIGEST_NOW" src/main/ipc/briefing.ts` → 2 (import channel use + handler registration)

## Known Stubs

None — `readWhatsAppDigests` is a complete implementation reading live DB rows. The only deferred wiring is in `src/main/index.ts` (Plan 21-06 will pass `_digestHandle` to `registerBriefingHandlers` deps, enabling the D-07.3 fire-and-forget fallback). Until 21-06 wires the handle, the fallback is silently skipped (deps.digestHandle is undefined), which is safe.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: information-disclosure | src/main/ipc/briefing.ts | readWhatsAppDigests reads whatsapp_group_digest.summary_text (local-model output) and routes it into the IPC payload to renderer. Mitigated by T-21-08: data stays local (SQLCipher); D-11 ensures this enrichment is post-frontier so WA text never enters the frontier prompt. |

---
*Phase: 21-digest-briefing-integration*
*Completed: 2026-06-10*
