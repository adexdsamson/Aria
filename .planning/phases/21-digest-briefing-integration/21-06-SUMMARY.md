---
phase: 21-digest-briefing-integration
plan: 06
subsystem: whatsapp
tags: [whatsapp, digest, cron, lifecycle, bootstrap, powerMonitor, ipc]

# Dependency graph
requires:
  - phase: 21-03
    provides: startWhatsAppDigest factory, WhatsAppDigestHandle interface, digest-cron.ts
  - phase: 21-04
    provides: BriefingHandlerDeps.digestHandle seam, WHATSAPP_GENERATE_DIGEST_NOW handler in briefing.ts
  - phase: 21-01
    provides: CatchupChannel 'whatsapp-digest' union member for unlock drain dispatch
provides:
  - _digestHandle module-scope variable in index.ts (live post-unlock)
  - startWhatsAppDigest bootstrap call in bootPoll (WA-08)
  - runChannelOnce real 'whatsapp-digest' switch case replacing no-op stub (D-07.1)
  - powerMonitor onResume missed-tick guard: MAX(date) < today → runNow() (D-07.2)
  - getDigestHandle late-binding getter in IpcDeps wired to registerBriefingHandlers (D-07.3/D-11)
  - getDigestHandle getter in BriefingHandlerDeps for production-path late binding
affects:
  - Phase 21 runtime: all three WA-08/WA-09/WA-10 requirements now fully wired
  - pendingCatchup drain: runChannelOnce now dispatches 'whatsapp-digest' to real handle

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Late-binding getter pattern: getDigestHandle/getWhatsAppManager in IpcDeps — used when handler registration (pre-unlock) precedes the resource it needs (post-unlock)
    - powerMonitor onResume missed-tick pattern: MAX(date) query + runNow() on date mismatch
    - runChannelOnce switch dispatch: default case keeps no-op; each channel adds a real case

key-files:
  created: []
  modified:
    - src/main/index.ts
    - src/main/ipc/briefing.ts
    - src/main/ipc/index.ts

key-decisions:
  - "getDigestHandle getter (not direct digestHandle value) passed through IpcDeps — registerBriefingHandlers is called pre-unlock when _digestHandle is null; getter returns live instance at handler-fire time"
  - "briefing.ts updated to resolve deps.getDigestHandle?.() ?? deps.digestHandle — backward-compatible: existing tests that pass digestHandle directly continue to work; production uses getter"
  - "powerMonitor onResume hook registered in bootPoll INSIDE the WhatsApp block (after _digestHandle assigned) — not a separate top-level call; mirrors the existing voice lifecycle registration pattern"
  - "runChannelOnce default case retains await Promise.resolve() — conservative single-shot semantics for non-WhatsApp channels (Phase 12 Plan 12-02 rationale unchanged)"

patterns-established:
  - "Late-binding getter pattern: when a resource is created post-unlock but its consumer (IPC handler) is registered pre-unlock, pass getX: () => X rather than X directly"
  - "powerMonitor onResume digest guard: register inside bootPoll WhatsApp block so _digestHandle is guaranteed non-null by construction"

requirements-completed:
  - WA-08
  - WA-09
  - WA-10

# Metrics
duration: 10min
completed: 2026-06-10
---

# Phase 21 Plan 06: Bootstrap Wiring — Final Integration Summary

**_digestHandle module-scope variable + startWhatsAppDigest bootPoll call + runChannelOnce real dispatch + powerMonitor onResume missed-tick guard + getDigestHandle late-binding getter — all Phase 21 components now wired into a running system**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-10T12:40:00Z
- **Completed:** 2026-06-10T12:51:35Z
- **Tasks:** 2 (committed as one atomic change)
- **Files modified:** 3

## Accomplishments

- Wired `startWhatsAppDigest` into the bootPoll block in `src/main/index.ts` immediately after `startWhatsAppRetention` — the 05:00 digest cron now starts at app boot (WA-08)
- Replaced the `runChannelOnce` no-op stub (`await Promise.resolve()`) with a real switch: `'whatsapp-digest'` case calls `_digestHandle.runNow()` — the unlock drain now dispatches the digest when the app was sealed during the 05:00 window (D-07.1 load-bearing fix)
- Registered `registerLifecycleCallbacks({ onResume })` with a `MAX(date) < today` guard that fires `runNow()` after sleep — covers the missed-05:00 case when the device was asleep (D-07.2)
- Wired `getDigestHandle: () => _digestHandle` getter through `IpcDeps` → `registerBriefingHandlers` deps — the `BRIEFING_TODAY` D-07.3 fallback and `WHATSAPP_GENERATE_DIGEST_NOW` handler now receive the live handle at handler-fire time (D-11/D-07.3)
- Extended `BriefingHandlerDeps` with optional `getDigestHandle?` getter field — handlers resolve `getDigestHandle?.() ?? digestHandle` for backward compatibility with tests

## Task Commits

1. **Task 1 + Task 2: Bootstrap wiring + onResume missed-tick hook** - `0a18759` (feat)

## Files Created/Modified

- `src/main/index.ts` — Added import `startWhatsAppDigest + WhatsAppDigestHandle`; declared `let _digestHandle: WhatsAppDigestHandle | null = null` (module-scope); added `_digestHandle = startWhatsAppDigest({...})` in bootPoll; added `registerLifecycleCallbacks({ onResume })` for D-07.2; replaced `runChannelOnce` stub with switch; passed `getDigestHandle: () => _digestHandle` to `registerHandlers`
- `src/main/ipc/briefing.ts` — Added `getDigestHandle?` field to `BriefingHandlerDeps`; updated D-07.3 fallback and `WHATSAPP_GENERATE_DIGEST_NOW` handler to resolve handle via `getDigestHandle?.() ?? digestHandle`
- `src/main/ipc/index.ts` — Added `getDigestHandle?` field to `IpcDeps`; threaded it to `registerBriefingHandlers` call

