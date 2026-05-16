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
 *   2. `electron-rebuild -f -w better-sqlite3-multiple-ciphers` — build the
 *      native module against Electron's V8 headers. FAIL HARD: from Plan 02
 *      onward SQLCipher is required at runtime, so a failed rebuild must block
 *      `npm install` (no more "accept LOW" Plan 01a wrapper — that
 *      justification no longer holds).
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
run('electron-rebuild', 'electron-rebuild', [
  '-f',
  '-w',
  'better-sqlite3-multiple-ciphers',
]);

console.log('[aria postinstall] all steps OK');
