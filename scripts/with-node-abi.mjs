#!/usr/bin/env node
/**
 * Run a command under the plain-Node better-sqlite3 ABI, then put the Electron
 * ABI back.
 *
 *   node scripts/with-node-abi.mjs tsx bench/run.ts --quick
 *
 * HARD INVARIANT: this wrapper must NEVER import better-sqlite3, nor anything
 * that transitively loads it. The whole reason it exists as a separate PARENT
 * PROCESS is that on Windows a process which has mapped better_sqlite3.node can
 * never overwrite that file again. Measured on this repo 2026-09-08 (Windows 11,
 * Node 22.23.0 / ABI 127) - swap the Node variant in, require() it, open and
 * close a real Database, then try to restore:
 *
 *   fs.copyFileSync(electronVariant, active)  -> EBUSY
 *   fs.readFileSync + fs.writeFileSync        -> EBUSY
 *   fs.renameSync aside, then copy            -> restored, but the renamed file
 *                                                could not be unlinked (EPERM)
 *
 * So an in-process try/finally inside the benchmark harness would fail to
 * restore on EVERY run, turning "desktop app stranded on the wrong ABI" from an
 * occasional accident into a guarantee. Here the restore is a plain copy into an
 * unmapped file, because the child - not this process - is what loaded the
 * binding, and the child has already exited by then.
 *
 * The restore is wired into three independent triggers (finally, SIGINT/SIGTERM,
 * process 'exit') and is followed by a sha256 assertion. If the active binding is
 * not byte-identical to the Electron variant afterwards, this wrapper prints a
 * banner and exits non-zero even when the child succeeded - a stranded app must
 * never be masked by a green benchmark.
 *
 * On Ctrl-C, the restore is carried by the `finally`, not by the SIGINT handler:
 * spawnSync blocks the event loop, so the queued signal cannot be dispatched until
 * the child has exited anyway. Because `shell: true` interposes a cmd.exe, Windows
 * will also put up the usual "Terminate batch job (Y/N)?" prompt - answer it and
 * the restore runs as normal. Verified 2026-09-08 by killing the child out from
 * under a live wrapper: the finally fired and the Electron variant came back.
 *
 * Known limitation: a hard `taskkill /F` runs no handlers and will leave the Node
 * variant active (also verified 2026-09-08). Remedy is `pnpm rebuild:native:electron`,
 * which the banner names.
 */
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  activateNodeAbi,
  ensureNodeVariant,
  isElectronVariantActive,
  restoreElectronAbi,
} from './native-abi.mjs';

const PREFIX = '[with-node-abi]';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error(`${PREFIX} usage: node scripts/with-node-abi.mjs <command> [args...]`);
  process.exit(2);
}

// Ensure node_modules/.bin is on PATH so the child (tsx, vitest, ...) resolves
// whether this wrapper is launched via `pnpm run` or directly with `node`.
const BIN_DIR = path.join(REPO, 'node_modules', '.bin');
const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
process.env[pathKey] = `${BIN_DIR}${path.delimiter}${process.env[pathKey] ?? ''}`;

let restoreDone = false;
let restoreFailed = false;
let bannerPrinted = false;

function printBanner() {
  if (bannerPrinted) return;
  bannerPrinted = true;
  console.error('');
  console.error(`${PREFIX} ==========================================================`);
  console.error(`${PREFIX}  NATIVE BINDING LEFT ON THE NODE ABI`);
  console.error(`${PREFIX}  build/Release/better_sqlite3.node is NOT the Electron`);
  console.error(`${PREFIX}  variant. The Aria desktop app will FAIL TO BOOT until`);
  console.error(`${PREFIX}  this is repaired.`);
  console.error(`${PREFIX}`);
  console.error(`${PREFIX}  Remedy:  pnpm rebuild:native:electron`);
  console.error(`${PREFIX} ==========================================================`);
  console.error('');
}

/**
 * Idempotent restore. A successful restore is never repeated; a failed one may
 * be retried by a later trigger. Never throws - it records a failure flag so the
 * caller can decide the exit status.
 */
function restore() {
  if (restoreDone) return true;
  // Nothing to undo (e.g. the swap never happened because we aborted early).
  if (isElectronVariantActive()) {
    restoreDone = true;
    return true;
  }
  restoreFailed = false;
  try {
    restoreElectronAbi({ onLocked: 'throw', prefix: PREFIX });
  } catch (err) {
    restoreFailed = true;
    console.error(`${PREFIX} restore failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!restoreFailed && isElectronVariantActive()) {
    restoreDone = true;
    return true;
  }
  restoreFailed = true;
  printBanner();
  return false;
}

// Trigger 2: signals. Without an explicit SIGINT handler Node tears the wrapper
// down on Ctrl-C before any finally block runs. Do not remove.
for (const [signal, exitCode] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
]) {
  process.on(signal, () => {
    restore();
    process.exit(exitCode);
  });
}

// Trigger 3: synchronous belt-and-braces for any exit path not covered above.
process.on('exit', () => {
  restore();
});

ensureNodeVariant({ prefix: PREFIX });
// Strict policy: every consumer of this wrapper needs a working SQLite binding,
// so a locked binary must abort the run rather than degrade into a confusing
// NODE_MODULE_VERSION stack trace further downstream.
activateNodeAbi({ onLocked: 'throw', prefix: PREFIX });

const [command, ...args] = argv;
let child;
try {
  child = spawnSync(command, args, { stdio: 'inherit', shell: true, cwd: REPO });
} finally {
  // Trigger 1: the normal path, covering both success and a thrown error.
  restore();
}

let exitCode;
if (child.error) {
  console.error(`${PREFIX} failed to run \`${command}\`:`, child.error);
  exitCode = 1;
} else {
  exitCode = child.status ?? 1;
}

if (restoreFailed || !isElectronVariantActive()) {
  printBanner();
  if (exitCode === 0) exitCode = 1;
}

process.exit(exitCode);
