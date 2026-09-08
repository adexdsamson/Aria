/**
 * Vitest globalSetup — swap the Node-ABI better-sqlite3 binary in for the test
 * run, then restore the Electron-ABI binary on teardown.
 *
 * This file is a thin binding onto the shared library; all of the mechanics
 * (path constants, stale-variant detection and rebuild, buffer-copy fallback,
 * Windows lock handling) live in scripts/native-abi.mjs, which the bench
 * harness's out-of-process wrapper also uses. See that file and
 * scripts/build-native-dual.mjs for the full rationale.
 *
 * Default state:
 *   build/Release/better_sqlite3.node       — active binary, normally Electron-ABI
 *   aria-abi/better_sqlite3.electron.node   — the Electron-ABI variant
 *   aria-abi/better_sqlite3.node-node       — the variant built for the HOST Node,
 *                                             whose ABI is whatever
 *                                             process.versions.modules reports;
 *                                             a sidecar .abi stamp records it so a
 *                                             Node upgrade is detected and the
 *                                             variant is rebuilt automatically.
 *
 * Both calls below deliberately pass NO options, so they take the library's
 * tolerant default lock policy: if the active binary is held by a running
 * Electron / `pnpm dev` process, warn and continue rather than abort. Specs that
 * do not touch SQLite still run; specs that do will fail at import time with a
 * descriptive ABI error, which is preferable to blocking the whole run. Do not
 * pass the strict policy here — that is the bench-only trade.
 */
import {
  activateNodeAbi,
  ensureNodeVariant,
  restoreElectronAbi,
} from '../scripts/native-abi.mjs';

export async function setup(): Promise<void> {
  ensureNodeVariant();
  activateNodeAbi();
}

export async function teardown(): Promise<void> {
  restoreElectronAbi();
}
