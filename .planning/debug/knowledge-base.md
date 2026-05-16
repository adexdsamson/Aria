# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## vitest-better-sqlite3-abi — native module ABI mismatch (Electron 41 vs Node 25)
- **Date:** 2026-05-16
- **Error patterns:** NODE_MODULE_VERSION, better-sqlite3-multiple-ciphers, ABI 145, ABI 141, Cannot read properties of undefined, closeDb, openDb, new Database, bindings, electron-rebuild, node-gyp
- **Root cause:** Postinstall electron-rebuild produces an ABI-145 native binding for Electron 41, but vitest runs under system Node (ABI 141). Pinning Node is infeasible because Electron applies its own ABI bump (Node 24 = 137, Electron 41 = 145). The secondary "Cannot read properties of undefined (reading 'open')" at closeDb is a downstream symptom — openDb throws on `new Database(...)` and leaves db undefined.
- **Fix:** Dual-build pipeline. `scripts/build-native-dual.mjs` produces both ABI variants and stashes them under `node_modules/better-sqlite3-multiple-ciphers/aria-abi/` (outside `build/Release/` which node-gyp wipes). Vitest globalSetup (`tests/setup-native-abi.ts`) hot-swaps the Node-ABI variant in for tests and restores Electron-ABI on teardown (EBUSY-tolerant on Windows).
- **Files changed:** scripts/build-native-dual.mjs, tests/setup-native-abi.ts, scripts/postinstall.mjs, vitest.config.ts, package.json, tests/unit/main/db/migrations.spec.ts
---

