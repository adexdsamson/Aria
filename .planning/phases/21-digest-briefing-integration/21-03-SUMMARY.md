---
phase: 21-digest-briefing-integration
plan: 03
subsystem: whatsapp
tags: [whatsapp, digest, cron, local-model, tdd, no-frontier-ratchet]

# Dependency graph
requires:
  - phase: 21-01
    provides: CatchupChannel 'whatsapp-digest', BriefingPayload.whatsApp discriminated union
  - phase: 21-02
    provides: digest-cron.spec.ts RED stubs (5 failing tests to turn GREEN)
provides:
  - startWhatsAppDigest factory function with per-group local-model loop
  - WhatsAppDigestDeps + WhatsAppDigestHandle interfaces
  - 05:00 cron at 'whatsapp-digest' CRON_KEY in cronRegistry
  - seal-guard + pendingCatchup.add('whatsapp-digest') on DB-sealed tick
affects:
  - 21-04 (generate-now IPC uses WhatsAppDigestHandle.runNow())
  - 21-06 (bootPoll + runChannelOnce drain use startWhatsAppDigest + _digestHandle)
  - tests/unit/main/whatsapp/no-frontier.ratchet.spec.ts (stays GREEN by construction)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - retention.ts seal-guard mirror: cron callback + runNow() both check dbHolder
    - p-queue CJS/ESM normalization: ((PQueueImport as any).default ?? PQueueImport) pattern from aggregate.ts
    - try/catch wraps await generateText(), NOT getLocalModel() — Ollama errors fire at call time
    - INSERT OR REPLACE for idempotent retry of NULL rows (not INSERT OR IGNORE)
    - ISO string comparisons for sent_at throughout (Pitfall 4 avoidance)
    - CTE-based window math: WITH last_digest AS (MAX watermark) for D-04/D-05

key-files:
  created:
    - src/main/whatsapp/digest-cron.ts
  modified: []

key-decisions:
  - "runNow() also applies seal-guard (dbHolder && !db → pendingCatchup.add) — matches the test spec expectation for D-07.1 which calls runNow() not a scheduled tick"
  - "p-queue with concurrency:1 per runDigest call (not a shared queue) — mirrors aggregate.ts private-queue pattern; isolation simplifies test predictability"
  - "DIGEST_SYSTEM_PROMPT is a module-level constant (not built per-call) — temperature:0 + fixed prompt ensures deterministic output at 8B scale"
  - "userDisplayName and meJidLocalPart default to empty string — graceful degradation for heuristic MENTIONS when profile/creds unavailable (D-03)"

patterns-established:
  - "WhatsApp cron files mirror retention.ts: same imports, same seal-guard block, same stop/runNow shape"
  - "runNow() seal-guard: when dbHolder is non-null and db is null, add to pendingCatchup and return Promise.resolve() without running the digest"

requirements-completed:
  - WA-08
  - WA-09
  - WA-10

# Metrics
duration: 18min
completed: 2026-06-10
---

# Phase 21 Plan 03: Digest Cron Implementation (GREEN) Summary

**05:00 per-group WhatsApp digest cron implemented as startWhatsAppDigest — all 5 digest-cron.spec.ts RED stubs turned GREEN, SC3 no-frontier ratchet stays GREEN, zero TypeScript errors**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-06-10T13:00:00Z
- **Completed:** 2026-06-10T13:18:00Z
- **Tasks:** 1
- **Files created:** 1

## Accomplishments

