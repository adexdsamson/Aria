/**
 * Plan 02-04 / UAT Gap 8 — BRIEFING_REGENERATE_TODAY IPC handler test.
 *
 * Verifies the escape-hatch: a pre-existing today's `briefing` row gets
 * DELETEd before runBriefing fires, and the call returns the FRESH payload
 * plus writes a NEW routing_log row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import PQueue from 'p-queue';

import { openDb, closeDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';
import { upsertBriefing } from '../../../../src/main/briefing/persist';
import { LLMRouter } from '../../../../src/main/llm/router';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

type Handler = (event: unknown, payload: unknown) => Promise<unknown>;

function makeStubIpcMain() {
  const handlers = new Map<string, Handler>();
  return {
    ipcMain: {
      handle: (channel: string, h: Handler) => handlers.set(channel, h),
      removeHandler: (channel: string) => handlers.delete(channel),
    },
    invoke: (channel: string, payload?: unknown) => {
      const h = handlers.get(channel);
      if (!h) throw new Error(`no handler for ${channel}`);
      return h({}, payload);
    },
  };
}

async function setupModules(dataDir: string) {
  vi.resetModules();
  vi.doMock('electron', () => ({
    app: {
      isReady: () => true,
      whenReady: () => Promise.resolve(),
      getPath: () => dataDir,
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from('enc:' + s, 'utf8'),
      decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
      getSelectedStorageBackend: () => 'keychain',
    },
  }));
  // Make probeOllama (used by briefing.ts) cheap + offline.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const e = new TypeError('fetch failed');
      (e as any).cause = { code: 'ECONNREFUSED' };
      throw e;
    }),
  );
  const briefingIpc = await import('../../../../src/main/ipc/briefing');
  const { CHANNELS } = await import('../../../../src/shared/ipc-contract');
  return { briefingIpc, CHANNELS };
}

function todayYmdLocal(tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

describe('BRIEFING_REGENERATE_TODAY handler (UAT Gap 8)', () => {
  let dataDir: string;
  let db: ReturnType<typeof openDb>;
  const logger = pino({ level: 'silent' });
  const tz = 'UTC';

  beforeEach(() => {
    dataDir = createTempUserDataDir('aria-briefing-regen');
    const dbKey = crypto.randomBytes(32);
    db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });
  });

  afterEach(() => {
    closeDb(db);
    vi.resetModules();
    vi.doUnmock('electron');
    vi.unstubAllGlobals();
  });

  it('deletes pre-existing today row, regenerates, and returns fresh payload with new routing_log row', { timeout: 30_000 }, async () => {
    const { briefingIpc, CHANNELS } = await setupModules(dataDir);
    const today = todayYmdLocal(tz);

    // Seed a stale row for today.
    upsertBriefing(db, {
      date: today,
      generatedAt: '2000-01-01T00:00:00.000Z',
      tz,
      sections: JSON.stringify({
        calendar: [{ id: 'stale', title: 'STALE', why: 'old' }],
        email: [],
        news: [],
        errors: {},
        reason: 'pre-existing',
      }),
      route: 'LOCAL',
      model: 'stale-model',
      latency_ms: 1,
      ok: 1,
    });

    const baselineLogCount = (
      db.prepare('SELECT COUNT(*) AS n FROM routing_log').get() as { n: number }
    ).n;

    // Router that routes FRONTIER (deterministic).
    const router = new LLMRouter({
      getActiveProviderFn: async () => 'anthropic',
      hasFrontierKeyFn: async () => true,
      classifierFn: () => ({ sensitive: false, matched: [] }),
      ollamaReachableFn: async () => false, // FRONTIER_ONLY
    });

    // Stub generateObject through the briefing engine via the router's
    // chosen path. We need to intercept runBriefing's gen call. Easiest:
    // patch via getFrontierModelFn — but the IPC handler instantiates
    // runBriefing internally. Instead, we stub the `ai` module's
    // generateObject to return a fixed object.
    vi.doMock('ai', () => ({
      generateObject: vi.fn(async () => ({
        object: {
          calendar: [{ id: 'fresh', title: 'FRESH', why: 'new' }],
          email: [],
          news: [],
        },
      })),
      generateText: vi.fn(async () => ({ text: 'unused' })),
    }));

    // Patch providers.getFrontierModel to a dummy.
    vi.doMock('../../../../src/main/llm/providers', async () => {
      const actual = await vi.importActual<
        typeof import('../../../../src/main/llm/providers')
      >('../../../../src/main/llm/providers');
      return {
        ...actual,
        getFrontierModel: async () => ({ modelId: 'test-frontier' }) as any,
        getLocalModel: () => ({ modelId: 'test-local' }) as any,
      };
    });

    // Re-import briefing IPC AFTER stubs are in place.
    vi.resetModules();
    const fresh = await setupModules(dataDir);

    const { ipcMain, invoke } = makeStubIpcMain();
    const scheduler = {
      queue: new PQueue({ concurrency: 1 }),
      cronRegistry: new Map(),
    } as any;

    const dbHolder = { db } as any;
    fresh.briefingIpc.registerBriefingHandlers(ipcMain as any, {
      logger,
      dbHolder,
      scheduler,
      router,
      calendarClientFactory: () => null,
      userTzFn: () => tz,
    });

    const result = (await invoke(fresh.CHANNELS.BRIEFING_REGENERATE_TODAY, undefined)) as any;

    // Returned payload is the fresh one, not the stale.
    expect(result).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(result.date).toBe(today);
    // The route reflects the router decision (FRONTIER under FRONTIER_ONLY).
    expect(result.route).toBe('FRONTIER');
    // Calendar candidates were empty (calendarClient null → errors.calendar set),
    // so the degraded/skip path will run. We assert the row was REPLACED — the
    // generatedAt is recent, not 2000-01-01.
    const yr = new Date(result.generatedAt).getUTCFullYear();
    expect(yr).toBeGreaterThanOrEqual(2024);

    // Routing log must have grown by exactly one row.
    const after = (
      db.prepare('SELECT COUNT(*) AS n FROM routing_log').get() as { n: number }
    ).n;
    expect(after).toBe(baselineLogCount + 1);

    // The briefing table still has exactly one row for today (UPSERT idempotent).
    const rowCount = (
      db
        .prepare('SELECT COUNT(*) AS n FROM briefing WHERE date = ?')
        .get(today) as { n: number }
    ).n;
    expect(rowCount).toBe(1);
  });

  it('returns { ok: false, error: "db-locked" } when db is null', { timeout: 30_000 }, async () => {
    const { briefingIpc, CHANNELS } = await setupModules(dataDir);
    const { ipcMain, invoke } = makeStubIpcMain();
    const scheduler = { queue: new PQueue({ concurrency: 1 }), cronRegistry: new Map() } as any;
    briefingIpc.registerBriefingHandlers(ipcMain as any, {
      logger,
      dbHolder: { db: null } as any,
      scheduler,
      calendarClientFactory: () => null,
      userTzFn: () => tz,
    });
    const result = (await invoke(CHANNELS.BRIEFING_REGENERATE_TODAY, undefined)) as any;
    expect(result.ok).toBe(false);
    expect(result.error).toBe('db-locked');
  });
});
