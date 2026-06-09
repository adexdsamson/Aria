---
phase: 20-foundation
plan: "02"
subsystem: whatsapp-foundation
tags: [whatsapp, test-scaffolds, static-ratchets, nyquist, privacy, tdd]
dependency_graph:
  requires:
    - "20-01 (WHATSAPP_* channel constants + Zod DTOs in ipc-contract.ts)"
    - "Plan 20-01 ipc/index.ts pre-unlock stubs for 165/165 handler-count"
  provides:
    - "passive-posture.ratchet.spec.ts — WA-11 send-ban (gates 1/2), GREEN immediately, load-bearing once src/main/whatsapp/ exists"
    - "no-frontier.ratchet.spec.ts — frontier-import ban (gate 3), GREEN immediately"
    - "ingest-privacy.spec.ts — CRITICAL WA-06/gates 7/8/9 privacy assertions before any ingest code"
    - "auth-state.spec.ts — gate 4 transaction atomicity target (Plan 20-03)"
    - "session-reconnect.spec.ts — gate 5 DisconnectReason classification target (Plan 20-04)"
    - "session-recycle.spec.ts — gate 6 recycle cron + cronRegistry target (Plan 20-04)"
    - "whatsapp-retention.spec.ts — WA-07 extractText + 30d sweep target (Plan 20-05)"
    - "whatsapp-session.spec.ts — R-WA01 QR-push + connection:open target (Plan 20-04)"
    - "whatsapp-disconnect.spec.ts — R-WA04 cascade target (Plan 20-06)"
    - "migration-138.spec.ts — gate 12 legacy_alter_table + WA tables target (Plan 20-03)"
    - "whatsapp-consent.spec.tsx — WA-02/D-07 disabled-until-checked gate (Plan 20-07)"
    - "AccountRow.spec.tsx — R-WA03 chip + Reconnect + Manage-groups target (Plan 20-07)"
    - "whatsapp-groups.spec.tsx — R-WA05 search + toggle + sort-to-top target (Plan 20-07)"
  affects:
    - "All downstream Phase 20 implementation plans (20-03 through 20-07) have concrete npx vitest run targets"
    - "CI enforced from Phase 20 wave 2 onward: ratchet tests block any send/frontier regression"
tech_stack:
  added: []
  patterns:
    - "W-1 existsSync guard on walk() — ratchets green before directory exists, load-bearing once it does"
    - "stripComments before grep — avoids self-invalidating comment prose"
    - "identifier-boundary RE — /(?:^|[^A-Za-z0-9_$])name(?:[^A-Za-z0-9_$]|$)/ prevents substring false-positives"
    - "Spec scaffold (RED target) — import from not-yet-existing module path; confirmed to fail with 'Cannot find module'"
key_files:
  created:
    - tests/unit/main/whatsapp/passive-posture.ratchet.spec.ts
    - tests/unit/main/whatsapp/no-frontier.ratchet.spec.ts
    - tests/unit/main/whatsapp/ingest-privacy.spec.ts
    - tests/unit/main/whatsapp/auth-state.spec.ts
    - tests/unit/main/whatsapp/session-reconnect.spec.ts
    - tests/unit/main/whatsapp/session-recycle.spec.ts
    - tests/unit/main/whatsapp/whatsapp-retention.spec.ts
    - tests/unit/main/whatsapp/whatsapp-session.spec.ts
    - tests/unit/main/whatsapp/whatsapp-disconnect.spec.ts
    - tests/unit/main/db/migration-138.spec.ts
    - tests/unit/renderer/whatsapp-consent.spec.tsx
    - tests/unit/renderer/AccountRow.spec.tsx
    - tests/unit/renderer/whatsapp-groups.spec.tsx
  modified: []
decisions:
  - "whatsapp-consent renamed .ts→.tsx (JSX content requires tsx extension for esbuild to compile)"
  - "passive-posture ratchet uses 8 it() blocks (1 guard + 4 send-bans + 3 config-flag existence checks) for clear per-gate failure messages"
  - "AccountRow.spec.tsx RED-fails on existing component because whatsapp IPC wiring and Manage-groups link not yet added (correct: Plan 20-07 adds them)"
  - "migration-138.spec.ts RED-fails on 138_whatsapp.sql file-not-found (correct: Plan 20-03 creates the migration)"
metrics:
  duration_minutes: 30
  completed_date: "2026-06-10"
  tasks_completed: 3
  files_created: 13
  files_modified: 0
---

# Phase 20 Plan 02: Spec Scaffolds + Static Ratchets Summary

