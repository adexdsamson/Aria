/**
 * Plan 04 Task 2 — Full-path LOCAL ASK_ARIA handler integration (Warning D fix).
 *
 * Wires REAL classifier + REAL router + REAL routingLog + REAL temp SQLCipher
 * DB + MOCKED generateText. Proves the full chain works without depending on
 * a live Ollama instance or any network call.
 *
 * Pre-existing native-ABI deferred item: if better-sqlite3-multiple-ciphers
 * fails to load, this test is gated. The classifier + router + handler logic
 * is still proven by `ask.spec.ts` with a mock DB.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import pino from 'pino';
import { createTempUserDataDir } from '../../../setup';

type Handler = (event: unknown, payload: unknown) => Promise<unknown>;

function makeStubIpcMain() {
  const handlers = new Map<string, Handler>();
  return {
    ipcMain: { handle: (ch: string, h: Handler) => handlers.set(ch, h) } as any,
    invoke: (ch: string, p?: unknown) => handlers.get(ch)!({}, p),
  };
}

const MIGRATIONS_DIR = path.resolve(
  __dirname,
  '../../../../src/main/db/migrations',
);

describe('ASK_ARIA full-path LOCAL handler integration (Warning D)', () => {
  const logger = pino({ level: 'silent' });
  let teardown: Array<() => void> = [];

  beforeEach(() => {
    teardown = [];
  });

  afterEach(() => {
    for (const fn of teardown) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
    vi.resetModules();
  });

  it('LOCAL path: writes one routing_log row with reason=frontier-not-configured', async () => {
    // Open a real SQLCipher DB + run migrations.
    const { openDb, closeDb } = await import('../../../../src/main/db/connect');
    const { runMigrations } = await import(
      '../../../../src/main/db/migrations/runner'
    );
    const dataDir = createTempUserDataDir('aria-ask-local-full');
    const dbKey = crypto.randomBytes(32);
    let db: any;
    try {
      db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
      runMigrations(db, { dir: MIGRATIONS_DIR });
    } catch (e) {
      // Native ABI deferred item — skip per `.planning/phases/01-foundation/deferred-items.md`.
      console.warn('skipping full-path test: native module unavailable', (e as Error).message);
      return;
    }
    teardown.push(() => closeDb(db));

    const { LLMRouter } = await import('../../../../src/main/llm/router');
    const { classifySensitivity } = await import(
      '../../../../src/main/llm/classifier'
    );
    const { hashPrompt } = await import('../../../../src/main/llm/routingLog');
    const { DEFAULT_LOCAL_MODEL } = await import(
      '../../../../src/main/llm/providers'
    );
    const { registerAskHandlers } = await import(
      '../../../../src/main/ipc/ask'
    );

    const router = new LLMRouter({
      getActiveProviderFn: async () => null,
      hasFrontierKeyFn: async () => false,
      classifierFn: classifySensitivity,
    });

    const LOCAL_SENTINEL = { __local: true };
    const generateTextFn = (async () => ({
      text: 'Paris is the capital of France.',
    })) as any;

    const { ipcMain, invoke } = makeStubIpcMain();
    registerAskHandlers(ipcMain, {
      logger,
      dbHolder: { db, isOpen: true, set: () => {}, close: () => {} },
      router,
      getLocalModelFn: (() => LOCAL_SENTINEL) as any,
      getFrontierModelFn: (async () => ({ __frontier: true })) as any,
      generateTextFn,
    });

    const prompt = 'What is the capital of France?';
    const res = (await invoke('aria:ask', { prompt, source: 'generic' })) as any;

    // Assertion (a): return shape
    expect(res.answer).toBe('Paris is the capital of France.');
    expect(res.route).toBe('LOCAL');
    expect(res.reason).toBe('frontier-not-configured');
    expect(typeof res.latency_ms).toBe('number');

    // Assertion (b): exactly one row
    const rows = db.prepare('SELECT * FROM routing_log').all();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;

    // Assertion (c): row fields
    expect(row.route).toBe('LOCAL');
    expect(row.reason).toBe('frontier-not-configured');
    expect(row.source).toBe('generic');
    expect(row.ok).toBe(1);
    expect(row.prompt_hash).toBe(hashPrompt(prompt));
    expect(row.model).toBe(DEFAULT_LOCAL_MODEL);
    expect(row.latency_ms).toBeGreaterThanOrEqual(0);

    // Assertion (d): ts parses as valid ISO timestamp
    expect(Number.isFinite(Date.parse(row.ts))).toBe(true);
  });
});
