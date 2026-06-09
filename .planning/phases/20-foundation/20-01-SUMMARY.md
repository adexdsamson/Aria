---
phase: 20-foundation
plan: "01"
subsystem: whatsapp-foundation
tags: [whatsapp, baileys, supply-chain, ipc-contract, provider-key, build-config]
dependency_graph:
  requires: []
  provides:
    - "@whiskeysockets/baileys@6.7.23 exact-pinned in package.json + pnpm-lock.yaml"
    - "electron.vite.config.ts main.plugins externalizeDepsPlugin exclude baileys"
    - "ProviderKey union includes 'whatsapp'"
    - "7 WHATSAPP_* IPC channel constants + Zod DTOs in ipc-contract.ts"
    - "Pre-unlock stubs in ipc/index.ts (165/165 handler-count passes)"
  affects:
    - "All downstream Phase 20 plans (20-02 through 20-08) import channel constants"
    - "Plan 20-06 re-registers real handlers via WHATSAPP_CHANNELS removeHandler loop"
    - "Plan 20-07 renderer imports WhatsApp DTOs"
tech_stack:
  added:
    - "@whiskeysockets/baileys 6.7.23 (exact pin, no caret)"
    - "qrcode 1.5.4"
    - "@types/qrcode (dev)"
  patterns:
    - "externalizeDepsPlugin exclude in main section (Baileys ESM→CJS via Rollup)"
    - "Pre-unlock stub pattern (knowledgeChannels precedent) for 5 WHATSAPP invoke channels"
    - "pushOnlyChannels stub pattern for 2 WHATSAPP push channels"
key_files:
  created:
    - tests/unit/main/whatsapp/supply-chain-pin.spec.ts
    - tests/unit/main/electron-vite-config.spec.ts
  modified:
    - package.json
    - pnpm-lock.yaml
    - electron.vite.config.ts
    - src/shared/provider.ts
    - src/shared/ipc-contract.ts
    - src/main/ipc/index.ts
    - src/main/integrations/registry.ts
    - src/main/integrations/microsoft/provider-account.ts
    - src/main/integrations/microsoft/types.ts
decisions:
  - "Pre-unlock stubs added in Plan 20-01 (not deferred to 20-06) to keep handler-count test green — mirrors Knowledge Folders pattern"
  - "ProviderAccountInput.providerKey widened to include 'whatsapp' in types.ts to allow the provider_account row for WhatsApp"
  - "registry.ts throws ProviderNotFoundError for 'whatsapp' (WhatsApp uses WhatsAppSessionManager, not ProviderRegistry)"
  - "getProviderAccount signature widened to ProviderKey so registry.get can delegate the lookup"
  - "ProviderAccountDto.providerKey widened to 'whatsapp' in ipc-contract.ts to support renderer disconnect cascade"
  - "providerAccountDisconnect + providerAccountUpdate AriaApi args widened to include 'whatsapp'"
metrics:
  duration_minutes: 32
  completed_date: "2026-06-09"
  tasks_completed: 3
  files_created: 2
  files_modified: 9
---

# Phase 20 Plan 01: Supply-Chain + Build Config + Shared Contract Summary

Exact-pinned Baileys 6.7.23 + qrcode 1.5.4, added the Baileys ESM externalize exclude to electron-vite main config, extended ProviderKey with 'whatsapp', and declared all 7 WHATSAPP_* IPC channels with Zod DTOs — the contract-first foundation every downstream Phase 20 plan imports from.

## Tasks Completed

| Task | Description | Commit | Key Files |
|------|-------------|--------|-----------|
| 1 | Pin baileys@6.7.23 + qrcode@1.5.4; supply-chain ratchet (gate 10) | 8f46374 | package.json, pnpm-lock.yaml, supply-chain-pin.spec.ts |
| 2 | Add main externalize exclude for Baileys; config gate spec (gate 11) | e4e50a2 | electron.vite.config.ts, electron-vite-config.spec.ts |
| 3 | Extend ProviderKey + declare 7 WHATSAPP_* channels + Zod DTOs | 065b4f6 | provider.ts, ipc-contract.ts, registry.ts, types.ts, provider-account.ts |
| 3a | Fix: add pre-unlock stubs to ipc/index.ts (handler-count invariant) | d3c709e | src/main/ipc/index.ts |

## Verification Results

- `npx vitest run tests/unit/main/whatsapp/supply-chain-pin.spec.ts` — 4/4 PASS (gate 10)
- `npx vitest run tests/unit/main/electron-vite-config.spec.ts` — 4/4 PASS (gate 11)
- `npx vitest run tests/unit/main/ipc/index.spec.ts` — 4/4 PASS (165/165 handler-count)
- `npm run typecheck` — no new errors in modified files (pre-existing baseline unchanged)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Pre-unlock stubs missing from ipc/index.ts**
- **Found during:** Task 3 verification (ipc/index.spec.ts handler-count test)
- **Issue:** Adding 7 WHATSAPP channels to CHANNELS made the handler-count test expect 165 handlers, but `registerHandlers` only registered 158. The test immediately failed.
- **Fix:** Added 5 invoke channel stubs (db-locked responses) + 2 push channels to pushOnlyChannels in ipc/index.ts, mirroring the knowledgeChannels pattern from RESEARCH.md Pattern 2.
- **Files modified:** src/main/ipc/index.ts
- **Commit:** d3c709e

**2. [Rule 2 - Missing critical] ProviderKey cascade through type system**
- **Found during:** Task 3 typecheck verification
- **Issue:** Widening `ProviderKey` to include 'whatsapp' cascaded to `ProviderAccountInput`, `ProviderAccountRow`, `getProviderAccount` signature, `ProviderAccountDto`, `providerAccountDisconnect`, `providerAccountUpdate`, and `sync-orchestrator.ts`.
- **Fix:** Widened all related types to include 'whatsapp'; added explicit 'whatsapp' guard in registry.get() to throw ProviderNotFoundError (WhatsApp uses SessionManager, not the mail/calendar registry).
- **Files modified:** src/main/integrations/microsoft/types.ts, src/main/integrations/microsoft/provider-account.ts, src/main/integrations/registry.ts, src/shared/ipc-contract.ts
- **Commit:** 065b4f6 + d3c709e

## Known Stubs

- `ipc/index.ts` WHATSAPP_* handlers return `{ ok: false, error: 'db-locked' }` — intentional pre-unlock stubs per RESEARCH.md Pattern 2. Plan 20-06 replaces them with real implementations via bootPoll re-registration.

## Self-Check: PASSED

- package.json `@whiskeysockets/baileys`: `6.7.23` — FOUND
- pnpm-lock.yaml resolved entry: `@whiskeysockets/baileys@6.7.23` — FOUND
- electron.vite.config.ts main.plugins externalizeDepsPlugin: FOUND
- src/shared/provider.ts ProviderKey includes 'whatsapp': FOUND
- src/shared/ipc-contract.ts CHANNELS.WHATSAPP_LINK: FOUND (7 channels total)
- tests/unit/main/whatsapp/supply-chain-pin.spec.ts: FOUND
- tests/unit/main/electron-vite-config.spec.ts: FOUND
- Commits 8f46374, e4e50a2, 065b4f6, d3c709e: FOUND in git log
