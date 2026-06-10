---
phase: 21-digest-briefing-integration
plan: 05
subsystem: ui
tags: [whatsapp, briefing, react, typescript, tdd, renderer]

# Dependency graph
requires:
  - phase: 21-01
    provides: BriefingPayload.whatsApp discriminated union, WhatsAppGroupSummaryDto, whatsappGenerateDigestNow AriaApi method
  - phase: 21-02
    provides: BriefingScreen.spec.tsx Phase 21 cases (2 RED stubs to turn GREEN)
provides:
  - WhatsApp section render switch in BriefingScreen.tsx (ready/unavailable/undefined states)
  - parseDigestSections() module-local helper (splits on fixed ### headers, partial-parse tolerant)
  - DigestGenerateNowAffordance inline component (calls whatsappGenerateDigestNow, NOT briefingGenerateNow)
  - Exact D-10 degraded copy: 'Digest unavailable — the local model was offline this morning. Aria will retry tonight.'
  - Per-group sub-sections: summarized shows parsed sections, failed shows group-level degraded note, no-activity returns null
affects:
  - 21-06 (final plan — bootstrap wiring complete with renderer section now live)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - WhatsApp section as pure JSX switch over BriefingPayload.whatsApp discriminated union (mirrors thisWeekInsights pattern exactly)
    - Module-local parseDigestSections() helper: iterate lines, track current section header, accumulate content, return trimmed strings
    - DigestGenerateNowAffordance: useState(busy)+useState(error) + different IPC than GenerateNowAffordance (critical separation)
    - T-21-11 mitigated: summaryText rendered as plain text node (whiteSpace:pre-wrap), never dangerouslySetInnerHTML

key-files:
  created: []
  modified:
    - src/renderer/features/briefing/BriefingScreen.tsx

key-decisions:
  - "whatsappGenerateDigestNow (lowercase 'a') not whatsAppGenerateDigestNow — AriaApi uses camelCase matching CHANNEL_METHODS mapping; auto-fixed Rule 1 (TS2551 compile error)"
  - "DigestGenerateNowAffordance is inline in BriefingScreen.tsx (not extracted to sibling file) — file length is 940 lines, acceptable; extraction would require a new file not warranted for a small component"
  - "Connection degraded/needs-auth renders separate p elements (not combined string) to keep JSX readable and future-localizable"

patterns-established:
  - "WhatsApp section uses optional chaining (?.) on payload.whatsApp for null safety — renders nothing when undefined without any explicit guard"
  - "Per-group map: no-activity returns null (omit), failed returns degraded note, summarized runs parseDigestSections"

requirements-completed:
  - WA-08
  - WA-10

# Metrics
duration: 15min
completed: 2026-06-10
---

# Phase 21 Plan 05: WhatsApp Digest Renderer Section Summary

**WhatsApp briefing section render switch added to BriefingScreen.tsx — dumb discriminated-union switch that turns 2 RED Phase 21 test cases GREEN, with exact D-10 degraded copy and whatsappGenerateDigestNow retry affordance**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-10T13:20:00Z
- **Completed:** 2026-06-10T13:35:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Added `parseDigestSections(text)` module-local helper in BriefingScreen.tsx that splits on `### KEY POINTS`, `### DECISIONS`, `### OPEN QUESTIONS`, `### MENTIONS` headers; partial-parse tolerant (missing sections return empty string)
- Added `DigestGenerateNowAffordance` inline component that calls `window.aria.whatsappGenerateDigestNow()` (not `briefingGenerateNow`) with busy/error state, and shows quiet connection degraded/needs-auth notes
- Inserted JSX render switch after the `thisWeekInsights` blocks: `unavailable` renders `data-testid='briefing-whatsapp-unavailable'` with exact D-10 copy + retry button; `ready` renders `data-testid='briefing-whatsapp'` with per-group sub-sections; `undefined` produces no DOM output
- All 15 BriefingScreen.spec.tsx tests pass (3 new Phase 21 WhatsApp union-state cases GREEN + 12 pre-existing cases still GREEN)
- TypeScript compiles clean (0 errors) — `npx tsc --noEmit` exits 0

## Task Commits

1. **Task 1: Add WhatsApp section render switch to BriefingScreen.tsx** - `6edee93` (feat)

## Files Created/Modified

- `src/renderer/features/briefing/BriefingScreen.tsx` — Added `parseDigestSections()` helper, `DigestGenerateNowAffordance` component, and JSX switch block after the `thisWeekInsights` blocks (235 lines inserted)

## Decisions Made

- `whatsappGenerateDigestNow` (not `whatsAppGenerateDigestNow`) — the AriaApi interface uses camelCase matching the CHANNEL_METHODS mapping; a TypeScript TS2551 compile error caught the initial casing mistake (Rule 1 auto-fix)
- `DigestGenerateNowAffordance` stays inline in BriefingScreen.tsx — the file is 940 lines (expanded to ~1100 after insertion), which is acceptable for an editorial screen; extracting a 40-line component to a sibling file would add unnecessary indirection
- No `data-aria-cascade` attribute on the WhatsApp sections — the plan's JSX pattern omits it (unlike thisWeekInsights which also omits it); calendar/email/news use it via `SectionWithChips`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed AriaApi method name casing (whatsAppGenerateDigestNow → whatsappGenerateDigestNow)**
- **Found during:** Task 1 (acceptance criteria TypeScript check)
- **Issue:** Initial implementation used `window.aria.whatsAppGenerateDigestNow()` (capital 'A' in App) but AriaApi declares `whatsappGenerateDigestNow` (lowercase matching camelCase CHANNEL_METHODS convention)
- **Fix:** Renamed the call site and the JSDoc comment
- **Files modified:** `src/renderer/features/briefing/BriefingScreen.tsx`
- **Verification:** `npx tsc --noEmit` exits 0
- **Committed in:** `6edee93` (included in task commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - casing bug)
**Impact on plan:** Single-character fix for TypeScript correctness. No scope creep.

## Threat Surface Scan

T-21-11 mitigated as required: `summaryText` is rendered as a plain React text node with `whiteSpace: 'pre-wrap'`, never via `dangerouslySetInnerHTML`. React escapes HTML entities in text nodes by default — XSS via LLM-generated summaryText is prevented by construction.

No new threat surface introduced beyond what was planned.

## Issues Encountered

None — the only issue was the casing mismatch (documented above as Rule 1 auto-fix).

## Self-Check

- [x] `src/renderer/features/briefing/BriefingScreen.tsx` exists and modified
- [x] `git log --oneline | grep 6edee93` — commit found
- [x] 15/15 BriefingScreen.spec.tsx tests pass
- [x] `npx tsc --noEmit` exits 0
- [x] `grep -c "briefing-whatsapp"` → 3 (unavailable + ready testids + comment)
- [x] `grep -c "whatsappGenerateDigestNow"` → 2 (call site + comment)
- [x] `grep "local model was offline"` → present (exact D-10 copy)

## Self-Check: PASSED

## Known Stubs

None — the WhatsApp section is fully wired to the `BriefingPayload.whatsApp` union delivered by Plan 21-04's briefing enrichment. The test cases use real (non-stub) data shapes.

## Next Phase Readiness

- Plan 21-06 (bootstrap wiring): all renderer infrastructure is now in place; the final plan can focus purely on main-process wiring (index.ts digest cron bootstrap + runChannelOnce switch branch)
- WA-08 (WhatsApp digest in morning briefing) and WA-10 (degraded state + retry) are satisfied by this plan's renderer output combined with Plans 21-03/04's backend

---
*Phase: 21-digest-briefing-integration*
*Completed: 2026-06-10*
