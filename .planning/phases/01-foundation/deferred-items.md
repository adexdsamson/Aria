# Phase 01 — Deferred Items

Pre-existing failures not caused by Plan 03; logged for tracking.

## Native module ABI mismatch in vitest runs

- **Where:** `tests/unit/main/db/backup-restore.spec.ts`, `tests/unit/main/db/migrations.spec.ts` (7 failures total)
- **Error:** `NODE_MODULE_VERSION 145` vs `141` for `better-sqlite3-multiple-ciphers`
- **Cause:** native module was electron-rebuilt against electron 41.6.1 (ABI 141) per the SQLCipher patch / `scripts/postinstall.mjs`, while vitest in this worktree picks up a Node binary with ABI 145.
- **Tracked separately:** `.planning/debug/sqlcipher-electron-42-abi.md`. Not in Plan 03 scope.
- **Workaround for local devs:** run vitest under the Node ABI that matches the rebuilt module, or rebuild for the local Node via `npm run rebuild:native`.

## Plan 04 — same ABI issue affects routingLog + ask-local-handler specs

- **Where:** `tests/unit/main/llm/routingLog.spec.ts`, `tests/unit/main/ipc/ask-local-handler.spec.ts`
- **Cause:** same NODE_MODULE_VERSION 145 vs 141 mismatch as Plan 03's deferred item — these new specs open a real SQLCipher DB.
- **Impact:** classifier + router unit tests pass; full DB-write proof gated on `npm run rebuild:native` matching the local Node ABI.
- **Out-of-scope for Plan 04.** Tracked alongside the Phase-1 native-build blocker.
