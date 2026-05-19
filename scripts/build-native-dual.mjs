#!/usr/bin/env node
/**
 * Dual-build pipeline for better-sqlite3-multiple-ciphers (Phase 1 sunset:
 * "ABI dual-build"). See .planning/debug/vitest-better-sqlite3-abi.md.
 *
 * Background
 * ----------
 * The native binding must load under TWO runtimes with INCOMPATIBLE ABIs:
 *   - Electron 41.6.1  → NODE_MODULE_VERSION 145 (Electron applies its own
 *                        ABI bump beyond plain Node 24's 137)
 *   - System Node 25.x → NODE_MODULE_VERSION 141 (vitest)
 *
 * No Node version produces ABI 145, so pinning Node is infeasible — we must
 * carry both binaries.
 *
 * Pipeline
 * --------
 *   1. electron-rebuild (already run by postinstall.mjs OR by this script)
 *        → produces ABI-145 binary at build/Release/better_sqlite3.node
 *   2. Copy aside as build/Release/better_sqlite3.electron.node
 *   3. node-gyp rebuild (against system Node headers)
 *        → overwrites build/Release/better_sqlite3.node with ABI-141
 *   4. Copy aside as build/Release/better_sqlite3.node-node
 *   5. Restore the Electron binary as the active build/Release/better_sqlite3.node
 *      (Electron runtime is the primary use case; vitest globalSetup swaps
 *      to the Node-ABI variant just for the test run.)
 *
 * Invocation
 * ----------
 *   - Called as the final step of postinstall.mjs (full pipeline).
 *   - Re-runnable: if the Node-ABI binary is missing (e.g., someone ran
 *     `pnpm rebuild` and clobbered it), the vitest pretest hook will call
 *     this script with --node-only to regenerate just step 3-5.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const PKG_DIR = path.join(
  REPO,
  'node_modules',
  'better-sqlite3-multiple-ciphers',
);
const RELEASE = path.join(PKG_DIR, 'build', 'Release');
const ACTIVE = path.join(RELEASE, 'better_sqlite3.node');
// IMPORTANT: stash variants OUTSIDE build/Release/ — node-gyp rebuild wipes
// that dir during configure. Use sibling dir aria-abi/ at the package root.
const STASH = path.join(PKG_DIR, 'aria-abi');
const ELECTRON_VARIANT = path.join(STASH, 'better_sqlite3.electron.node');
const NODE_VARIANT = path.join(STASH, 'better_sqlite3.node-node');

// Ensure node_modules/.bin is on PATH so child processes (electron-rebuild,
// node-gyp) resolve even when this script is invoked directly with `node …`
// rather than through `pnpm run` (which sets PATH automatically).
const BIN_DIR = path.join(REPO, 'node_modules', '.bin');
const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
process.env[pathKey] = `${BIN_DIR}${path.delimiter}${process.env[pathKey] ?? ''}`;

function run(label, cmd, args, cwd = REPO) {
  console.log(`[dual-build] ${label}: ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: true, cwd });
  if (result.status !== 0) {
    console.error(
      `\n[dual-build] x ${label} FAILED (exit ${String(result.status)}).`,
    );
    process.exit(result.status ?? 1);
  }
  console.log(`[dual-build] ok ${label}`);
}

function copy(src, dst) {
  if (!fs.existsSync(src)) {
    console.error(`[dual-build] x missing source: ${src}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log(`[dual-build] cp ${path.basename(src)} -> ${path.basename(dst)}`);
}

const args = new Set(process.argv.slice(2));
const nodeOnly = args.has('--node-only');

if (!nodeOnly) {
  // Step 1: build for Electron ABI. postinstall.mjs has already done this,
  // but we re-run defensively so this script is idempotent.
  run('electron-rebuild', 'electron-rebuild', [
    '-f',
    '-w',
    'better-sqlite3-multiple-ciphers',
  ]);
  // Step 2: stash Electron binary.
  copy(ACTIVE, ELECTRON_VARIANT);
} else {
  if (!fs.existsSync(ELECTRON_VARIANT)) {
    console.error(
      '[dual-build] x --node-only requires existing Electron variant; run full pipeline first.',
    );
    process.exit(1);
  }
}

// Step 3: build for Node ABI via node-gyp (uses current Node's headers).
// Invoke the JS entrypoint directly so Windows shell resolution doesn't
// interfere with the rebuild path.
run('node-gyp rebuild', process.execPath, [
  path.join(REPO, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js'),
  'rebuild',
], PKG_DIR);

// Step 4: stash Node binary + ABI stamp sidecar (consumed by
// tests/setup-native-abi.ts to detect stale variants when the host Node's
// NODE_MODULE_VERSION drifts past what the variant was built against).
copy(ACTIVE, NODE_VARIANT);
fs.writeFileSync(`${NODE_VARIANT}.abi`, process.versions.modules, 'utf8');
console.log(`[dual-build] stamped ${path.basename(NODE_VARIANT)}.abi = ${process.versions.modules}`);

// Step 5: restore Electron variant as the active default — runtime path
// (electron-vite dev / packaged app) loads build/Release/better_sqlite3.node
// directly via `bindings`. Vitest globalSetup (tests/setup-native-abi.ts)
// swaps the Node variant in for the duration of the test run.
copy(ELECTRON_VARIANT, ACTIVE);

console.log('[dual-build] all steps ok — both ABI variants present');
