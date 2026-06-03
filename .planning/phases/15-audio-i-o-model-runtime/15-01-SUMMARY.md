---
phase: 15-audio-i-o-model-runtime
plan: "01"
subsystem: voice-contracts
tags: [voice, ipc, csp, kv-prefs, static-ratchet, tdd]
dependency_graph:
  requires: []
  provides:
    - src/shared/voice-types.ts (VoiceState/TranscriptDelta/VoiceModelStatus DTOs)
    - src/shared/ipc-contract.ts (7 VOICE_* channels + AriaApi members)
    - src/preload/index.ts (3 push subscription overrides)
    - src/main/voice/prefs.ts (model-readiness KV persistence)
    - tests/static/csp-allows-blob.spec.ts (CSP blob: guard)
    - tests/static/voice-audio-no-cloud.spec.ts (VOICE-04 ratchet)
  affects:
    - src/main/index.ts (script-src blob: added to both CSP builders)
    - All downstream Phase 15 plans (import voice-types.ts contract)
tech_stack:
  added: []
  patterns:
    - settings(k,v) KV namespaced-key persistence (voice. prefix, mirror of background/prefs.ts)
    - ipcRenderer.on push subscription override in preload (mirror onNavigate pattern)
    - static ratchet walk/stripComments/missing-dir-guard (mirror voice-routes-through-staging.spec.ts)
key_files:
  created:
    - src/shared/voice-types.ts
    - src/main/voice/prefs.ts
    - src/main/voice/prefs.spec.ts
    - tests/static/csp-allows-blob.spec.ts
    - tests/static/voice-audio-no-cloud.spec.ts
  modified:
    - src/shared/ipc-contract.ts
    - src/preload/index.ts
    - src/main/index.ts
decisions:
  - "D-08 correction: model-readiness persists via settings(k,v) with voice. prefix — NOT user_prefs migration (table does not exist)"
  - "D-17: VoiceState union includes 'speaking' so Phase 16 streaming drops in without redesign"
  - "D-19 enabler: blob: added to script-src in both prodCspHeader and devCspHeader; connect-src unchanged"
  - "TDD for prefs.ts: RED commit (323e844) then GREEN commit (ccdbba4)"
  - "TDD for CSP: RED commit (7cea31b) then GREEN commit (9ac190c)"
metrics:
  duration: "~25 minutes"
  completed: "2026-06-03"
  tasks_completed: 3
  tasks_total: 3
  files_created: 5
  files_modified: 3
---

# Phase 15 Plan 01: Wave-0 Voice Contract Foundation Summary

VoiceState/TranscriptDelta/VoiceModelStatus DTOs, 7 VOICE_* IPC channels, model-readiness KV prefs via settings table, CSP blob: fix for AudioWorklet, and VOICE-04 no-cloud static ratchet — the full Wave-0 contract layer every downstream plan imports.

## Tasks Completed

| # | Task | Commit | Type |
|---|------|--------|------|
| 1 | Voice DTO contract + IPC channels + preload subscriptions | d7be09c | feat |
| 2 | Model-readiness KV prefs (TDD RED) | 323e844 | test |
| 2 | Model-readiness KV prefs (TDD GREEN) | ccdbba4 | feat |
| 3 | CSP blob: fix + static ratchets (TDD RED) | 7cea31b | test |
| 3 | CSP blob: fix + static ratchets (TDD GREEN) | 9ac190c | feat |

## Verification

- `npx tsc --noEmit` exits 0 (pre-existing 83-error baseline in tsconfig.node.json unaffected by this plan)
- `pnpm vitest run src/main/voice/prefs.spec.ts tests/static/csp-allows-blob.spec.ts tests/static/voice-audio-no-cloud.spec.ts` — 12/12 pass
- No migration file ≥ 136 created (latest stays 135 per correction 1)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test regex for devCspHeader extracted body incorrectly**
- **Found during:** Task 3 GREEN phase
- **Issue:** The initial regex `function devCspHeader\(\)[^{]*\{([\s\S]*?)^\}/m` failed to extract the function body correctly across multiline content with inline comments. The connect-src test also falsely triggered on comment text mentioning "blob:".
- **Fix:** Rewrote `csp-allows-blob.spec.ts` to use whole-file regex matching (`prodCspHeader[\s\S]{0,500}?script-src[\s\S]{0,200}?blob:`) and to search for string literals containing `connect-src` after comment stripping.
- **Files modified:** `tests/static/csp-allows-blob.spec.ts`
- **Commit:** 9ac190c (same GREEN commit)

## Success Criteria Check

- [x] VoiceState union (with 'speaking', D-17), the 7 VOICE_* channels, and preload push helpers exist and typecheck
- [x] Model-readiness persists via settings(k,v) (D-08) with db-null tolerance — no user_prefs migration (correction 1)
- [x] prod+dev CSP script-src allow blob: (correction 2); connect-src unchanged
- [x] VOICE-04 no-cloud ratchet green

## Known Stubs

None — this plan delivers pure contract/infrastructure (DTOs, channels, prefs, guards). No UI rendering, no data sources, no stubs.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| T-15-01 resolved | src/main/index.ts | blob: added ONLY to script-src; connect-src unchanged (verified by csp-allows-blob.spec.ts) |
| T-15-02 resolved | tests/static/voice-audio-no-cloud.spec.ts | VOICE-04 ratchet enforces no cloud audio endpoint references by construction |
| T-15-03 accept | src/main/voice/prefs.ts | KV pref in SQLCipher-encrypted settings table; no external write path; low-value flag |

## Self-Check: PASSED

- [x] src/shared/voice-types.ts exists and contains 'speaking'
- [x] src/main/voice/prefs.ts exists and contains `INSERT INTO settings` and `ON CONFLICT(k)`
- [x] src/main/voice/prefs.spec.ts exists with 6 tests
- [x] tests/static/csp-allows-blob.spec.ts exists (4 tests green)
- [x] tests/static/voice-audio-no-cloud.spec.ts exists (2 tests green)
- [x] No src/main/db/migrations/136_*.sql exists
- [x] Commits d7be09c, 323e844, ccdbba4, 7cea31b, 9ac190c all exist in git log
