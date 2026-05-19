import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as crypto from 'node:crypto';
import { createTempUserDataDir } from '../../../setup';
import { openDb, closeDb } from '../../../../src/main/db/connect';
import { registerScheduler } from '../../../../src/main/lifecycle/scheduler';
import { createDbHolder } from '../../../../src/main/ipc/onboarding';

function makeFakeIpcMain() {
  const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>();
  return {
    ipcMain: {
      handle: vi.fn((channel: string, fn: (event: unknown, payload?: unknown) => Promise<unknown>) => {
        handlers.set(channel, fn);
      }),
    } as unknown as import('electron').IpcMain,
    handlers,
  };
}

function makeFakeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  };
}

describe('microsoft IPC', () => {
  let dataDir: string;
  let dbKey: Buffer;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    dataDir = createTempUserDataDir('aria-microsoft-ipc');
    dbKey = crypto.randomBytes(32);
    vi.doMock('electron', async () => {
      const real = await vi.importActual<typeof import('electron')>('electron');
      return {
        ...real,
        app: {
          isReady: () => true,
          whenReady: () => Promise.resolve(),
          getPath: (key: string) => (key === 'userData' ? dataDir : dataDir),
        },
        safeStorage: {
          isEncryptionAvailable: () => true,
          encryptString: (s: string) => Buffer.from('enc:' + s, 'utf8'),
          decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
          getSelectedStorageBackend: () => 'keychain',
        },
      };
    });
  });

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('electron');
  });

  it('connects, seeds provider rows, and force-syncs through injected ticks', async () => {
    const db = openDb({ dataDir, dbKey });
    const dbHolder = createDbHolder();
    dbHolder.set(db);
    const scheduler = registerScheduler(makeFakeLogger() as any);
    const { registerMicrosoftHandlers } = await import('../../../../src/main/ipc/microsoft');
    const { CHANNELS } = await import('../../../../src/shared/ipc-contract');
    const { ipcMain, handlers } = makeFakeIpcMain();
    const doConnect = vi.fn(async () => ({
      accountId: 'acct-1',
      email: 'user@contoso.com',
      displayName: 'Contoso User',
      identitySet: { primaryEmail: 'user@contoso.com', aliases: ['user@contoso.com'] },
    }));
    const doMailTick = vi.fn(async () => undefined);
    const doCalendarTick = vi.fn(async () => undefined);
    registerMicrosoftHandlers(ipcMain, {
      logger: makeFakeLogger() as any,
      dbHolder,
      scheduler,
      doConnect,
      doMailTick,
      doCalendarTick,
    });

    const connect = await handlers.get(CHANNELS.MICROSOFT_CONNECT)!({}, undefined);
    expect(connect).toEqual({ ok: true, email: 'user@contoso.com', displayName: 'Contoso User' });
    expect(doConnect).toHaveBeenCalledTimes(1);

    const row = db
      .prepare(
        `SELECT account_id as accountId, provider_key as providerKey, display_email as displayEmail,
                display_label as displayLabel, status, capabilities_json as capabilitiesJson
           FROM provider_account
          WHERE provider_key = 'microsoft'`,
      )
      .get() as
      | { accountId: string; providerKey: string; displayEmail: string; displayLabel: string | null; status: string; capabilitiesJson: string }
      | undefined;
    expect(row).toMatchObject({
      accountId: 'acct-1',
      providerKey: 'microsoft',
      displayEmail: 'user@contoso.com',
      displayLabel: 'Contoso User',
      status: 'ok',
    });

    const syncRows = db
      .prepare(
        `SELECT resource, cursor, provider_key as providerKey, account_id as accountId
           FROM provider_sync_state
          WHERE provider_key = 'microsoft'
          ORDER BY resource`,
      )
      .all() as Array<{ resource: string; cursor: string | null; providerKey: string; accountId: string }>;
    expect(syncRows.map((r) => r.resource)).toEqual(['calendar', 'mail']);
    expect(syncRows.every((r) => r.accountId === 'acct-1')).toBe(true);

    const status = await handlers.get(CHANNELS.MICROSOFT_STATUS)!({}, undefined);
    expect(status).toMatchObject({
      connected: true,
      email: 'user@contoso.com',
      displayName: 'Contoso User',
      tokenStatus: 'ok',
    });

    const forceSync = await handlers.get(CHANNELS.MICROSOFT_FORCE_SYNC)!({}, undefined);
    expect(forceSync).toEqual({ ok: true });
    expect(doMailTick).toHaveBeenCalledWith('acct-1');
    expect(doCalendarTick).toHaveBeenCalledWith('acct-1');

    const disconnect = await handlers.get(CHANNELS.MICROSOFT_DISCONNECT)!({}, undefined);
    expect(disconnect).toEqual({ ok: true });
    expect(
      db.prepare(`SELECT count(*) as count FROM provider_account WHERE provider_key = 'microsoft'`).get() as {
        count: number;
      },
    ).toMatchObject({ count: 0 });

    closeDb(db);
  });
});
