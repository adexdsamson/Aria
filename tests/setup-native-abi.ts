/**
 * Vitest globalSetup — swap the Node-ABI better-sqlite3 binary in for tests,
 * then restore the Electron-ABI binary on teardown.
 *
 * See .planning/debug/vitest-better-sqlite3-abi.md and
 * scripts/build-native-dual.mjs for the full rationale.
 *
 * Default state in build/Release/:
 *   better_sqlite3.node         — active binary, normally the Electron-ABI build
 *   better_sqlite3.electron.node — ABI 145 (Electron 41)
 *   better_sqlite3.node-node    — ABI 141 (system Node 25.x)
 *
 * setup():    overwrite active with .node-node
 * teardown(): restore active from .electron.node
 *
 * If the .node-node variant is missing (e.g., fresh clone without postinstall,
 * or someone ran `pnpm rebuild` and clobbered state), fail loudly with the
 * exact command to recover.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const PKG_DIR = path.resolve(
  __dirname,
  '..',
  'node_modules',
  'better-sqlite3-multiple-ciphers',
);
const RELEASE = path.join(PKG_DIR, 'build', 'Release');
const STASH = path.join(PKG_DIR, 'aria-abi');
const ACTIVE = path.join(RELEASE, 'better_sqlite3.node');
const ELECTRON_VARIANT = path.join(STASH, 'better_sqlite3.electron.node');
const NODE_VARIANT = path.join(STASH, 'better_sqlite3.node-node');

function ensureNodeVariant(): void {
  const currentAbi = process.versions.modules;
  const abiStamp = `${NODE_VARIANT}.abi`;

  // Check whether the existing variant matches the host Node ABI. If the
  // stamp is missing OR mismatched, treat the variant as stale and rebuild.
  let needsRebuild = !fs.existsSync(NODE_VARIANT);
  if (!needsRebuild) {
    const stampedAbi = fs.existsSync(abiStamp)
      ? fs.readFileSync(abiStamp, 'utf8').trim()
      : null;
    if (stampedAbi !== currentAbi) {
      console.log(
        `[setup-native-abi] Node-ABI variant stale (stamp=${String(stampedAbi)}, host=${currentAbi}) — rebuilding…`,
      );
      // Remove the stale binary so a failed rebuild surfaces as missing
      // rather than silently leaving a wrong-ABI file in place.
      try { fs.unlinkSync(NODE_VARIANT); } catch { /* ignore */ }
      try { fs.unlinkSync(abiStamp); } catch { /* ignore */ }
      needsRebuild = true;
    }
  }

  if (!needsRebuild) return;

  if (!fs.existsSync(ELECTRON_VARIANT)) {
    throw new Error(
      '[setup-native-abi] No ABI variants present. Run: pnpm install (or `node scripts/build-native-dual.mjs`).',
    );
  }
  console.log(
    '[setup-native-abi] Node-ABI variant missing or stale — running node-only dual-build…',
  );
  const result = spawnSync(
    'node',
    [path.resolve(__dirname, '..', 'scripts', 'build-native-dual.mjs'), '--node-only'],
    { stdio: 'inherit', shell: true },
  );
  if (result.status !== 0) {
    throw new Error(
      `[setup-native-abi] dual-build --node-only failed (exit ${String(result.status)}). Run \`npm run rebuild:native\` to fully rebuild.`,
    );
  }
}

export async function setup(): Promise<void> {
  ensureNodeVariant();
  // On Windows, the active binary (better_sqlite3.node) may be held by a running
  // Electron/electron-vite process. In that case ALL write attempts to it fail
  // with EBUSY or EPERM. We tolerate this in the same way teardown() does: log a
  // warning and continue. Tests that don't use better-sqlite3 (e.g. pure renderer
  // store specs) will still work correctly. Tests that DO require SQLite will fail
  // at import time with a descriptive ABI error — that's the expected failure mode
  // and is preferable to blocking the entire test run.
  try {
    fs.copyFileSync(NODE_VARIANT, ACTIVE);
    console.log('[setup-native-abi] swapped Node-ABI binary into build/Release/better_sqlite3.node');
  } catch (outerErr: unknown) {
    const outerCode = (outerErr as NodeJS.ErrnoException | undefined)?.code;
    if (outerCode !== 'EBUSY' && outerCode !== 'EPERM') {
      throw outerErr;
    }
    // Source locked: try reading it into a buffer first, then writing the buffer
    // to ACTIVE (avoids CoW shortcut on Windows that can fail on a mapped source).
    try {
      const buf = fs.readFileSync(NODE_VARIANT);
      fs.writeFileSync(ACTIVE, buf);
      console.log('[setup-native-abi] swapped Node-ABI binary (buffer-copy fallback)');
    } catch (innerErr: unknown) {
      const innerCode = (innerErr as NodeJS.ErrnoException | undefined)?.code;
      if (innerCode === 'EBUSY' || innerCode === 'EPERM') {
        // Both source and destination are locked (Electron is running).
        // Best-effort: proceed without swapping. Non-SQLite tests still work.
        console.warn(
          `[setup-native-abi] could not swap Node-ABI binary (${innerCode} on active). ` +
            'SQLite-dependent tests may fail. Stop the Electron app to resolve.',
        );
      } else {
        throw innerErr;
      }
    }
  }
}

export async function teardown(): Promise<void> {
  // Best-effort restore. On Windows the .node file is often still mapped into
  // the test process by the OS loader at teardown time (EBUSY on copyfile).
  // That's fine: scripts/build-native-dual.mjs always ends with the Electron
  // variant as the active binary, and a subsequent `pnpm dev` invocation will
  // load the correct binary because postinstall already left ACTIVE = Electron.
  // The next `pnpm test` run will simply re-swap. Log + swallow.
  if (!fs.existsSync(ELECTRON_VARIANT)) return;
  try {
    fs.copyFileSync(ELECTRON_VARIANT, ACTIVE);
    console.log(
      '[setup-native-abi] restored Electron-ABI binary in build/Release/better_sqlite3.node',
    );
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'EBUSY' || code === 'EPERM') {
      console.warn(
        `[setup-native-abi] could not restore Electron binary at teardown (${code}). ` +
          `Run \`pnpm rebuild:native:electron\` before \`pnpm dev\` if Electron fails to load native.`,
      );
      return;
    }
    throw err;
  }
}
