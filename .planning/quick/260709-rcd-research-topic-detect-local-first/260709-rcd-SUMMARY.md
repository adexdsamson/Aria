---
task: 260709-rcd
title: Research topic auto-detect — local-first with logged frontier fallback
type: quick
requirements: [RES-04]
status: complete
completed: 2026-07-09
key-files:
  modified:
    - src/main/services/ResearchService.ts
    - src/main/ipc/transcripts.ts
    - tests/unit/main/research-service.spec.ts
commits:
  - e89d27e
  - a8d3b82
---

# Quick Task 260709-rcd: Research Topic Auto-Detect Local-First Summary

Restructured `detectResearchTopics` (Path 2, RES-04) so raw meeting transcripts are
processed on the LOCAL Ollama model first, with the frontier provider reached only as an
explicit, logged fallback when local is unavailable — closing the privacy leak where any
configured frontier key sent transcripts straight to the cloud.

## What Changed

### Task 1 — Local-first routing (`e89d27e`)

`src/main/services/ResearchService.ts`:
- Added `getLocalModel` to the existing `'../llm/providers'` import.
- Added optional trailing `logger?: Pick<Logger, 'warn'>` param to `detectResearchTopics`.
- Removed the early `getActiveProvider()`/`hasFrontierKey()` gate that ran before the prompt.
- Build the transcript prompt ONCE, then attempt generation LOCAL-FIRST via `getLocalModel()`.
- On local failure (inner catch), resolve the active provider + frontier key. If none
  configured → silent `return` (no drafts, no `BRIEFING_TODAY` notification). If configured
  → emit `logger?.warn(... 'transcript leaves device')` disclosure, THEN call
  `getFrontierModel()` and generate.
- Downstream draft-insert loop and `emitToRenderer(BRIEFING_TODAY, ...)` now read from a
  shared `topics` holder — unchanged behavior once topics exist.
- `runResearchJob` (Path 1) left completely untouched — stays frontier-only.

`src/main/ipc/transcripts.ts`:
- Fire-and-forget call now passes the already-destructured `logger` as the 5th arg so the
  fallback disclosure is actually recorded.

### Task 2 — Spec kept honest (`a8d3b82`)

`tests/unit/main/research-service.spec.ts`:
- Added `getLocalModel: vi.fn()` to the providers `vi.mock` factory + post-mock import.
- Default `getLocalModel` success in `beforeEach` (local succeeds by default).
- Happy-path test now asserts `getLocalModel` was called and `getFrontierModel` was NOT.
- Silent-failure test now fails BOTH local (throws) and frontier (`generateObject` rejects)
  to prove true silent no-op.
- New regression test: `'falls back to frontier only when local is unavailable and frontier
  is configured'` — local throws, frontier configured, asserts `getFrontierModel` called and
  a draft row inserted. Imported `Logger` type from `'pino'`.

## Verification

- **Typecheck (verify bar):** `npx tsc --noEmit` errors attributable to `ResearchService.ts`
  and `ipc/transcripts.ts` — **0 before, 0 after**. No regression against the repo's ~84
  pre-existing errors in other files.
- **Spec:** `npx vitest run tests/unit/main/research-service.spec.ts` → **Test Files 1 passed,
  Tests 10 passed**. Ran the single spec only (avoids the parallel-projects config race).

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- Files exist: ResearchService.ts, transcripts.ts, research-service.spec.ts — all FOUND.
- Commits exist: e89d27e, a8d3b82 — both FOUND.
