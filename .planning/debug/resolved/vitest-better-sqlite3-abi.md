---
status: resolved
trigger: "10 vitest tests fail on master — better-sqlite3-multiple-ciphers compiled for NODE_MODULE_VERSION 145 (Electron 41), runtime Node 25 wants 141"
created: 2026-05-16T00:00:00Z
updated: 2026-05-16T22:35:00Z
---

## Current Focus

hypothesis: Dual-build is required because no Node version produces ABI 145 (Electron applies its own bump). Approach 3 (pin Node) is NOT viable.
test: reproduce failures, then implement dual-build: copy Electron-ABI .node aside, run Node-ABI rebuild, copy aside, install correct binary at vitest globalSetup
expecting: 10 failing tests pass under Node 25; postinstall + Electron runtime still loads ABI-145 binary
next_action: DONE

## Symptoms

expected: All vitest tests pass under `pnpm vitest run`
actual: 10 tests fail with "better-sqlite3-multiple-ciphers compiled against NODE_MODULE_VERSION 145, runtime needs 141"; surfaces as "TypeError: Cannot read properties of undefined (reading 'open')" at closeDb (connect.ts:83) because openDb threw on `new Database(dbPath)` and `db` stayed undefined
errors: |
  better-sqlite3-multiple-ciphers compiled against NODE_MODULE_VERSION 145
  runtime needs NODE_MODULE_VERSION 141
  TypeError: Cannot read properties of undefined (reading 'open')
reproduction: |
  pnpm vitest run tests/unit/main/db/migrations.spec.ts tests/unit/main/db/backup-restore.spec.ts tests/unit/main/llm/routingLog.spec.ts
started: After Phase 1 close-out; previously deferred as "ABI dual-build" sunset condition
failing_tests:
  - tests/unit/main/db/backup-restore.spec.ts (3)
  - tests/unit/main/db/migrations.spec.ts (4)
  - tests/unit/main/llm/routingLog.spec.ts (3)

## Eliminated

- hypothesis: Approach 3 — pin Node version via .nvmrc + engines.node to match Electron's bundled Node
  evidence: Electron 41 bundles Node 24.15.0 but reports NODE_MODULE_VERSION 145 (Electron applies its own ABI bump per electron/node-abi). Bare Node 24.x is ABI 137. Node 25 is ABI 141. There is NO Node release whose ABI equals 145. Approach 3 is infeasible.
  timestamp: 2026-05-16T00:00:00Z

- hypothesis: Stash ABI variants inside build/Release/ (e.g., better_sqlite3.electron.node sibling to better_sqlite3.node)
  evidence: node-gyp rebuild's `configure` step wipes build/Release/. First end-to-end run failed with "missing source: better_sqlite3.electron.node" after Node rebuild. Moved stash to node_modules/better-sqlite3-multiple-ciphers/aria-abi/ which node-gyp doesn't touch.
  timestamp: 2026-05-16T22:30:00Z

## Evidence

- timestamp: 2026-05-16T00:00:00Z
  checked: System Node version + ABI
  found: Node v25.1.0, process.versions.modules = 141
  implication: Vitest runs under ABI 141

- timestamp: 2026-05-16T00:00:00Z
  checked: Electron version + bundled Node + ABI (ELECTRON_RUN_AS_NODE=1)
  found: Electron 41.6.1, bundled Node 24.15.0, process.versions.modules = 145
  implication: Electron has its own ABI bump beyond plain Node 24 (which is 137). No Node version matches 145.