- Created `src/main/whatsapp/digest-cron.ts` (302 lines) implementing `startWhatsAppDigest` with:
  - Seal-guard mirroring `retention.ts` — cron callback AND `runNow()` both check `dbHolder.db===null` → `pendingCatchup.add('whatsapp-digest')` (D-07.1)
  - Per-group `p-queue concurrency:1` loop — partial failure preserves good summaries (D-09)
  - CTE-based ISO window query: `WITH last_digest AS (MAX watermark)` respecting D-04/D-05
  - `try/catch` wraps `await gen()` NOT `getLocalModel()` — correct Ollama-down error site (Pitfall 2)
  - `INSERT OR REPLACE` idempotency — retries overwrite NULL rows from prior failed runs (D-06/Pitfall 3)
  - ISO string comparisons throughout — no Unix integer mixing (Pitfall 4)
  - `MIN_ACTIVITY=3` threshold — groups with fewer messages are skipped without a DB write (D-10)
  - `WINDOW_DAYS=3` rolling window + `MAX_MESSAGES=150` token budget cap
  - LLM test seams: `generateTextFn` and `getLocalModelFn` injectable deps (mirrors `ask.ts` pattern)
- All 5 `digest-cron.spec.ts` tests pass (WA-08/WA-10/D-06/D-07.1/D-09)
- SC3 no-frontier ratchet: 4/4 tests still GREEN — no frontier imports in `src/main/whatsapp/`
- TypeScript: 0 errors (`npx tsc --noEmit`)

## Task Commits

1. **Task 1: Implement digest-cron.ts — full startWhatsAppDigest factory** - `6844ea6` (feat)

## Files Created/Modified

- `src/main/whatsapp/digest-cron.ts` — NEW: 302 lines; exports `startWhatsAppDigest`, `WhatsAppDigestDeps`, `WhatsAppDigestHandle`

## Decisions Made

- `runNow()` applies the seal-guard (not just the cron callback) because the test for D-07.1 creates a handle with `dbHolder.db=null` and calls `runNow()` directly — the implementation must add to `pendingCatchup` in both execution paths
- Private `p-queue` instance per `runDigest()` call (not a shared scheduler queue) — matches `aggregate.ts` precedent and keeps test isolation clean
- `DIGEST_SYSTEM_PROMPT` as a module-level constant with `temperature:0` — ensures deterministic structured output from Llama 3.1 8B / Qwen 2.5 7B at the fixed headers

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria satisfied:
- 5/5 `digest-cron.spec.ts` tests pass
- SC3 no-frontier ratchet 4/4 GREEN (ratchet uses `stripComments()` so the JSDoc mention of `getFrontierModel` in a comment is correctly excluded)
- `INSERT OR REPLACE` present (5 occurrences: 2 in success path, 2 in catch path, 1 in SQL string)
- `0 5 * * *` present (4 occurrences: constant + comment + factory)
- `pendingCatchup.add` present (2 occurrences: cron callback + runNow seal-guard)
- `getLocalModel` present (7 occurrences: import + comment + use)
- `npx tsc --noEmit` exits 0

## Verification Results

- `npx vitest run tests/unit/main/whatsapp/digest-cron.spec.ts` → **PASS** (5/5 GREEN)
- `npx vitest run tests/unit/main/whatsapp/no-frontier.ratchet.spec.ts` → **PASS** (4/4 GREEN)
- `npx tsc --noEmit` → **PASS** (0 errors)

## Known Stubs

None — `digest-cron.ts` is a complete implementation. The only deferred wiring is in `src/main/index.ts` (Plan 21-06 will add the `startWhatsAppDigest` bootstrap call and `runChannelOnce` switch).

## Threat Flags

No new network endpoints or auth paths introduced. `digest-cron.ts` uses `getLocalModel()` (localhost Ollama) exclusively — no new trust boundary surface. T-21-06 (information disclosure) is mitigated by construction: SC3 ratchet is GREEN.

## Next Phase Readiness

- Plan 21-04 (generate-now IPC): can import `WhatsAppDigestHandle` from `digest-cron.ts`; `runNow()` is available for the handler
- Plan 21-06 (index.ts bootstrap): `startWhatsAppDigest` export ready for `bootPoll` wiring + `runChannelOnce` switch
- Plan 21-04 (briefing enrichment): unrelated to this plan; proceeds in parallel

---
*Phase: 21-digest-briefing-integration*
*Completed: 2026-06-10*
