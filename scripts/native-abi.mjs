#!/usr/bin/env node
/**
 * Shared better-sqlite3 ABI swap library.
 *
 * The native binding must load under TWO runtimes with INCOMPATIBLE ABIs:
 * Electron (the desktop app) and plain Node (vitest, and the bench harness).
 * `scripts/build-native-dual.mjs` builds both and stashes them in the package's
 * sibling `aria-abi/` directory, leaving the ELECTRON variant active because the
 * desktop app is the primary consumer. Anything that runs under plain Node has to
 * swap the Node variant in for the duration of its run and put the Electron
 * variant back afterwards.
 *
 * Layout under node_modules/better-sqlite3-multiple-ciphers/:
 *   build/Release/better_sqlite3.node       - the ACTIVE binding (dlopen'd at runtime)
 *   aria-abi/better_sqlite3.electron.node   - Electron-ABI variant
 *   aria-abi/better_sqlite3.node-node       - host-Node-ABI variant
 *   aria-abi/better_sqlite3.node-node.abi   - stamp: the process.versions.modules
 *                                             the Node variant was built against
 *
 * HARD INVARIANT: this module must never import better-sqlite3, and never open a
 * Database. On Windows, once a process has mapped better_sqlite3.node it can no
 * longer overwrite that file - every restore strategy fails with EBUSY/EPERM
 * (measured 2026-09-08). Restores therefore only work from a process that has not
 * loaded the binding. Keep this module free of that dependency so its callers can
 * be too.
 *
 * Lock policy (`onLocked`):
 *   'warn'  (default) - log and return false, letting the caller continue. This is
 *                       what the vitest globalSetup needs: non-SQLite specs still run.
 *   'throw'           - abort. This is what the bench harness needs: every bench
 *                       path opens a Database, so continuing only buys a more
 *                       confusing ABI stack trace downstream.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const PKG_DIR = path.join(REPO, 'node_modules', 'better-sqlite3-multiple-ciphers');
const RELEASE = path.join(PKG_DIR, 'build', 'Release');
// Variants live OUTSIDE build/Release/ - node-gyp wipes that dir during configure.
const STASH = path.join(PKG_DIR, 'aria-abi');

export const ACTIVE = path.join(RELEASE, 'better_sqlite3.node');
export const ELECTRON_VARIANT = path.join(STASH, 'better_sqlite3.electron.node');
export const NODE_VARIANT = path.join(STASH, 'better_sqlite3.node-node');
const NODE_VARIANT_ABI_STAMP = `${NODE_VARIANT}.abi`;

const DEFAULT_PREFIX = '[native-abi]';

/** Windows file-lock error codes. Anything else is a real error and must rethrow. */
function isLockError(code) {
  return code === 'EBUSY' || code === 'EPERM';
}