13 Wave 0 test files seeded before any WhatsApp implementation code: 2 static-grep ratchets that are GREEN immediately with W-1 existsSync guards, 1 CRITICAL privacy spec (ingest-privacy encoding the 3-line filter + no-log-of-body), and 10 spec scaffolds that RED-fail on their missing source modules — giving every downstream implementation task a concrete `npx vitest run` target the moment it writes code.

## Tasks Completed

| Task | Description | Commit | Key Files |
|------|-------------|--------|-----------|
| 1 | passive-posture + no-frontier static ratchets (gates 1/2/3), GREEN immediately | b54e36f | passive-posture.ratchet.spec.ts, no-frontier.ratchet.spec.ts |
| 2 | 7 main-process WhatsApp spec scaffolds (ingest-privacy, auth-state, reconnect, recycle, retention, session, disconnect) | eacbab8 | 7 spec files |
| 3 | migration-138 + consent + AccountRow + group-picker scaffolds (Task 3) | 0530d37 | migration-138.spec.ts, whatsapp-consent.spec.tsx, AccountRow.spec.tsx, whatsapp-groups.spec.tsx |

## Verification Results

- `npx vitest run tests/unit/main/whatsapp/passive-posture.ratchet.spec.ts` — 8/8 PASS (GREEN, W-1 guard active)
- `npx vitest run tests/unit/main/whatsapp/no-frontier.ratchet.spec.ts` — 4/4 PASS (GREEN, W-1 guard active)
- `npx vitest run tests/unit/main/whatsapp/ingest-privacy.spec.ts` — FAIL "Cannot find module '../../../../src/main/whatsapp/ingest'" (correct RED target wired)
- `npx vitest run tests/unit/main/db/migration-138.spec.ts` — FAIL "ENOENT: no such file 138_whatsapp.sql" (correct RED, Plan 20-03 creates migration)
- `npx vitest run tests/unit/renderer/whatsapp-consent.spec.tsx` — FAIL "Failed to resolve import WhatsAppConsentModal" (correct RED, Plan 20-07)
- `npx vitest run tests/unit/renderer/AccountRow.spec.tsx` — 6 tests, 4 FAIL (whatsapp IPC + Manage-groups not yet on component, Plan 20-07)
- `npx vitest run tests/unit/renderer/whatsapp-groups.spec.tsx` — FAIL "Failed to resolve import WhatsAppGroupPickerModal" (correct RED, Plan 20-07)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] whatsapp-consent.spec.ts → whatsapp-consent.spec.tsx**
- **Found during:** Task 3 first verification run
- **Issue:** The plan frontmatter listed `tests/unit/renderer/whatsapp-consent.spec.ts` (`.ts` extension) but the spec contains JSX (`<WhatsAppConsentModal ... />`). Vitest/esbuild only processes JSX in `.tsx` files — the `.ts` extension caused "Expected '>' but found 'open'" transform error.
- **Fix:** Renamed to `.spec.tsx` to match the `.tsx` extension convention used by all other renderer spec files with JSX content.
- **Files modified:** tests/unit/renderer/whatsapp-consent.spec.tsx (renamed from .ts)
- **Commit:** 0530d37

## Known Stubs

None — this plan creates test scaffolds only. No production code was written; all specs are verified RED or GREEN as intended.

## Threat Flags

None introduced. The two static ratchets are the threat mitigations (T-20-04 passive-posture, T-20-05 frontier-import-ban, T-20-06 ingest-privacy), wired before the first production code lands.

## Self-Check: PASSED

- tests/unit/main/whatsapp/passive-posture.ratchet.spec.ts: FOUND
- tests/unit/main/whatsapp/no-frontier.ratchet.spec.ts: FOUND
- tests/unit/main/whatsapp/ingest-privacy.spec.ts: FOUND
- tests/unit/main/whatsapp/auth-state.spec.ts: FOUND
- tests/unit/main/whatsapp/session-reconnect.spec.ts: FOUND
- tests/unit/main/whatsapp/session-recycle.spec.ts: FOUND
- tests/unit/main/whatsapp/whatsapp-retention.spec.ts: FOUND
- tests/unit/main/whatsapp/whatsapp-session.spec.ts: FOUND
- tests/unit/main/whatsapp/whatsapp-disconnect.spec.ts: FOUND
- tests/unit/main/db/migration-138.spec.ts: FOUND
- tests/unit/renderer/whatsapp-consent.spec.tsx: FOUND
- tests/unit/renderer/AccountRow.spec.tsx: FOUND
- tests/unit/renderer/whatsapp-groups.spec.tsx: FOUND
- Commits b54e36f, eacbab8, 0530d37: FOUND in git log