- timestamp: 2026-05-16T00:00:00Z
  checked: node-abi registry for Node 24 ABI
  found: Node 24.0.0 = ABI 137 (per electron/node-abi#208). Electron 41 = 145.
  implication: Confirms dual-build required — approach 3 ruled out.

- timestamp: 2026-05-16T00:00:00Z
  checked: src/main/db/connect.ts
  found: openDb does `new Database(dbPath)` at line 58 before try-block. If binding fails to load (ABI mismatch), throw bubbles out and `db` is never assigned. Tests that call closeDb(undefined) then fail with "Cannot read properties of undefined (reading 'open')" — explains user's reported symptom mapping.
  implication: Symptom-to-cause chain confirmed; the secondary closeDb error is a red herring.

- timestamp: 2026-05-16T22:35:00Z
  checked: Full vitest run with dual-build + globalSetup
  found: 20 test files, 105/105 tests pass. globalSetup logs swap-in + restore-out. teardown succeeded on clean exit.
  implication: Fix verified end-to-end.

- timestamp: 2026-05-16T22:35:00Z
  checked: Electron smoke test (ELECTRON_RUN_AS_NODE=1 + require better-sqlite3-multiple-ciphers + open :memory: + select sqlite_version())
  found: `ELECTRON OK: { v: '3.53.0' }` — Electron runtime loads the ABI-145 binary cleanly after the full dual-build pipeline.
  implication: Electron runtime path unbroken.

- timestamp: 2026-05-16T22:33:00Z
  checked: Migration assertion in tests/unit/main/db/migrations.spec.ts
  found: `expect(applied).toEqual([1])` — stale; Plan 02-01 added 002_gmail.sql so first-open returns `[1, 2]` with user_version=2. Unrelated to ABI fix but discovered during verification.
  implication: Updated test to assert `[1, 2]` and user_version === 2. Same surface, separate concern (Plan 02-01 forgot to update this assertion).

## Resolution

root_cause: better-sqlite3-multiple-ciphers native binding is rebuilt by `electron-rebuild` (postinstall) for Electron ABI 145, but vitest runs in system Node (ABI 141). Approach 3 (pin Node) is infeasible because Electron applies its own ABI bump beyond plain Node — no Node version produces ABI 145. Dual-build is the correct fix.
fix: |
  Dual-build pipeline produces both ABI variants, stashed under
  node_modules/better-sqlite3-multiple-ciphers/aria-abi/. Vitest globalSetup
  hot-swaps the Node-ABI variant into build/Release/better_sqlite3.node for
  tests and restores the Electron-ABI variant on teardown.

  Steps:
    1. scripts/build-native-dual.mjs: electron-rebuild -> stash to aria-abi/better_sqlite3.electron.node -> node-gyp rebuild -> stash to aria-abi/better_sqlite3.node-node -> restore Electron variant as active
    2. scripts/postinstall.mjs: invoke dual-build instead of bare electron-rebuild
    3. tests/setup-native-abi.ts: globalSetup that copies Node variant in, copies Electron variant out (EBUSY-tolerant on Windows)
    4. vitest.config.ts: register globalSetup
    5. package.json: rebuild:native -> dual-build; add rebuild:native:electron and rebuild:native:node escape hatches
    6. tests/unit/main/db/migrations.spec.ts: assert applied=[1,2], user_version=2 (Plan 02-01 forgot this)
verification: |
  - `pnpm vitest run tests/unit/main/db/migrations.spec.ts tests/unit/main/db/backup-restore.spec.ts tests/unit/main/llm/routingLog.spec.ts` -> 10/10 PASS
  - `pnpm test:unit` (full suite) -> 105/105 PASS, 20 files
  - `node scripts/build-native-dual.mjs` (idempotent re-run) -> all steps OK
  - `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron -e "require & open :memory: & select sqlite_version()"` -> { v: '3.53.0' }
  - User confirmed: pnpm dev (Electron GUI launch) not executed; postinstall + native rebuild path verified + Electron binary load smoke-tested directly.
files_changed:
  - scripts/build-native-dual.mjs (new)
  - tests/setup-native-abi.ts (new)
  - scripts/postinstall.mjs
  - vitest.config.ts
  - package.json (scripts section)
  - tests/unit/main/db/migrations.spec.ts (assert applied=[1,2], user_version=2)
  - .planning/debug/resolved/vitest-better-sqlite3-abi.md (this file)
  - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-01-SUMMARY.md (deferred item moved to resolved)
