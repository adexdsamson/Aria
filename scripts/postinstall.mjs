#!/usr/bin/env node
/**
 * Postinstall hook (Plan 01a / RESEARCH Pitfall 2 / Threat T-01-01a-02).
 *
 * Runs `electron-rebuild -f -w better-sqlite3-multiple-ciphers` so the
 * Windows ABI native rebuild happens automatically on `npm install`.
 *
 * Failure handling (Threat T-01-01a-02, disposition: accept LOW):
 *   - If the rebuild fails (missing VS Build Tools, V8 ABI mismatch on a
 *     pre-plan-02 dev box that doesn't yet need SQLite, etc.), we surface
 *     the failure LOUDLY but exit 0 so `npm install` completes.
 *   - Plan 02 introduces the actual SQLCipher integration and will hard-fail
 *     at runtime if the native module is unbuilt — at that point the dev
 *     re-runs `npm run rebuild:native` (which DOES fail-hard).
 *
 * This wrapper exists so `npm install` is the canonical "tooling ready" gate
 * for Plan 01a (no source code yet) without blocking on a Plan 02 concern.
 */
import { spawnSync } from 'node:child_process';

const CMD = 'electron-rebuild';
const ARGS = ['-f', '-w', 'better-sqlite3-multiple-ciphers'];

console.log(`[aria postinstall] ${CMD} ${ARGS.join(' ')}`);

const result = spawnSync(CMD, ARGS, {
  stdio: 'inherit',
  shell: true,
});

if (result.status === 0) {
  console.log('[aria postinstall] native rebuild OK');
  process.exit(0);
}

console.error(
  '\n[aria postinstall] ⚠ electron-rebuild FAILED (exit ' +
    String(result.status) +
    ').\n' +
    '  This is non-fatal during Plan 01a (no native deps in use yet).\n' +
    '  Before Plan 02 lands, fix the toolchain and run:\n' +
    '      npm run rebuild:native\n' +
    '  Likely causes on Windows: missing VS 2022 Build Tools, or\n' +
    '  better-sqlite3-multiple-ciphers prebuild missing for Electron ABI.\n',
);
process.exit(0);