function errCode(err) {
  return err && typeof err === 'object' ? err.code : undefined;
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * Make sure aria-abi/better_sqlite3.node-node exists and matches the ABI of the
 * Node process that is about to load it, rebuilding via the node-only half of
 * the dual-build pipeline when it is missing or stale.
 */
export function ensureNodeVariant({ prefix = DEFAULT_PREFIX } = {}) {
  const currentAbi = process.versions.modules;

  // Missing OR stamp-mismatched => stale, rebuild.
  let needsRebuild = !fs.existsSync(NODE_VARIANT);
  if (!needsRebuild) {
    const stampedAbi = fs.existsSync(NODE_VARIANT_ABI_STAMP)
      ? fs.readFileSync(NODE_VARIANT_ABI_STAMP, 'utf8').trim()
      : null;
    if (stampedAbi !== currentAbi) {
      console.log(
        `${prefix} Node-ABI variant stale (stamp=${String(stampedAbi)}, host=${currentAbi}) - rebuilding...`,
      );
      // Remove the stale binary so a failed rebuild surfaces as MISSING rather
      // than silently leaving a wrong-ABI file in place.
      try { fs.unlinkSync(NODE_VARIANT); } catch { /* ignore */ }
      try { fs.unlinkSync(NODE_VARIANT_ABI_STAMP); } catch { /* ignore */ }
      needsRebuild = true;
    }
  }

  if (!needsRebuild) return;

  if (!fs.existsSync(ELECTRON_VARIANT)) {
    throw new Error(
      `${prefix} No ABI variants present. Run: pnpm install (or \`node scripts/build-native-dual.mjs\`).`,
    );
  }
  console.log(`${prefix} Node-ABI variant missing or stale - running node-only dual-build...`);
  const result = spawnSync(
    'node',
    [path.join(REPO, 'scripts', 'build-native-dual.mjs'), '--node-only'],
    { stdio: 'inherit', shell: true },
  );
  if (result.status !== 0) {
    throw new Error(
      `${prefix} dual-build --node-only failed (exit ${String(result.status)}). Run \`npm run rebuild:native\` to fully rebuild.`,
    );
  }
}

/**
 * Copy the Node-ABI variant over the active binding.
 * @returns {boolean} true if the swap actually happened.
 */
export function activateNodeAbi({ onLocked = 'warn', prefix = DEFAULT_PREFIX } = {}) {
  try {
    fs.copyFileSync(NODE_VARIANT, ACTIVE);
    console.log(`${prefix} swapped Node-ABI binary into build/Release/better_sqlite3.node`);
    return true;
  } catch (outerErr) {
    const outerCode = errCode(outerErr);
    if (!isLockError(outerCode)) throw outerErr;
    // Source may be locked: read into a buffer first, then write the buffer
    // (avoids a CoW shortcut on Windows that can fail on a mapped source).
    try {
      const buf = fs.readFileSync(NODE_VARIANT);
      fs.writeFileSync(ACTIVE, buf);
      console.log(`${prefix} swapped Node-ABI binary (buffer-copy fallback)`);
      return true;
    } catch (innerErr) {
      const innerCode = errCode(innerErr);
      if (!isLockError(innerCode)) throw innerErr;
      if (onLocked === 'throw') {
        throw new Error(
          `${prefix} the native binding is locked (${innerCode} on ${ACTIVE}). ` +
            'The Aria desktop app or a `pnpm dev` session is holding it. ' +
            'Close it and re-run.',
        );
      }
      console.warn(
        `${prefix} could not swap Node-ABI binary (${innerCode} on active). ` +
          'SQLite-dependent tests may fail. Stop the Electron app to resolve.',
      );
      return false;
    }
  }
}

/**
 * Copy the Electron-ABI variant back over the active binding.
 * @returns {boolean} true if the restore actually happened.
 */
export function restoreElectronAbi({ onLocked = 'warn', prefix = DEFAULT_PREFIX } = {}) {
  if (!fs.existsSync(ELECTRON_VARIANT)) return false;
  try {
    fs.copyFileSync(ELECTRON_VARIANT, ACTIVE);
    console.log(`${prefix} restored Electron-ABI binary in build/Release/better_sqlite3.node`);
    return true;
  } catch (err) {
    const code = errCode(err);
    if (!isLockError(code)) throw err;
    // Deliberately NO rename-aside fallback: it leaves undeletable *.stale
    // droppings in build/Release/ (EPERM on unlink, measured 2026-09-08).
    if (onLocked === 'throw') {
      throw new Error(
        `${prefix} could not restore the Electron-ABI binary (${code}). ` +
          'Run `pnpm rebuild:native:electron` before `pnpm dev`.',
      );
    }
    console.warn(
      `${prefix} could not restore Electron binary at teardown (${code}). ` +
        'Run `pnpm rebuild:native:electron` before `pnpm dev` if Electron fails to load native.',
    );
    return false;
  }
}

/**
 * Is the active binding byte-identical to the stashed Electron variant?
 * This is the assertion that proves the desktop app was not stranded.
 * @returns {boolean} false (never throws) if either file is absent.
 */
export function isElectronVariantActive() {
  try {
    if (!fs.existsSync(ACTIVE) || !fs.existsSync(ELECTRON_VARIANT)) return false;
    return sha256(ACTIVE) === sha256(ELECTRON_VARIANT);
  } catch {
    return false;
  }
}
