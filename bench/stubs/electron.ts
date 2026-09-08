/**
 * Electron stub for the benchmark harness. NOT FOR PRODUCTION USE.
 *
 * WHY THIS EXISTS. src/main/llm/router.ts reaches Electron transitively via the
 * secrets layer, which uses `safeStorage`. That makes the routing decision path
 * unrunnable outside an Electron process, which is why tests/setup.ts has to
 * `vi.mock('electron')`. The bench runs under plain tsx, not vitest, so it has
 * no vi.mock available and instead aliases the `electron` specifier to this file
 * through bench/tsconfig.bench.json.
 *
 * The shape here deliberately mirrors the mock in tests/setup.ts so the two
 * cannot drift apart silently. If that mock gains a surface, add it here too.
 *
 * SECURITY NOTE, read before reusing any of this. `encryptString` below does
 * NOT encrypt. It is an identity transform to a Buffer, exactly as the test mock
 * does, because the bench never handles a real secret: it measures routing
 * decisions, and the classifier it exercises talks to a local Ollama daemon that
 * needs no key. This file is reachable only from the bench tsconfig and must
 * never be aliased into an application build.
 */
import * as os from 'node:os';
import * as path from 'node:path';

const BENCH_USER_DATA = path.join(os.tmpdir(), 'aria-bench-userdata');

export const safeStorage = {
  isEncryptionAvailable: (): boolean => true,
  encryptString: (s: string): Buffer => Buffer.from(s, 'utf8'),
  decryptString: (b: Buffer): string => b.toString('utf8'),
  getSelectedStorageBackend: (): string => 'bench-stub',
};

export const app = {
  isReady: (): boolean => true,
  whenReady: (): Promise<void> => Promise.resolve(),
  getPath: (key: string): string => {
    if (key === 'userData' || key === 'appData') return BENCH_USER_DATA;
    if (key === 'temp') return os.tmpdir();
    if (key === 'home') return os.homedir();
    return BENCH_USER_DATA;
  },
  getName: (): string => 'Aria',
  getVersion: (): string => '0.1.0-bench',
};

export default { safeStorage, app };
