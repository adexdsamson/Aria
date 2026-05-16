/**
 * Plan 04 Task 2 — ASK_ARIA handler unit tests (stub-injected).
 *
 * Uses an in-memory mock `db` that records `INSERT INTO routing_log` calls so
 * the test can assert the routing_log writes without depending on the native
 * better-sqlite3-multiple-ciphers binding (which is gated on the Phase-1
 * ABI deferred item — see deferred-items.md).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';

type Row = {
  ts: string;
  route: string;
  reason: string;
  source: string;
  prompt_hash: string;
  model: string;
  latency_ms: number;
  ok: number;
};

function makeMockDb() {
  const rows: Row[] = [];
  const db = {
    prepare: (sql: string) => {
      if (sql.startsWith('INSERT INTO routing_log')) {
        return {
          run: (...args: unknown[]) => {
            rows.push({
              ts: String(args[0]),
              route: String(args[1]),
              reason: String(args[2]),
              source: String(args[3]),
              prompt_hash: String(args[4]),
              model: String(args[5]),
              latency_ms: Number(args[6]),
              ok: Number(args[7]),
            });
          },
        };
      }
      if (sql.startsWith('SELECT')) {
        return {
          all: (limit: number) =>
            [...rows].reverse().slice(0, limit),
        };
      }
      throw new Error('mock-db: unsupported sql: ' + sql);
    },
    open: true,
    close: () => undefined,
  };
  return { db, rows };
}

function makeStubIpcMain() {
  const handlers = new Map<string, (e: unknown, p: unknown) => Promise<unknown>>();
  return {
    ipcMain: {
      handle: (ch: string, fn: any) => handlers.set(ch, fn),
    } as any,
    invoke: (ch: string, p?: unknown) => handlers.get(ch)!({}, p),
  };
}

const LOCAL_SENTINEL = { __local: true } as const;
const FRONTIER_SENTINEL = { __frontier: true } as const;

interface CaseDeps {
  activeProvider: 'anthropic' | null;
  hasKey: boolean;
  generateTextImpl: (args: { model: unknown }) => Promise<{ text: string }>;
  frontierThrows?: Error;
}

async function setup(deps: CaseDeps) {
  vi.resetModules();
  const { LLMRouter } = await import('../../../../src/main/llm/router');
  const router = new LLMRouter({
    getActiveProviderFn: async () => deps.activeProvider,
    hasFrontierKeyFn: async () => deps.hasKey,
  });
  const { registerAskHandlers } = await import('../../../../src/main/ipc/ask');
  return { LLMRouter, router, registerAskHandlers };
}

describe('registerAskHandlers', { timeout: 30_000 }, () => {
  const logger = pino({ level: 'silent' });
  let mock: ReturnType<typeof makeMockDb>;

  beforeEach(() => {
    mock = makeMockDb();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('case 1: generic + no frontier → LOCAL, frontier-not-configured', async () => {
    const { router, registerAskHandlers } = await setup({
      activeProvider: null,
      hasKey: false,
      generateTextImpl: async () => ({ text: 'hello world' }),
    });
    const { ipcMain, invoke } = makeStubIpcMain();
    registerAskHandlers(ipcMain, {
      logger,
      dbHolder: { db: mock.db as any, isOpen: true, set: () => {}, close: () => {} },
      router,
      getLocalModelFn: () => LOCAL_SENTINEL as any,
      getFrontierModelFn: async () => FRONTIER_SENTINEL as any,
      generateTextFn: (async () => ({ text: 'hello world' })) as any,
    });
    const res = (await invoke('aria:ask', {
      prompt: 'What is the capital of France?',
      source: 'generic',
    })) as any;
    expect(res.answer).toBe('hello world');
    expect(res.route).toBe('LOCAL');
    expect(res.reason).toBe('frontier-not-configured');
    expect(mock.rows).toHaveLength(1);
    expect(mock.rows[0]!.reason).toBe('frontier-not-configured');
    expect(mock.rows[0]!.ok).toBe(1);
  });

  it('case 2: generic + frontier configured + generateText resolves → FRONTIER', async () => {
    const { router, registerAskHandlers } = await setup({
      activeProvider: 'anthropic',
      hasKey: true,
      generateTextImpl: async () => ({ text: 'paris' }),
    });
    const { ipcMain, invoke } = makeStubIpcMain();
    registerAskHandlers(ipcMain, {
      logger,
      dbHolder: { db: mock.db as any, isOpen: true, set: () => {}, close: () => {} },
      router,
      getLocalModelFn: () => LOCAL_SENTINEL as any,
      getFrontierModelFn: async () => FRONTIER_SENTINEL as any,
      generateTextFn: (async () => ({ text: 'paris' })) as any,
    });
    const res = (await invoke('aria:ask', {
      prompt: 'What is the capital of France?',
      source: 'generic',
    })) as any;
    expect(res.route).toBe('FRONTIER');
    expect(res.reason).toBe('generic-source-frontier-active');
    expect(mock.rows[0]!.route).toBe('FRONTIER');
  });

  it('case 3: generic + frontier throws → falls back to LOCAL with frontier-unavailable', async () => {
    const { router, registerAskHandlers } = await setup({
      activeProvider: 'anthropic',
      hasKey: true,
      generateTextImpl: async () => ({ text: 'irrelevant' }),
    });
    let callIdx = 0;
    const gen = async (args: { model: unknown }) => {
      callIdx++;
      // Frontier call (first) throws; local fallback (second) returns text.
      if (args.model === FRONTIER_SENTINEL) {
        const err = new Error('rate-limited');
        (err as any).statusCode = 429;
        throw err;
      }
      return { text: 'local-fallback-answer' };
    };
    const { ipcMain, invoke } = makeStubIpcMain();
    registerAskHandlers(ipcMain, {
      logger,
      dbHolder: { db: mock.db as any, isOpen: true, set: () => {}, close: () => {} },
      router,
      getLocalModelFn: () => LOCAL_SENTINEL as any,
      getFrontierModelFn: async () => FRONTIER_SENTINEL as any,
      generateTextFn: gen as any,
    });
    const res = (await invoke('aria:ask', {
      prompt: 'What is 2+2?',
      source: 'generic',
    })) as any;
    expect(callIdx).toBe(2);
    expect(res.route).toBe('LOCAL');
    expect(res.reason).toMatch(/^frontier-unavailable:/);
    expect(res.answer).toBe('local-fallback-answer');
    expect(mock.rows[0]!.reason).toMatch(/^frontier-unavailable:/);
  });

  it('case 4: source=user-email → LOCAL, user-data-source', async () => {
    const { router, registerAskHandlers } = await setup({
      activeProvider: 'anthropic',
      hasKey: true,
      generateTextImpl: async () => ({ text: 'ok' }),
    });
    const { ipcMain, invoke } = makeStubIpcMain();
    registerAskHandlers(ipcMain, {
      logger,
      dbHolder: { db: mock.db as any, isOpen: true, set: () => {}, close: () => {} },
      router,
      getLocalModelFn: () => LOCAL_SENTINEL as any,
      getFrontierModelFn: async () => FRONTIER_SENTINEL as any,
      generateTextFn: (async () => ({ text: 'ok' })) as any,
    });
    const res = (await invoke('aria:ask', {
      prompt: 'Summarize my inbox',
      source: 'user-email',
    })) as any;
    expect(res.route).toBe('LOCAL');
    expect(res.reason).toBe('user-data-source:user-email');
  });

  it('case 5: source omitted → LOCAL, fail-closed-source-unset', async () => {
    const { router, registerAskHandlers } = await setup({
      activeProvider: 'anthropic',
      hasKey: true,
      generateTextImpl: async () => ({ text: 'ok' }),
    });
    const { ipcMain, invoke } = makeStubIpcMain();
    registerAskHandlers(ipcMain, {
      logger,
      dbHolder: { db: mock.db as any, isOpen: true, set: () => {}, close: () => {} },
      router,
      getLocalModelFn: () => LOCAL_SENTINEL as any,
      getFrontierModelFn: async () => FRONTIER_SENTINEL as any,
      generateTextFn: (async () => ({ text: 'ok' })) as any,
    });
    const res = (await invoke('aria:ask', { prompt: 'hi' })) as any;
    expect(res.route).toBe('LOCAL');
    expect(res.reason).toBe('fail-closed-source-unset');
  });
});