## Decisions Made

- **getDigestHandle getter pattern** instead of passing the handle directly: `registerBriefingHandlers` is called inside `registerHandlers` which runs pre-unlock (line 389 of index.ts), before `_digestHandle` is initialized in bootPoll. Passing a direct value would always be `null`. The getter pattern (already established by `getWhatsAppManager`) ensures handlers access the live instance at fire-time.
- **briefing.ts backward-compatible getter** (`getDigestHandle?.() ?? digestHandle`): existing tests pass `digestHandle` directly and do not need updating. Production wiring uses the getter.
- **powerMonitor hook registered inside WhatsApp bootPoll block**: natural placement after `_digestHandle = startWhatsAppDigest(...)` — the hook is only relevant when WhatsApp is wired, and `_digestHandle` is guaranteed non-null by the surrounding `if (waDb)` block.
- **runChannelOnce `default:` retains `await Promise.resolve()`**: no-op semantics for non-WhatsApp channels preserved per Phase 12 Plan 12-02 decision.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `registerBriefingHandlers` call is in `ipc/index.ts`, not `index.ts`**
- **Found during:** Task 1 (pre-edit read of index.ts)
- **Issue:** Plan stated "find the registerBriefingHandlers call in index.ts (bootPoll block)" — actual call is in `src/main/ipc/index.ts` line 285, called pre-unlock from `registerHandlers`. Passing `digestHandle: _digestHandle` directly would always capture `null`.
- **Fix:** Used the late-binding getter pattern (already established by `getWhatsAppManager`): added `getDigestHandle?` to both `IpcDeps` and `BriefingHandlerDeps`, updated briefing.ts handlers to resolve via `getDigestHandle?.() ?? digestHandle`. No handler re-registration needed.
- **Files modified:** `src/main/ipc/briefing.ts`, `src/main/ipc/index.ts`, `src/main/index.ts`
- **Verification:** `npx tsc --noEmit` exits 0; all Phase 21 specs GREEN when run individually
- **Committed in:** `0a18759`

---

**Total deviations:** 1 auto-fixed (Rule 1 — wiring architecture mismatch)
**Impact on plan:** Fix is fully equivalent to plan intent. The getter achieves the D-11/D-07.3 wiring goal. No scope creep.

## Verification Results

- `npx tsc --noEmit` → **PASS** (0 errors)
- `npx vitest run tests/unit/main/whatsapp/digest-cron.spec.ts` → **PASS** (5/5)
- `npx vitest run tests/unit/main/ipc/briefing-whatsapp-enrichment.spec.ts` → **PASS** (6/6)
- `npx vitest run tests/unit/main/whatsapp/no-frontier.ratchet.spec.ts` → **PASS** (4/4) — SC3 ratchet GREEN
- `npx vitest run tests/unit/main/whatsapp/` → **PASS** (91/91)
- `npx vitest run tests/unit/renderer/features/briefing/` → **PASS** (15/15)
- Combined run `whatsapp/ + briefing-whatsapp-enrichment + renderer/features/briefing/` → 110/112 (2 pre-existing SQLite UNIQUE isolation failures when run together — same failures existed pre-this-plan; all 6 briefing-whatsapp-enrichment tests pass when run alone)
- `grep -c "startWhatsAppDigest" src/main/index.ts` → 3 (import line, comment, call)
- `grep -c "_digestHandle" src/main/index.ts` → 7 (declaration, assignment, 5 uses)
- `grep -c "whatsapp-digest" src/main/index.ts` → 2 (switch case, CRON_KEY comment)
- `grep -c "onResume" src/main/index.ts` → 5 (voice lifecycle + new digest hook + inner uses)
- `grep -c "maxDate" src/main/index.ts` → 3 (SELECT, .get() cast, comparison)

## Known Stubs

None — `_digestHandle` is a live `WhatsAppDigestHandle` instance post-bootPoll. The `if (!_digestHandle)` guards in `runChannelOnce` and the `onResume` hook are correct pre-unlock safety checks, not stubs.

## Phase 21 Complete

All 6 plans of Phase 21 (Digest + Briefing Integration) are now complete:
- **21-01**: Shared type contracts + CatchupChannel 'whatsapp-digest' (`816a2f7` / `01fb1f5`)
- **21-02**: Nyquist RED stubs (5 digest-cron + 6 briefing-enrichment + 3 BriefingScreen)
- **21-03**: digest-cron.ts implementation — startWhatsAppDigest + seal-guard + p-queue (`6844ea6`)
- **21-04**: briefing.ts read-path + WHATSAPP_GENERATE_DIGEST_NOW handler (`03f5436`)
- **21-05**: BriefingScreen.tsx WhatsApp section renderer + DigestGenerateNowAffordance
- **21-06**: Bootstrap wiring — all components connected into a running system (`0a18759`)

WA-08 (digest cron at 05:00), WA-09 (SC3 no-frontier ratchet), WA-10 (graceful Ollama-offline degradation) are fully satisfied.

---
*Phase: 21-digest-briefing-integration*
*Completed: 2026-06-10*
