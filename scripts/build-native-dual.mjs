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
 *   3. node-gyp rebuild (against system Node headers) — node-gyp is located by
 *      tiered resolution (see resolveNodeGyp), never at a fixed hoisted path
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
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const NODE_MODULES = path.join(REPO, 'node_modules');
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

const NODE_GYP_SUBPATH = 'node-gyp/bin/node-gyp.js';

/**
 * Locate node-gyp WITHOUT depending on a hoisted `node_modules/node-gyp`.
 *
 * node-gyp is not a direct dependency of this repo — it arrives transitively
 * through `@electron/rebuild`. Under pnpm's strict (non-hoisted) layout it
 * therefore lives only inside `node_modules/.pnpm/`, and the old hardcoded
 * `node_modules/node-gyp/bin/node-gyp.js` path only ever worked because of a
 * stale hoist artifact left behind by an older install.
 *
 * Tiers are ordered declared-dependency-first on purpose: a planted
 * `.pnpm/node-gyp@<higher-version>` directory can never pre-empt a node-gyp
 * that is legitimately reachable through the dependency graph.
 *
 * @returns {{ path: string, tier: string }}
 */
function resolveNodeGyp() {
  // Tier 1 — direct: wins if node-gyp is hoisted or declared as a direct
  // dependency (e.g. someone later runs `pnpm add -D node-gyp`).
  try {
    return { path: require.resolve(NODE_GYP_SUBPATH), tier: 'direct' };
  } catch {
    /* fall through */
  }

  // Tier 2 — via @electron/rebuild: the dependency edge that actually supplies
  // node-gyp here. Anchor on the package MAIN ENTRY, not its package.json —
  // that manifest subpath is blocked by the package's `exports` map
  // (ERR_PACKAGE_PATH_NOT_EXPORTED). This deliberately reuses the very same
  // node-gyp that electron-rebuild drives in step 1, so both halves of the
  // dual build are produced by one builder.
  try {
    const anchor = require.resolve('@electron/rebuild');
    const anchored = createRequire(anchor);
    return { path: anchored.resolve(NODE_GYP_SUBPATH), tier: '@electron/rebuild' };
  } catch {
    /* fall through */
  }

  // Tier 3 — pnpm scan: dependency-free readdir of the virtual store. Last
  // resort; covers partial installs where the dependency graph is unreadable.
  try {
    const store = path.join(NODE_MODULES, '.pnpm');
    const candidates = fs
      .readdirSync(store)
      .filter((entry) => entry.startsWith('node-gyp@'))
      .sort()
      .reverse();
    for (const entry of candidates) {
      const candidate = path.join(
        store,
        entry,
        'node_modules',
        'node-gyp',
        'bin',
        'node-gyp.js',
      );
      if (fs.existsSync(candidate)) {
        return { path: candidate, tier: 'pnpm-scan' };
      }
    }
  } catch {
    /* fall through */
  }

  console.error('[dual-build] x could not locate node-gyp.');
  console.error('[dual-build] x tried, in order:');
  console.error(`[dual-build] x   1. direct resolution of "${NODE_GYP_SUBPATH}"`);
  console.error(`[dual-build] x   2. resolution of "${NODE_GYP_SUBPATH}" via @electron/rebuild`);
  console.error(`[dual-build] x   3. filesystem scan of ${path.join(NODE_MODULES, '.pnpm')} for node-gyp@*`);
  console.error('[dual-build] x remedies:');
  console.error('[dual-build] x   - re-run the install (node-gyp ships transitively via @electron/rebuild)');
  console.error('[dual-build] x   - or declare it explicitly:  pnpm add -D node-gyp');
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const nodeOnly = args.has('--node-only');
const printNodeGyp = args.has('--print-node-gyp');

// Resolve once; the same value feeds both --print-node-gyp and the step-3 spawn.
const nodeGyp = resolveNodeGyp();
// Diagnostics go to stderr so --print-node-gyp stdout stays pipe-clean.
console.error(`[dual-build] node-gyp via ${nodeGyp.tier}: ${nodeGyp.path}`);
{
  const rel = path.relative(NODE_MODULES, nodeGyp.path);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    // Warning only, never fatal: git worktrees in this repo junction
    // node_modules back to the main checkout, so an out-of-repo realpath is
    // legitimate here. Surfacing it keeps an unexpected source visible.
    console.error(
      `[dual-build] ! node-gyp resolved OUTSIDE ${NODE_MODULES} — expected under a worktree junction; verify if unexpected.`,
    );
  }
}

if (printNodeGyp) {
  // Diagnostic probe: resolve and report only. No rebuild, no copy.
  process.stdout.write(`${nodeGyp.path}\n`);
  process.exit(0);
}

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
  nodeGyp.path,
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
