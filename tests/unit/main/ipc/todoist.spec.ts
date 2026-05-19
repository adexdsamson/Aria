import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as crypto from 'node:crypto';
import { createTempUserDataDir } from '../../../setup';
import { openDb, closeDb } from '../../../../src/main/db/connect';
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

describe('todoist IPC', () => {
  let dataDir: string;
  let dbKey: Buffer;

  beforeEach(() => {
    dataDir = createTempUserDataDir('aria-todoist-ipc');
    dbKey = crypto.randomBytes(32);
    vi.doMock('electron', async () => {
      const real = await vi.importActual<typeof import('electron')>('electron');
      return {
        ...real,
        app: { isReady: () => true, getPath: () => dataDir },
        safeStorage: {
          isEncryptionAvailable: () => true,
          encryptString: (s: string) => Buffer.from(`enc:${s}`),
          decryptString: (b: Buffer) => b.toString().replace(/^enc:/, ''),
          getSelectedStorageBackend: () => 'keychain',
        },
      };
    });
  });

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('electron');
  });

  it('connects a personal token and force-syncs tasks', async () => {
    const db = openDb({ dataDir, dbKey });
    const dbHolder = createDbHolder();
    dbHolder.set(db);
    const { registerTodoistHandlers } = await import('../../../../src/main/ipc/todoist');
    const { CHANNELS } = await import('../../../../src/shared/ipc-contract');
    const { ipcMain, handlers } = makeFakeIpcMain();
    registerTodoistHandlers(ipcMain, {
      logger: { warn: vi.fn(), info: vi.fn() } as any,
      dbHolder,
      buildClient: () => ({
        validateToken: async () => ({ ok: true }),
        createTask: async () => ({ externalId: 'unused' }),
        listTasks: async () => [{
          externalId: 'r1',
          content: 'Plan QBR',
          labels: [],
          priority: 1,
          isCompleted: false,
        }],
      }),
    });

    await expect(handlers.get(CHANNELS.TODOIST_CONNECT_TOKEN)!({}, { token: 'tok' })).resolves.toEqual({ ok: true });
    await expect(handlers.get(CHANNELS.TODOIST_STATUS)!({}, undefined)).resolves.toMatchObject({
      connected: true,
      tokenStatus: 'ok',
    });
    await expect(handlers.get(CHANNELS.TODOIST_FORCE_SYNC)!({}, undefined)).resolves.toEqual({ ok: true, count: 1 });
    expect(db.prepare('SELECT content FROM todoist_task WHERE remote_id = ?').get('r1')).toMatchObject({ content: 'Plan QBR' });
    closeDb(db);
  });
});
