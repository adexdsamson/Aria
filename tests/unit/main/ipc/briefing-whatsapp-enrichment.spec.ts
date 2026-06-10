/**
 * Plan 21-02 Task 2 — briefing-whatsapp-enrichment.spec.ts (Wave 0 RED stubs).
 *
 * Tests that BRIEFING_TODAY enriches payload.whatsApp correctly based on
 * the D-10 state matrix. All non-trivial cases are RED until Plan 21-04
 * adds readWhatsAppDigests() to src/main/ipc/briefing.ts.
 *
 * Coverage:
 *   WA-08 / D-10 state matrix: not-linked → undefined, zero-groups → undefined,
 *                               summarized → state='ready', NULL row → state='unavailable'
 *   WA-10  — summary_text=NULL → state='unavailable', reason='model-offline'
 *   D-07.3 — BRIEFING_TODAY never throws even when readWhatsAppDigests internally throws
 *
 * Analog: tests/unit/main/ipc/briefing-regenerate.spec.ts
 * Run: npx vitest run tests/unit/main/ipc/briefing-whatsapp-enrichment.spec.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import PQueue from 'p-queue';

import { openDb, closeDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';

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

const loggerMock = {
  info: () => undefined,
  warn: () => undefined,
  debug: () => undefined,
  error: () => undefined,
};

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
  // Mock digest-cron to prevent real cron startup in test environment
  vi.doMock('../../../../src/main/whatsapp/digest-cron', () => ({
    startWhatsAppDigest: () => ({
      stop: vi.fn(),
      runNow: vi.fn().mockResolvedValue(undefined),
    }),
  }));
  // Make probeOllama (used by briefing.ts) cheap + offline
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const e = new TypeError('fetch failed');
      (e as unknown as { cause: { code: string } }).cause = { code: 'ECONNREFUSED' };
      throw e;
    }),
  );
  const briefingIpc = await import('../../../../src/main/ipc/briefing');
  const { CHANNELS } = await import('../../../../src/shared/ipc-contract');
  return { briefingIpc, CHANNELS };
}

describe('BRIEFING_TODAY — WhatsApp enrichment (D-10 state matrix)', () => {
  let dataDir: string;
  let db: ReturnType<typeof openDb>;
  const logger = pino({ level: 'silent' });
  const today = new Date().toISOString().slice(0, 10);

  beforeEach(() => {
    dataDir = createTempUserDataDir('aria-briefing-wa');
    const dbKey = crypto.randomBytes(32);
    db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });

    // Seed a provider_account row for whatsapp with status='ok'
    db.prepare(`
      INSERT INTO provider_account
        (account_id, provider_key, display_email, display_label, status, capabilities_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('wa-account-1', 'whatsapp', 'wa@phone', 'WhatsApp', 'ok', '{}');

    // Seed a tracked group
    db.prepare(
      `INSERT INTO whatsapp_group (jid, display_name, member_count, tracked) VALUES (?, ?, ?, ?)`,
    ).run('g1@g.us', 'Team Leads', 5, 1);
  });

  afterEach(() => {
    closeDb(db);
    vi.resetModules();
    vi.doUnmock('electron');
    vi.doUnmock('../../../../src/main/whatsapp/digest-cron');
    vi.unstubAllGlobals();
  });

  it('no provider_account row → payload.whatsApp is undefined (D-10 not-linked omit)', async () => {
    // Delete the provider_account row
    db.prepare(`DELETE FROM provider_account WHERE provider_key = 'whatsapp'`).run();

    const { briefingIpc, CHANNELS } = await setupModules(dataDir);
    const { ipcMain, invoke } = makeStubIpcMain();
    const scheduler = {
      queue: new PQueue({ concurrency: 1 }),
      cronRegistry: new Map(),
    } as never;
    const dbHolder = { db } as never;

    briefingIpc.registerBriefingHandlers(ipcMain as never, {
      logger,
      dbHolder,
      scheduler,
      calendarClientFactory: () => null,
      userTzFn: () => 'UTC',
    });

    // Seed a briefing row so BRIEFING_TODAY returns a payload
    db.prepare(`
      INSERT INTO briefing (date, generated_at, tz, sections, route, model, latency_ms, ok)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(today, new Date().toISOString(), 'UTC',
      JSON.stringify({ calendar: [], email: [], news: [], errors: {}, reason: 'test', route: 'LOCAL' }),
      'LOCAL', 'test-model', 100, 1);

    const result = (await invoke(CHANNELS.BRIEFING_TODAY, undefined)) as Record<string, unknown>;
    expect(result.whatsApp).toBeUndefined();
  });

  it('provider_account exists, zero tracked groups → payload.whatsApp is undefined (D-10 zero-groups omit)', async () => {
    // Set all groups to untracked
    db.prepare(`UPDATE whatsapp_group SET tracked = 0`).run();

    const { briefingIpc, CHANNELS } = await setupModules(dataDir);
    const { ipcMain, invoke } = makeStubIpcMain();
    const scheduler = {
      queue: new PQueue({ concurrency: 1 }),
      cronRegistry: new Map(),
    } as never;
    const dbHolder = { db } as never;

    briefingIpc.registerBriefingHandlers(ipcMain as never, {
      logger,
      dbHolder,
      scheduler,
      calendarClientFactory: () => null,
      userTzFn: () => 'UTC',
    });

    db.prepare(`
      INSERT INTO briefing (date, generated_at, tz, sections, route, model, latency_ms, ok)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(today, new Date().toISOString(), 'UTC',
      JSON.stringify({ calendar: [], email: [], news: [], errors: {}, reason: 'test', route: 'LOCAL' }),
      'LOCAL', 'test-model', 100, 1);

    const result = (await invoke(CHANNELS.BRIEFING_TODAY, undefined)) as Record<string, unknown>;
    expect(result.whatsApp).toBeUndefined();
  });

  it('digest row with non-NULL summary_text → state="ready", groups[0].state="summarized" (WA-08)', async () => {
    // Insert a digest row for today with non-NULL summary_text
    db.prepare(`
      INSERT INTO whatsapp_group_digest (jid, date, summary_text, generated_at, model_id)
      VALUES (?, ?, ?, ?, ?)
    `).run('g1@g.us', today,
      '### KEY POINTS\n- Shipped v1\n### DECISIONS\n(nothing)\n### OPEN QUESTIONS\n(nothing)\n### MENTIONS\n(nothing)',
      Date.now(), 'llama3.1:8b');

    const { briefingIpc, CHANNELS } = await setupModules(dataDir);
    const { ipcMain, invoke } = makeStubIpcMain();
    const scheduler = {
      queue: new PQueue({ concurrency: 1 }),
      cronRegistry: new Map(),
    } as never;
    const dbHolder = { db } as never;

    briefingIpc.registerBriefingHandlers(ipcMain as never, {
      logger,
      dbHolder,
      scheduler,
      calendarClientFactory: () => null,
      userTzFn: () => 'UTC',
    });

    db.prepare(`
      INSERT INTO briefing (date, generated_at, tz, sections, route, model, latency_ms, ok)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(today, new Date().toISOString(), 'UTC',
      JSON.stringify({ calendar: [], email: [], news: [], errors: {}, reason: 'test', route: 'LOCAL' }),
      'LOCAL', 'test-model', 100, 1);

    const result = (await invoke(CHANNELS.BRIEFING_TODAY, undefined)) as Record<string, unknown>;
    const whatsApp = result.whatsApp as { state: string; groups: Array<{ state: string }> } | undefined;

    expect(whatsApp).toBeDefined();
    expect(whatsApp!.state).toBe('ready');
    expect(Array.isArray(whatsApp!.groups)).toBe(true);
    expect(whatsApp!.groups[0].state).toBe('summarized');
  });

  it('digest row with summary_text=NULL → state="unavailable", reason="model-offline" (WA-10)', async () => {
    // Insert a digest row for today with NULL summary_text (Ollama was down)
    db.prepare(`
      INSERT INTO whatsapp_group_digest (jid, date, summary_text, generated_at, model_id)
      VALUES (?, ?, ?, ?, ?)
    `).run('g1@g.us', today, null, null, null);

    const { briefingIpc, CHANNELS } = await setupModules(dataDir);
    const { ipcMain, invoke } = makeStubIpcMain();
    const scheduler = {
      queue: new PQueue({ concurrency: 1 }),
      cronRegistry: new Map(),
    } as never;
    const dbHolder = { db } as never;

    briefingIpc.registerBriefingHandlers(ipcMain as never, {
      logger,
      dbHolder,
      scheduler,
      calendarClientFactory: () => null,
      userTzFn: () => 'UTC',
    });

    db.prepare(`
      INSERT INTO briefing (date, generated_at, tz, sections, route, model, latency_ms, ok)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(today, new Date().toISOString(), 'UTC',
      JSON.stringify({ calendar: [], email: [], news: [], errors: {}, reason: 'test', route: 'LOCAL' }),
      'LOCAL', 'test-model', 100, 1);

    const result = (await invoke(CHANNELS.BRIEFING_TODAY, undefined)) as Record<string, unknown>;
    const whatsApp = result.whatsApp as { state: string; reason: string } | undefined;

    expect(whatsApp).toBeDefined();
    expect(whatsApp!.state).toBe('unavailable');
    expect(whatsApp!.reason).toBe('model-offline');
  });

  it('provider_account.status="degraded" → connection="degraded" on the union arm', async () => {
    // Set status to 'degraded'
    db.prepare(`UPDATE provider_account SET status = 'degraded' WHERE provider_key = 'whatsapp'`).run();

    // Insert a summarized digest row
    db.prepare(`
      INSERT INTO whatsapp_group_digest (jid, date, summary_text, generated_at, model_id)
      VALUES (?, ?, ?, ?, ?)
    `).run('g1@g.us', today,
      '### KEY POINTS\n- Point A',
      Date.now(), 'llama3.1:8b');

    const { briefingIpc, CHANNELS } = await setupModules(dataDir);
    const { ipcMain, invoke } = makeStubIpcMain();
    const scheduler = {
      queue: new PQueue({ concurrency: 1 }),
      cronRegistry: new Map(),
    } as never;
    const dbHolder = { db } as never;

    briefingIpc.registerBriefingHandlers(ipcMain as never, {
      logger,
      dbHolder,
      scheduler,
      calendarClientFactory: () => null,
      userTzFn: () => 'UTC',
    });

    db.prepare(`
      INSERT INTO briefing (date, generated_at, tz, sections, route, model, latency_ms, ok)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(today, new Date().toISOString(), 'UTC',
      JSON.stringify({ calendar: [], email: [], news: [], errors: {}, reason: 'test', route: 'LOCAL' }),
      'LOCAL', 'test-model', 100, 1);

    const result = (await invoke(CHANNELS.BRIEFING_TODAY, undefined)) as Record<string, unknown>;
    const whatsApp = result.whatsApp as { state: string; connection?: string } | undefined;

    // When status is 'degraded', the connection field should reflect it
    expect(whatsApp).toBeDefined();
    expect(whatsApp!.connection).toBe('degraded');
  });

  it('BRIEFING_TODAY never throws even when readWhatsAppDigests internally throws (D-07.3 resilience)', async () => {
    const { briefingIpc, CHANNELS } = await setupModules(dataDir);
    const { ipcMain, invoke } = makeStubIpcMain();
    const scheduler = {
      queue: new PQueue({ concurrency: 1 }),
      cronRegistry: new Map(),
    } as never;
    const dbHolder = { db } as never;

    briefingIpc.registerBriefingHandlers(ipcMain as never, {
      logger,
      dbHolder,
      scheduler,
      calendarClientFactory: () => null,
      userTzFn: () => 'UTC',
    });

    // Monkey-patch db.prepare to throw when querying whatsapp_group_digest
    const originalPrepare = db.prepare.bind(db);
    const prepareStub = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('whatsapp_group_digest') || sql.includes('whatsapp_group') || sql.includes('provider_account')) {
        throw new Error('simulated DB failure in readWhatsAppDigests');
      }
      return originalPrepare(sql);
    });

    db.prepare(`
      INSERT INTO briefing (date, generated_at, tz, sections, route, model, latency_ms, ok)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(today, new Date().toISOString(), 'UTC',
      JSON.stringify({ calendar: [], email: [], news: [], errors: {}, reason: 'test', route: 'LOCAL' }),
      'LOCAL', 'test-model', 100, 1);

    // Restore prepare for the briefing row that will be fetched
    prepareStub.mockRestore();

    // Force a fresh spy that throws only on WhatsApp-related queries
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('whatsapp_group_digest') || (sql.includes('whatsapp_group') && !sql.includes('briefing'))) {
        throw new Error('simulated DB failure in readWhatsAppDigests');
      }
      return originalPrepare(sql);
    });

    // BRIEFING_TODAY must not throw — resilience invariant (D-07.3)
    let result: unknown;
    await expect(async () => {
      result = await invoke(CHANNELS.BRIEFING_TODAY, undefined);
    }).not.toThrow();

    // payload.whatsApp should be undefined when enrichment fails gracefully
    expect((result as Record<string, unknown> | undefined)?.whatsApp).toBeUndefined();
  });
});
