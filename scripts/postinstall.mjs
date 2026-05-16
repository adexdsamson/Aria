#!/usr/bin/env node
/**
 * Postinstall hook (Plan 01a + debug session sqlcipher-electron-42-abi).
 *
 * Pipeline:
 *   1. `patch-package` — apply vendored patches under `patches/`. FAIL HARD on
 *      reject hunks. The current patch is for the Electron 42 / V8 12.8+ ABI
 *      blocker (see .planning/debug/sqlcipher-electron-42-abi.md). Drift here
 *      MUST surface loudly — silent rejection would resurrect the original
 *      runtime load failure.
 *   2. `scripts/build-native-dual.mjs` — full dual-ABI build for
 *      better-sqlite3-multiple-ciphers. Produces two .node binaries side by
 *      side: ABI 145 (Electron 41 runtime) and ABI 141 (system Node 25, for
 *      vitest). See .planning/debug/vitest-better-sqlite3-abi.md for the
 *      rationale (no Node version produces Electron's ABI; pinning Node is
 *      infeasible). FAIL HARD: from Plan 02 onward SQLCipher is required at
 *      runtime and at test time, so either build failing must block install.
 *
 * Sunset condition (drop `patches/` + `patch-package` when):
 *   `better-sqlite3-multiple-ciphers` publishes a version whose
 *   `src/util/macros.cpp` uses the isolate-taking `External::Value(isolate)`
 *   form and `src/better_sqlite3.cpp` casts the addon pointer to `void*` for
 *   `External::New`.
 */
import { spawnSync } from 'node:child_process';

function run(label, cmd, args) {
  console.log(`[aria postinstall] ${label}: ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.error(
      `\n[aria postinstall] ✗ ${label} FAILED (exit ${String(result.status)}).`,
    );
    process.exit(result.status ?? 1);
  }
  console.log(`[aria postinstall] ✓ ${label} OK`);
}

run('patch-package', 'patch-package', []);
run('dual-build (Electron + Node ABI)', 'node', [
  'scripts/build-native-dual.mjs',
]);

console.log('[aria postinstall] all steps OK');
