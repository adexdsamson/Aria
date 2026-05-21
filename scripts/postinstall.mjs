#!/usr/bin/env node
/**
 * Postinstall hook (Plan 01a + debug session sqlcipher-electron-42-abi).
 *
 * Pipeline:
 *   1. `scripts/build-native-dual.mjs` — full dual-ABI build for
 *      better-sqlite3-multiple-ciphers. Produces two .node binaries side by
 *      side: ABI 145 (Electron 41 runtime) and ABI 141 (system Node 25, for
 *      vitest). See .planning/debug/vitest-better-sqlite3-abi.md for the
 *      rationale (no Node version produces Electron's ABI; pinning Node is
 *      infeasible). FAIL HARD: from Plan 02 onward SQLCipher is required at
 *      runtime and at test time, so either build failing must block install.
 *
 * Note: patch-package was removed 2026-05-21. On Electron 41 the vendor patch
 *   is not needed — Electron 41 retains legacy External::* overloads so the
 *   unpatched better-sqlite3-multiple-ciphers@12.9.0 compiles cleanly.
 *   See .planning/debug/sqlcipher-electron-42-abi.md for full rationale.
 *   Sunset condition to re-add patch (if upgrading to Electron 42+):
 *   check cppgc/heap.h for _MSC_VER guard and better-sqlite3-multiple-ciphers
 *   for ExternalPointerTypeTag usage in macros.cpp + nullptr in helpers.cpp.
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

// In CI the dual-build is skipped — electron-builder handles native rebuild
// during packaging via install-app-deps / @electron/rebuild. The Node-ABI
// variant is only needed locally for vitest.
if (process.env.SKIP_DUAL_BUILD === '1') {
  console.log('[aria postinstall] SKIP_DUAL_BUILD=1 — skipping native dual-build (CI mode)');
} else {
  run('dual-build (Electron + Node ABI)', 'node', [
    'scripts/build-native-dual.mjs',
  ]);
}

console.log('[aria postinstall] all steps OK');
